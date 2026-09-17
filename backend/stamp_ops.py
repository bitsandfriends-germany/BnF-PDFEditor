"""Stempel/Wasserzeichen/Seitenzahlen (SYSTEM PROMPT PART 2, Section 7).

Alle Mutationen laufen auf der Arbeitskopie; der Router nimmt vorher einen Snapshot
(Command + Undo). Koordinaten kommen als PDF-User-Space (unten-links) und werden ueber
dieselbe Umrechnung wie der bestehende Bildstempel in fitz (top-down) ueberfuehrt.

Platzhalter (Section 7), zur Anwendung auf geloest:
  {page} {pages} {filename} {date} {time} {user}

Bild-Deckkraft: insert_image hat kein `opacity`-Argument (verifiziert gegen PyMuPDF 1.28.2).
Wir bauen deshalb eine SMask (grau = Quell-Alpha * Deckkraft) als PNG und haengen sie an.
Bei opacity ~= 1 wird das Original unveraendert eingefuegt (Transparenz bleibt 1:1 erhalten).
"""
from __future__ import annotations

import getpass
import os
import struct
import tempfile
import zlib
from datetime import datetime, timezone
from typing import Optional

import pymupdf as fitz

from backend.pages import PageRangeError, parse_page_range, parse_page_range_set
from backend.pdflib import BadPage, CorruptDocument, PdfError, WriteDenied


class StampError(PdfError):
    code = "stamp_error"
    status = 422


# --------------------------------------------------------------------------- Helfer
def _rgb(hexcolor: Optional[str]) -> tuple[float, float, float]:
    if not hexcolor:
        return (0.0, 0.0, 0.0)
    s = hexcolor.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        raise StampError(f"Ungueltige Farbe '{hexcolor}'; erwartet #RRGGBB")
    try:
        return tuple(int(s[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError as exc:
        raise StampError(f"Ungueltige Farbe '{hexcolor}'; erwartet #RRGGBB") from exc


def _resolve_placeholders(text: str, page_no: int, total: int, filename: str,
                          user: Optional[str], now: datetime) -> str:
    mapping = {
        "{page}": str(page_no),
        "{pages}": str(total),
        "{filename}": filename,
        "{date}": now.strftime("%Y-%m-%d"),
        "{time}": now.strftime("%H:%M:%S"),
        "{user}": user or getpass.getuser(),
    }
    out = text
    for k, v in mapping.items():
        out = out.replace(k, v)
    return out


def _pages(expr: str, total: int) -> list[int]:
    try:
        return parse_page_range(expr, total)
    except PageRangeError as exc:
        raise BadPage(str(exc)) from exc


def _fitz_point_from_pdf_bottom_left(page: "fitz.Page", x: float, y: float) -> "fitz.Point":
    h = float(page.rect.height)
    return fitz.Point(float(x), h - float(y))


def _gray_png(width: int, height: int, values: list[int]) -> bytes:
    """8-bit Graustufen-PNG aus einer Zeilen-major-Liste (fuer SMask)."""
    raw = b"".join(b"\x00" + bytes(values[y * width:(y + 1) * width]) for y in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def _combined_smask_png(image_bytes: bytes, opacity: float) -> bytes:
    """SMask = Quell-Alpha (Standard 255 wenn keins) * opacity, als Graustufen-PNG."""
    pm = fitz.Pixmap(image_bytes)
    w, h, n, stride = pm.width, pm.height, pm.n, pm.stride
    if pm.alpha == 0:
        v = int(round(max(0.0, min(1.0, opacity)) * 255))
        return _gray_png(w, h, [v] * (w * h))
    s = pm.samples
    op = max(0.0, min(1.0, opacity))
    vals = [int(round(s[y * stride + x * n + (n - 1)] * op)) for y in range(h) for x in range(w)]
    return _gray_png(w, h, vals)


def _atomic_save(doc: "fitz.Document", work_path: str) -> None:
    d = os.path.dirname(work_path)
    fd, tmp = tempfile.mkstemp(prefix=".stamp-", suffix=".pdf", dir=d)
    os.close(fd)
    try:
        doc.save(tmp, garbage=3, deflate=True)
        os.replace(tmp, work_path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def normalize_image_bytes(data: bytes) -> bytes:
    """MuPDF fuellt nicht jedes Web-Format (SVG, WEBP, AVIF, HEIC, animierte GIFs...).
    Nutzergrafiken kommen genau daher: PNG/JPEG bleiben durchgereicht, alles andere
    normalisiert erst Pillow, dann (SVG & Co.) MuPDFs eigener Dokumentparser zu PNG.
    Unbekanntes bleibt unveraendert, damit der echte Fehler erhalten bleibt."""
    if not data or data[:8] == b"\x89PNG\r\n\x1a\n" or data[:2] == b"\xff\xd8":
        return data
    try:
        import io

        from PIL import Image

        im = Image.open(io.BytesIO(data))
        im.load()
        out = io.BytesIO()
        (im.convert("RGBA") if im.mode in ("RGBA", "LA", "PA", "P") else im.convert("RGB")).save(out, "PNG")
        return out.getvalue()
    except Exception:
        pass
    try:
        head = data[:200].lower()
        d = fitz.open(stream=data, filetype="svg" if b"<svg" in head or b"<?xml" in head else "svg")
        if d.page_count < 1:
            return data
        pix = d[0].get_pixmap(alpha=True)
        out = pix.tobytes("png")
        d.close()
        return out
    except Exception:
        return data
    try:
        import io

        from PIL import Image

        im = Image.open(io.BytesIO(data))
        im.load()
        out = io.BytesIO()
        (im.convert("RGBA") if im.mode in ("RGBA", "LA", "PA", "P") else im.convert("RGB")).save(out, "PNG")
        return out.getvalue()
    except Exception:
        return data


# ---------------------------------------------------------------- Bildstempel (Auswahl)
def stamp_image_selection(work_path: str, expr: str, rect: dict, image_bytes: bytes,
                          opacity: float = 1.0, rotation: int = 0, overlay: bool = True,
                          keep_proportion: bool = True) -> dict:
    """Brennt ein Bild (PNG/JPEG/SVG) auf eine Auswahl. rect unten-links in pt.
    opacity 0..1, rotation in Grad (auf 90er gerundet, insert_image-Beschraenkung),
    overlay=False setzt das Bild hinter den Inhalt."""
    if not image_bytes:
        raise StampError("Bilddaten sind leer")
    image_bytes = normalize_image_bytes(image_bytes)
    w = float(rect.get("width", 0)); h = float(rect.get("height", 0))
    if w <= 0 or h <= 0:
        raise StampError("Bildrechteck muss positiv sein")
    if not (0.0 <= opacity <= 1.0):
        raise StampError("Deckkraft muss zwischen 0 und 1 liegen")

    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = _pages(expr, n)  # order-insensitiv waere Menge, aber Auswahl gleich gueltig
        rot = (int(round(rotation / 90)) * 90) % 360
        mask = None if opacity >= 0.999 else _combined_smask_png(image_bytes, opacity)
        applied = []
        for p1 in pages:
            page = doc.load_page(p1 - 1)
            H = float(page.rect.height)
            fr = fitz.Rect(float(rect["x"]), H - (float(rect["y"]) + h), float(rect["x"]) + w, H - float(rect["y"]))
            try:
                if mask is not None:
                    page.insert_image(fr, stream=image_bytes, mask=mask, rotate=rot,
                                      overlay=overlay, keep_proportion=keep_proportion)
                else:
                    page.insert_image(fr, stream=image_bytes, rotate=rot,
                                      overlay=overlay, keep_proportion=keep_proportion)
            except Exception as exc:
                raise StampError(f"Bild konnte nicht eingefuegt werden: {exc}") from exc
            applied.append(p1)
        _atomic_save(doc, work_path)
        return {"applied": len(applied), "pages": applied, "rotation": rot, "opacity": opacity, "overlay": overlay}
    finally:
        doc.close()


# ---------------------------------------------------------------- Textstempel (Auswahl)
def stamp_text(work_path: str, expr: str, x: float, y: float, text: str,
               fontname: str = "helv", fontsize: float = 12, color: Optional[str] = "#000000",
               opacity: float = 1.0, rotation: int = 0, align: int = 0, overlay: bool = True,
               filename: str = "") -> dict:
    """Freitext an Punkt (unten-links) auf einer Auswahl, mit Platzhaltern je Seite.
    align: 0 links, 1 Mitte, 2 rechts. rotation in Grad (beliebig, via morph)."""
    if not text:
        raise StampError("Stempeltext ist leer")
    if fontsize <= 0:
        raise StampError("Schriftgroesse muss positiv sein")
    col = _rgb(color)
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = _pages(expr, n)
        now = datetime.now(timezone.utc)
        applied = []
        for p1 in pages:
            page = doc.load_page(p1 - 1)
            W = float(page.rect.width)
            resolved = _resolve_placeholders(text, p1, n, filename, None, now)
            tw = fitz.get_text_length(resolved, fontname=fontname, fontsize=fontsize)
            px = float(x)
            if align == 1:
                px = float(x) - tw / 2
            elif align == 2:
                px = float(x) - tw
            pt = _fitz_point_from_pdf_bottom_left(page, px, y)
            morph = None if rotation % 360 == 0 else (fitz.Point(pt.x, pt.y), fitz.Matrix(rotation))
            try:
                page.insert_text(pt, resolved, fontname=fontname, fontsize=fontsize, color=col,
                                 fill_opacity=opacity, morph=morph, overlay=overlay)
            except Exception as exc:
                raise StampError(f"Textstempel fehlgeschlagen: {exc}") from exc
            applied.append(p1)
        _atomic_save(doc, work_path)
        return {"applied": len(applied), "pages": applied}
    finally:
        doc.close()


# ---------------------------------------------------------------- Seitenzahlen
_ANCHORS = {"top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"}


def add_page_numbers(work_path: str, expr: str, position: str = "bottom-center", margin: float = 36.0,
                     format_str: str = "{n}", start: int = 1, fontname: str = "helv",
                     fontsize: float = 10, color: Optional[str] = "#000000") -> dict:
    """§6/§7: Seitenzahlen auf ausgewaehlten Seiten. Die ERSTE ausgewaehlte Seite erhaelt
    `start` und zaehlt hoch -> deckt 'Seite 3 = 1' ab. position: sechs Anker + Rand."""
    if position not in _ANCHORS:
        raise StampError(f"Ungueltige Position '{position}'; erlaubt: {', '.join(sorted(_ANCHORS))}")
    col = _rgb(color)
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = sorted(_pages(expr, n))
        applied = []
        for idx, p1 in enumerate(pages):
            page = doc.load_page(p1 - 1)
            W = float(page.rect.width); H = float(page.rect.height)
            text = format_str.replace("{n}", str(start + idx)).replace("{total}", str(n))
            tw = fitz.get_text_length(text, fontname=fontname, fontsize=fontsize)
            vert, hor = position.split("-")
            y = (margin + fontsize) if vert == "top" else (H - margin)
            if hor == "left":
                x = margin
            elif hor == "right":
                x = W - margin - tw
            else:
                x = (W - tw) / 2
            pt = fitz.Point(x, y)
            try:
                page.insert_text(pt, text, fontname=fontname, fontsize=fontsize, color=col, overlay=True)
            except Exception as exc:
                raise StampError(f"Seitenzahl konnte nicht gesetzt werden: {exc}") from exc
            applied.append(p1)
        _atomic_save(doc, work_path)
        return {"applied": len(applied), "pages": applied, "start": start}
    finally:
        doc.close()


# --------------------------------------------------------------- Wasserzeichen (Section 7)
# Wasserzeichen sind eine Stempel-Variante: gleicher Code-Pfad, anderer Preset
# (gross, schraeg, Standard halbtransparent UND hinter dem Inhalt overlay=False).
def _tile_positions(W: float, H: float, tw: float, th: float, gap: float = 40.0):
    """Raster-Zentren fuer getacheltes Wasserzeichen; begrenzt auf sinnvolle Menge."""
    stepx = max(20.0, tw + gap)
    stepy = max(20.0, th + gap)
    xs = _range_axis(-W, 2 * W, stepx)
    ys = _range_axis(-H, 2 * H, stepy)
    pts = [(x, y) for y in ys for x in xs]
    return pts[:400]  # harte Obergrenze gegen Entartung


def _range_axis(lo: float, hi: float, step: float):
    out = []
    v = lo
    while v <= hi and len(out) < 60:
        out.append(v)
        v += step
    return out


def add_watermark_text(work_path: str, expr: str, text: str, angle: int = 45, opacity: float = 0.2,
                       fontname: str = "helv", fontsize: float = 60, color: Optional[str] = "#808080",
                       tiled: bool = False, overlay: bool = False, filename: str = "") -> dict:
    """§7: Text-Wasserzeichen ueber einen Bereich. angle Grad, opacity 0..1,
    tiled=Kachelraster, overlay=False -> hinter dem Inhalt."""
    if not text:
        raise StampError("Wasserzeichentext ist leer")
    if not (0.0 <= opacity <= 1.0):
        raise StampError("Deckkraft muss zwischen 0 und 1 liegen")
    col = _rgb(color)
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = _pages(expr, n)
        now = datetime.now(timezone.utc)
        applied = []
        for p1 in pages:
            page = doc.load_page(p1 - 1)
            W = float(page.rect.width); H = float(page.rect.height)
            resolved = _resolve_placeholders(text, p1, n, filename, None, now)
            tw = fitz.get_text_length(resolved, fontname=fontname, fontsize=fontsize)
            centers = _tile_positions(W, H, tw, fontsize) if tiled else [((W - tw) / 2, H / 2)]
            for cx, cy in centers:
                # unten-links y -> fitz top-down: PyMuPDF-Textpunkt (cx, H-cy), Rotation um Punkt
                pt = fitz.Point(cx, H - cy)
                morph = None if angle % 360 == 0 else (pt, fitz.Matrix(angle))
                try:
                    page.insert_text(pt, resolved, fontname=fontname, fontsize=fontsize, color=col,
                                     fill_opacity=opacity, morph=morph, overlay=overlay)
                except Exception as exc:
                    raise StampError(f"Wasserzeichen fehlgeschlagen: {exc}") from exc
            applied.append(p1)
        _atomic_save(doc, work_path)
        return {"applied": len(applied), "pages": applied, "tiled": tiled, "overlay": overlay}
    finally:
        doc.close()


def add_watermark_image(work_path: str, expr: str, rect: dict, image_bytes: bytes,
                        opacity: float = 0.2, angle: int = 0, tiled: bool = False,
                        overlay: bool = False, keep_proportion: bool = True) -> dict:
    """§7: Bild-Wasserzeichen (Stempel-Preset). rect definiert eine Kachel; tiled wiederholt sie."""
    if not image_bytes:
        raise StampError("Bilddaten sind leer")
    image_bytes = normalize_image_bytes(image_bytes)
    w = float(rect.get("width", 0)); h = float(rect.get("height", 0))
    if w <= 0 or h <= 0:
        raise StampError("Kachelmasse muss positiv sein")
    rot = (int(round(angle / 90)) * 90) % 360
    mask = None if opacity >= 0.999 else _combined_smask_png(image_bytes, opacity)
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = _pages(expr, n)
        applied = []
        for p1 in pages:
            page = doc.load_page(p1 - 1)
            W = float(page.rect.width); H = float(page.rect.height)
            if tiled:
                stepx = max(w + 20, 40); stepy = max(h + 20, 40)
                offs = [(x, y) for y in _range_axis(0, H, stepy) for x in _range_axis(0, W, stepx)][:400]
            else:
                offs = [((W - w) / 2, (H - h) / 2)]
            for ox, oy in offs:
                fr = fitz.Rect(ox, oy, ox + w, oy + h)  # fitz-top-down Kachel
                try:
                    if mask is not None:
                        page.insert_image(fr, stream=image_bytes, mask=mask, rotate=rot, overlay=overlay, keep_proportion=keep_proportion)
                    else:
                        page.insert_image(fr, stream=image_bytes, rotate=rot, overlay=overlay, keep_proportion=keep_proportion)
                except Exception as exc:
                    raise StampError(f"Bild-Wasserzeichen fehlgeschlagen: {exc}") from exc
            applied.append(p1)
        _atomic_save(doc, work_path)
        return {"applied": len(applied), "pages": applied, "tiled": tiled, "overlay": overlay}
    finally:
        doc.close()


# --------------------------------------------------------------- Bilder extrahieren (Section 7)
def list_images(work_path: str, expr: str) -> dict:
    """§7: Aufloesungen der eingebetteten Bilder VOR der Extraktion auflisten."""
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = sorted(_pages(expr, n))
        out = []
        for p1 in pages:
            page = doc.load_page(p1 - 1)
            for k, t in enumerate(page.get_images(full=True)):
                out.append({"page": p1, "index": k, "xref": t[0], "width": int(t[2]), "height": int(t[3]),
                            "bpc": int(t[4]), "colorspace": str(t[5])})
        return {"images": out, "count": len(out)}
    finally:
        doc.close()


def extract_images(work_path: str, expr: str, dest_dir: str, base_name: str = "image") -> dict:
    """§7: Alle eingebetteten Bilder eines Bereichs in ein Zielverzeichnis schreiben.
    Nie stilles Ueberschreiben (§2.6)."""
    from backend.pdflib import unique_filename
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = sorted(_pages(expr, n))
        created = []
        for p1 in pages:
            page = doc.load_page(p1 - 1)
            for k, t in enumerate(page.get_images(full=True)):
                xref = t[0]
                try:
                    info = doc.extract_image(xref)
                except Exception as exc:
                    raise StampError(f"Bild xref {xref} konnte nicht extrahiert werden: {exc}") from exc
                ext = "." + str(info.get("ext", "png")).lower()
                dest = unique_filename(dest_dir, "%s_p%d_%d" % (base_name, p1, k), ext)
                with open(dest, "wb") as fh:
                    fh.write(info["image"])
                created.append({"page": p1, "index": k, "path": dest, "width": info.get("width"), "height": info.get("height")})
        return {"created": created, "count": len(created)}
    finally:
        doc.close()
