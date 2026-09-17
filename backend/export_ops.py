"""Export / Konvertierung / Optimierung (SYSTEM PROMPT PART 2, Section 12).

Lineares ("Fast Web View") wird ueber pikepdf nativ erZeugt: pikepdf.save(linearize=True)
nutzt die gebuendelte libqpdf (Scope-Konflikt C3 war eine Fehleinschaetzung und ist geloest).
Achtung: Linearisieren ist mit Verschluesselung unvereinbar (qpdf); die Route lehnt offene
verschluesselte Dokumente VOR dem Lauf ab (Section 2.7).

Textexport: Die Architektur sieht einen DocumentContextProvider vor (welcher Provider auch
immer aktiv ist). Es gibt noch keinen In-Process-Provider (Docling laeuft als Sidecar-Prozess).
Deshalb liefert `document_text` hier den eingebauten PyMuPDF-Text; spaetere Provider koennen
diese Funktion ersetzen, ohne die Aufrufer zu aendern.

Neue Dateien werden nie ueberschrieben (§2.6): Namensollision bekommt _1, _2 ...
"""
from __future__ import annotations

import os
import tempfile
from typing import Optional

import pikepdf
import pymupdf as fitz

from backend.pages import PageRangeError, parse_page_range
from backend.pdflib import BadPage, PdfError, unique_filename


class ExportError(PdfError):
    code = "export_error"
    status = 422


_PAPERS = {  # Hochformat in pt
    "a3": (841.89, 1190.55),
    "a4": (595.28, 841.89),
    "letter": (612.0, 792.0),
    "legal": (612.0, 1008.0),
}
_ALLOWED_DPI = (72, 150, 300, 600)


def _pages(expr: str, total: int) -> list[int]:
    try:
        return parse_page_range(expr, total)
    except PageRangeError as exc:
        raise BadPage(str(exc)) from exc


def linearise(work_path: str, dest_dir: str, base_name: Optional[str] = None) -> dict:
    """§12: Lineares PDF ("Fast Web View") ueber pikepdf.save(linearize=True) erzeugen.
    Schreibt eine NEUE Datei (nie ueberschreiben, §2.6) und meldet vorher/nachher. Rufer muss
    verschluesselte Dokumente vorher ablehnen (Linearisieren + Crypto ist unvereinbar)."""
    if not os.path.isdir(dest_dir) or not os.access(dest_dir, os.W_OK):
        raise ExportError("Kein Schreibrecht auf das Zielverzeichnis")
    src_bytes = os.path.getsize(work_path)
    if not base_name:
        base_name = os.path.splitext(os.path.basename(work_path))[0] + "_linear"
    dest = unique_filename(dest_dir, base_name, ".pdf")
    src = pikepdf.open(work_path)
    try:
        src.save(dest, linearize=True)
    finally:
        src.close()
    chk = pikepdf.open(dest)
    try:
        is_lin = bool(chk.is_linearized)
    finally:
        chk.close()
    out_bytes = os.path.getsize(dest)
    saved_pct = round(100.0 * (src_bytes - out_bytes) / src_bytes, 1) if src_bytes else 0.0
    return {"path": dest, "linearized": is_lin, "beforeBytes": src_bytes, "afterBytes": out_bytes, "savedPercent": saved_pct}


# --------------------------------------------------------------- Seiten als Bilder
def export_images(work_path: str, expr: str, dest_dir: str, fmt: str = "png",
                  dpi: int = 150, base_name: str = "page") -> dict:
    """§12: Seiten als PNG/JPEG, DPI 72/150/300/600, eine Datei pro Seite, §2.6-Suffix."""
    fmt = fmt.lower()
    if fmt not in ("png", "jpeg", "jpg"):
        raise ExportError(f"Ungueltiges Bildformat '{fmt}'; erlaubt: png, jpeg")
    if dpi not in _ALLOWED_DPI:
        raise ExportError(f"Ungueltige Aufloesung {dpi}; erlaubt: {', '.join(map(str,_ALLOWED_DPI))}")
    ext = ".jpg" if fmt in ("jpeg", "jpg") else ".png"
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = _pages(expr, n)
        created = []
        for p1 in pages:
            page = doc.load_page(p1 - 1)
            pix = page.get_pixmap(dpi=dpi)
            if ext == ".jpg" and pix.alpha:
                pix = fitz.Pixmap(pix, 0)  # JPEG kann keine Alphakanal tragen
            data = pix.tobytes("jpeg" if ext == ".jpg" else "png")
            dest = unique_filename(dest_dir, "%s_p%d" % (base_name, p1), ext)
            with open(dest, "wb") as fh:
                fh.write(data)
            created.append({"page": p1, "path": dest, "width": pix.width, "height": pix.height,
                            "bytes": len(data)})
        return {"created": created, "count": len(created), "format": ext.lstrip("."), "dpi": dpi}
    finally:
        doc.close()


# --------------------------------------------------------------- Text exportieren
def document_text(work_path: str, expr: str, fmt: str = "txt") -> str:
    """Eingebauter Text-Provider. fmt 'txt' (roh) oder 'md' (mit Seiten-/Blockstruktur).
    Ein spaeterer DocumentContextProvider (AI/Docling) kann diese Funktion ersetzen."""
    fmt = fmt.lower()
    if fmt not in ("txt", "md", "markdown"):
        raise ExportError(f"Ungueltiges Textformat '{fmt}'; erlaubt: txt, md")
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = _pages(expr, n)
        chunks = []
        for p1 in pages:
            page = doc.load_page(p1 - 1)
            if fmt == "txt":
                chunks.append(page.get_text())
            else:
                blocks = [b[4].strip() for b in page.get_text("blocks") if b[4].strip()]
                body = "\n\n".join(blocks) if blocks else page.get_text().strip()
                chunks.append(f"## Seite {p1}\n\n{body}")
        joiner = "\n" if fmt == "txt" else "\n\n---\n\n"
        return joiner.join(chunks).strip() + "\n"
    finally:
        doc.close()


def export_text(work_path: str, expr: str, dest_dir: str, fmt: str = "txt",
                base_name: str = "text") -> dict:
    """§12: Text (txt/md) ganz oder als Bereich in eine neue Datei schreiben."""
    ext = ".txt" if fmt == "txt" else ".md"
    text = document_text(work_path, expr, fmt)
    dest = unique_filename(dest_dir, base_name, ext)
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write(text)
    return {"path": dest, "format": ext.lstrip("."), "bytes": len(text.encode("utf-8"))}


# --------------------------------------------------------------- Bilder -> PDF
def images_to_pdf(image_paths: list[str], dest_dir: str, page_size: str = "auto",
                  orientation: str = "auto", base_name: str = "converted") -> dict:
    """§12: Mehrere Bilder in EIN Dokument. page_size auto|a3|a4|letter|legal,
    orientation auto|portrait|landscape. 'auto' uebernimmt die Bildproportion."""
    if not image_paths:
        raise ExportError("Keine Bilddateien angegeben")
    if page_size != "auto" and page_size not in _PAPERS:
        raise ExportError(f"Ungueltiges Seitenformat '{page_size}'; erlaubt: auto, {', '.join(_PAPERS)}")
    if orientation not in ("auto", "portrait", "landscape"):
        raise ExportError("Orientierung muss auto, portrait oder landscape sein")
    doc = fitz.open()
    try:
        for p in image_paths:
            if not os.path.isfile(p):
                raise ExportError(f"Bilddatei nicht gefunden: {p}")
            pm = fitz.Pixmap(p)
            iw, ih = float(pm.width), float(pm.height)
            if page_size == "auto":
                w, h = (iw, ih) if orientation == "auto" else (
                    (max(iw, ih), min(iw, ih)) if orientation == "landscape" else (min(iw, ih), max(iw, ih)))
            else:
                w, h = _PAPERS[page_size]
                if orientation == "landscape":
                    w, h = h, w
            page = doc.new_page(width=w, height=h)
            page.insert_image(page.rect, filename=p, keep_proportion=True)
        dest = unique_filename(dest_dir, base_name, ".pdf")
        doc.save(dest, garbage=3, deflate=True)
    finally:
        doc.close()
    return {"path": dest, "pages": len(image_paths)}


# --------------------------------------------------------------- Komprimieren
def compress(work_path: str, dest_dir: str, target_dpi: int = 150, jpeg_quality: int = 60,
             base_name: Optional[str] = None) -> dict:
    """§12: Bilder-Downsampling + Dedupe + Objektstreams. Schreibt eine NEUE Datei
    (nie das Original ueberschreiben) und meldet vorher/nachher Groessen."""
    if not (0 <= jpeg_quality <= 100):
        raise ExportError("JPEG-Qualitaet muss zwischen 0 und 100 liegen")
    src_bytes = os.path.getsize(work_path)
    if not base_name:
        base_name = os.path.splitext(os.path.basename(work_path))[0] + "_optimiert"
    dest = unique_filename(dest_dir, base_name, ".pdf")
    doc = fitz.open(work_path)
    try:
        # Downsample nur bei ausreichend hoher Quell-DPI; lossy erhaelt Text scharf (nur Bilder).
        # Downsample nur Bilder, die dichter sind als das Ziel (rewrite_images verlangt
        # strikt dpi_target < dpi_threshold).
        doc.rewrite_images(dpi_threshold=max(73, target_dpi + 1), dpi_target=target_dpi,
                           quality=jpeg_quality, lossy=True)
        doc.save(dest, garbage=4, deflate=True, use_objstms=True, clean=True)
    finally:
        doc.close()
    out_bytes = os.path.getsize(dest)
    saved_pct = round(100.0 * (src_bytes - out_bytes) / src_bytes, 1) if src_bytes else 0.0
    return {"path": dest, "beforeBytes": src_bytes, "afterBytes": out_bytes,
            "savedPercent": saved_pct, "smaller": out_bytes < src_bytes}
