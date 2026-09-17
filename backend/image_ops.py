"""Bild-/Grafik-Objekte auf einer Seite: Aufzaehlen und Nachbearbeiten (Beweck, Groesse,
Drehung, Loeschen) — Nutzerwunsch Runde 51: eingebettete Stempel/Signaturen muessen danach
bearbeitbar bleiben.

Mechanismus (live verifiziert, PyMuPDF 1.28.2):
- Aufzaehlen: page.get_image_info(xrefs=True) liefert je Instanz bbox + transform;
  Drehung rekonstruiert aus der Transform-Matrix (atan2(b, a)).
- Instanz-praezises Entfernen: add_redact_annot(region) + apply_redactions(
  images=REMOVE, text=NONE, graphics=NONE) loescht genau die Instanzen in der Region —
  Text, Vektorgrafik und andere Bilder bleiben (im Gegensatz zu page.delete_image, das
  hier wirkungslos blieb). Grenze: ein Bild, das die Region schneidet, wird mit entfernt.
- Neu einfügen: insert_image mit gleicher Rohbilddatei, neuer Rect/Drehung (90er-Schritte).
"""

from __future__ import annotations

import math
import os
import tempfile

import pymupdf as fitz

from backend.pdflib import PdfError


class ImageObjectError(PdfError):
    """4xx statt 500 (Router-Handler via PdfError)."""
    code = "image_object_error"
    status = 422


def _to_bottom_left(page: "fitz.Page", rect: tuple[float, float, float, float]) -> dict:
    H = float(page.rect.height)
    x0, y0, x1, y1 = rect  # MuPDF: oben-links
    return {"x": x0, "y": H - y1, "width": x1 - x0, "height": y1 - y0}


def _rotation_from_transform(tr: tuple[float, float, float, float, float, float]) -> int:
    # Invertierung verifiziert (PyMuPDF 1.28.2, live): insert_image rotate=90 erzeugt
    # atan2(b,a)=270 (PDF-y zeigt nach oben, Screen-Rotation nach unten). Rueckumrechnung
    # fuer rotate-Parameter: insert_rot = (-visual) % 360.
    # Konvention (live gemessen, PyMuPDF 1.28.2): rotation-Feld == atan2(b,a) der
    # Transform-Matrix in 90er-Schritten (insert_image rotate=r ergibt (360-r)%360).
    # Eine Drehung um +delta visuell verschiebt dieses Feld um -delta; insert_rot ist
    # die Inverse. Alles daran ist Selbsttest-immanent: nach +90 tauschen BBox-w/h.
    ang = math.degrees(math.atan2(tr[1], tr[0]))
    return int(round(ang / 90.0) * 90) % 360


def read_graphic_file(path: str) -> dict:
    """Grafik-Datei fuer Signatur-Aussehen lesen (PNG/JPG/JPEG/SVG), Base64 zurueck.
    Groessenlimit 8 MB; Pfad kommt aus dem nativen Dateidialog des Nutzers."""
    import base64
    import os

    from backend.pdflib import PdfError

    if not path or not os.path.isfile(path):
        raise PdfError("Grafikdatei nicht gefunden")
    size = os.path.getsize(path)
    if size > 8 * 1024 * 1024:
        raise PdfError("Grafikdatei zu gross (max. 8 MB)")
    ext = os.path.splitext(path)[1].lower()
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
            ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp"}.get(ext)
    if mime is None:
        raise PdfError("Nur PNG, JPG, SVG, GIF, WebP oder BMP als Signaturgrafik")
    with open(path, "rb") as fh:
        data = fh.read()
    if ext == ".svg":
        # R63: SVG laesst sich nicht direkt ins PDF-AP einbetten — in grosser
        # Aufloesung zu PNG gerastert (transparenter Hintergrund bleibt erhalten).
        data = _rasterize_svg(data)
        mime = "image/png"
    elif ext in (".gif", ".webp", ".bmp"):
        data = _rasterize_to_png(data)
        mime = "image/png"
    return {"name": os.path.basename(path), "mime": mime, "b64": base64.b64encode(data).decode("ascii")}


def _rasterize_to_png(data: bytes) -> bytes:
    from backend.pdflib import PdfError

    import pymupdf as fitz

    try:
        pm = fitz.Pixmap(data)
        if pm.alpha == 0:
            pm2 = fitz.Pixmap(fitz.csRGB, pm) if pm.colorspace and pm.colorspace.name not in ("DeviceRGB", "DeviceGray") else pm
        else:
            pm2 = fitz.Pixmap(pm, 0) if pm.n > 3 else pm
        return pm2.tobytes("png")
    except Exception as exc:
        raise PdfError(f"Grafik konnte nicht gelesen werden: {str(exc)[:80]}") from exc


def _svg_has_content(png_bytes: bytes) -> bool:
    """True, wenn das gerasterte PNG mehr als nur leere Flaeche zeigt."""
    try:
        import pymupdf as fitz

        pm = fitz.Pixmap(png_bytes)
        s, n = pm.samples, pm.n
        if not s or pm.width * pm.height == 0:
            return False
        step = max(1, (pm.width * pm.height) // 4000) * n
        seen = 0
        for i in range(0, len(s) - n, step):
            a = s[i + 3] if pm.alpha else 255
            if a > 24 and not (s[i] > 245 and s[i + 1] > 245 and s[i + 2] > 245):
                seen += 1
                if seen > 40:
                    return True
        return seen > 8
    except Exception:
        return False


def _rasterize_svg_imagemagick(data: bytes) -> bytes:
    """R68 Nutzeranregung: ImageMagick als zweiter Rasterierer — es kennt auch
    komplexe Inkscape-Konstrukte, an denen der Primary scheitern kann. Nur
    Fallback, wenn das System es hat; das SVG verlaesst das Gerat nicht."""
    import os
    import shutil
    import subprocess
    import tempfile

    exe = shutil.which("magick") or shutil.which("convert")
    if not exe:
        raise PdfError("ImageMagick nicht gefunden")
    fd_i, src = tempfile.mkstemp(suffix=".svg")
    fd_o, dst = tempfile.mkstemp(suffix=".png")
    os.close(fd_i)
    os.close(fd_o)
    try:
        with open(src, "wb") as fh:
            fh.write(data[:20 * 1024 * 1024])
        cmd = [exe, "-density", "300", "-background", "none", src, "-resize", "800x800>", dst]
        subprocess.run(cmd, timeout=25, check=True, capture_output=True)
        with open(dst, "rb") as fh:
            return fh.read()
    finally:
        for f in (src, dst):
            try:
                os.unlink(f)
            except OSError:
                pass


def _rasterize_svg(data: bytes) -> bytes:
    from backend.pdflib import PdfError

    import pymupdf as fitz

    out: bytes | None = None
    try:
        svg = fitz.Document("svg", data)
        # In 2x-Size dernativen Weite rendern, damit das Feld gestochen scharf bleibt.
        pg = svg[0]
        r = pg.rect
        w = float(r.width) or 200.0
        h = float(r.height) or 100.0
        if w < 2:
            w, h = 200.0, h * (200.0 / max(w, 0.01))
        pm = pg.get_pixmap(matrix=fitz.Matrix(400.0 / w, 400.0 / w), alpha=True)
        out = pm.tobytes("png")
        svg.close()
    except Exception:
        out = None
    if out is not None and _svg_has_content(out):
        return out
    # R68: Primary leer/fehlgeschlagen -> ImageMagick-Fallback (Nutzer: "im
    # Zweifel per ImageMagick umwandeln"). Beide leer -> klare Fehlermeldung.
    try:
        alt = _rasterize_svg_imagemagick(data)
        if _svg_has_content(alt):
            return alt
    except Exception:
        pass
    if out is not None:
        return out  # zumindest etwas gerendertes besser als gar nichts
    raise PdfError("SVG konnte nicht umgewandelt werden (MuPDF und ImageMagick leer)")


def list_image_objects(work_path: str, expr: str) -> dict:
    from backend import stamp_ops  # lokal: Zyklus vermeiden

    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = stamp_ops._pages(expr, n)
        out = []
        for p1 in pages:
            page = doc.load_page(p1 - 1)
            for idx, info in enumerate(page.get_image_info(xrefs=True)):
                b = info["bbox"]
                out.append({
                    "page": p1,
                    "index": idx,
                    "xref": info["xref"],
                    "rect": _to_bottom_left(page, (b[0], b[1], b[2], b[3])),
                    "rotation": _rotation_from_transform(info["transform"]),
                    "pixelWidth": info.get("width"),
                    "pixelHeight": info.get("height"),
                })
        return {"objects": out}
    finally:
        doc.close()


def _atomic_save(doc: "fitz.Document", work_path: str) -> None:
    d = os.path.dirname(work_path)
    fd, tmp = tempfile.mkstemp(prefix=".imgobj-", suffix=".pdf", dir=d)
    os.close(fd)
    try:
        doc.save(tmp, garbage=3, deflate=True)
        os.replace(tmp, work_path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def _count_images(page: "fitz.Page") -> int:
    # get_image_info() cacht pro Page-Objekt (live verifiziert: nach apply_redactions
    # Altdaten); get_images() liest die Ressourcen direkt und ist nach redactions frisch.
    return len(page.get_images(full=True))


def _remove_instance(doc: "fitz.Document", pno: int, rect: fitz.Rect) -> int:
    page = doc.load_page(pno)
    before = _count_images(page)
    page.add_redact_annot(rect)
    page.apply_redactions(
        images=fitz.PDF_REDACT_IMAGE_REMOVE,
        text=fitz.PDF_REDACT_TEXT_NONE,
        graphics=fitz.PDF_REDACT_LINE_ART_NONE,
    )
    return before - _count_images(page)


def update_image_object(work_path: str, page_no: int, bbox: dict, rect: dict,
                        rotate_delta: int = 0) -> dict:
    """Verschiebt/reskaliert/dreht EINE Bildinstanz. bbox = aktuelles MuPDF-BBox-Zielgebiet
    (x,y,width,height unten-links, vom Client 1:1 aus list zurueck), rect = neue Zielregion
    (gleiches System), rotate_delta in 90er-Schritten. Rueckgabe: neue rect+rotation."""
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        if not (1 <= page_no <= n):
            raise ImageObjectError(f"Seite {page_no} ausserhalb des Bereichs 1..{n}")
        page = doc.load_page(page_no - 1)
        H = float(page.rect.height)
        bx, by, bw, bh = float(bbox["x"]), float(bbox["y"]), float(bbox["width"]), float(bbox["height"])
        if bw <= 0 or bh <= 0:
            raise ImageObjectError("bbox muss positiv sein")
        mrect = fitz.Rect(bx, H - (by + bh), bx + bw, H - by)
        # Instanz + Rohdaten vor dem Entfernen bestimmen.
        target = None
        for info in page.get_image_info(xrefs=True):
            b = info["bbox"]
            ib = fitz.Rect(b[0], b[1], b[2], b[3])
            if ib.intersects(mrect) and (ib & mrect).get_area() >= 0.9 * min(ib.get_area(), mrect.get_area()):
                target = info
                break
        if target is None:
            raise ImageObjectError("Bildinstanz an dieser Stelle nicht gefunden (verschoben?)")
        xref = target["xref"]
        old_rot = _rotation_from_transform(target["transform"])
        img = doc.extract_image(xref)
        raw = img["image"]
        if not raw:
            raise ImageObjectError("Bilddaten nicht extrahierbar")
        removed = _remove_instance(doc, page_no - 1, mrect)
        if removed < 1:
            raise ImageObjectError("Instanz konnte nicht entfernt werden")
        rx, ry, rw, rh = float(rect["x"]), float(rect["y"]), float(rect["width"]), float(rect["height"])
        if rw <= 0 or rh <= 0:
            raise ImageObjectError("Zielrechteck muss positiv sein")
        d90 = int(round(rotate_delta / 90.0) * 90)
        rot = (old_rot - d90) % 360
        insert_rot = (360 - rot) % 360
        fr = fitz.Rect(rx, H - (ry + rh), rx + rw, H - ry)
                # Vertrag: der Aufrufer uebergibt bei 90/270-Drehung bereits das getauschte
        # Zielrechteck (rotate dreht bei insert_image den Inhalt IM Frame; live gemessen).
        page.insert_image(fr, stream=raw, rotate=insert_rot, overlay=True, keep_proportion=True)
        _atomic_save(doc, work_path)
        return {"page": page_no, "rect": rect, "rotation": rot, "removed": removed}
    finally:
        doc.close()


def delete_image_object(work_path: str, page_no: int, bbox: dict) -> dict:
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        if not (1 <= page_no <= n):
            raise ImageObjectError(f"Seite {page_no} ausserhalb des Bereichs 1..{n}")
        page = doc.load_page(page_no - 1)
        H = float(page.rect.height)
        bx, by, bw, bh = float(bbox["x"]), float(bbox["y"]), float(bbox["width"]), float(bbox["height"])
        if bw <= 0 or bh <= 0:
            raise ImageObjectError("bbox muss positiv sein")
        mrect = fitz.Rect(bx, H - (by + bh), bx + bw, H - by)
        removed = _remove_instance(doc, page_no - 1, mrect)
        if removed < 1:
            raise ImageObjectError("Bildinstanz an dieser Stelle nicht gefunden")
        _atomic_save(doc, work_path)
        return {"page": page_no, "removed": removed}
    finally:
        doc.close()
