"""Echte Roteierung (SYSTEM PROMPT PART 2, Section 10).

Zweistufig: (1) Regionen markieren (Renderer haelt die Liste; optional `preview_redaction`
zum Pruefen WELCHE Strings betroffen sind), (2) `apply_redaction` ENTFERNT den
unterliegenden Inhalt - Text, Bilddaten und Annotationen in der Region - und zeichnet die
Schwaerzungsbox. Ein schwarzes Rechteck ueber lebendem Text ist KEINE Roteierung und wird
hier nie erzeugt. Danach laeuft ein Verifikationslauf, der die betroffenen Seiten neu
extrahiert und meldet, ob die erfassten Strings wirklich weg sind.

Roteierung ist irreversibel; der Router leert anschiessend den Undo-Stack (session.reset()).
Regionen kommen als PDF-User-Space (unten-links), dieselbe Konvention wie beim Stempel.
"""
from __future__ import annotations

import os
import tempfile
from typing import Optional

import pymupdf as fitz

from backend.pdflib import BadPage


class RedactError(Exception):
    code = "redact_error"
    status = 422


_IMAGES = {
    "pixels": fitz.PDF_REDACT_IMAGE_PIXELS,
    "remove": fitz.PDF_REDACT_IMAGE_REMOVE,
    "none": fitz.PDF_REDACT_IMAGE_NONE,
}


def _fitz_rect(page: "fitz.Page", r: dict) -> "fitz.Rect":
    for k in ("x", "y", "width", "height"):
        if k not in r:
            raise RedactError(f"Regionsfeld '{k}' fehlt")
    w = float(r["width"]); h = float(r["height"])
    if w <= 0 or h <= 0:
        raise RedactError("Region muss positive Breite und Hoehe haben")
    H = float(page.rect.height)
    x = float(r["x"]); y = float(r["y"])
    return fitz.Rect(x, H - (y + h), x + w, H - y)


def _validate(doc: "fitz.Document", regions: list[dict]) -> None:
    if not regions:
        raise RedactError("Keine Roteierungsregionen angegeben")
    n = doc.page_count
    for i, r in enumerate(regions):
        p1 = int(r.get("page", 0))
        if not (1 <= p1 <= n):
            raise BadPage(f"Region {i + 1}: Seite {p1} ausserhalb des Bereichs 1-{n}")


def _captured_tokens(page: "fitz.Page", rect: "fitz.Rect") -> list[str]:
    """Woerter (>= 3 Zeichen), die ganz in der Region liegen - die Verifikationsliste."""
    toks = []
    for wd in page.get_text("words", clip=rect):
        t = wd[4].strip()
        if len(t) >= 3:
            toks.append(t)
    return toks


def preview_redaction(work_path: str, regions: list[dict]) -> dict:
    """Nicht-mutierend: zeigt, WELCHE Strings die Regionen erfassen (Review vor dem Anwenden)."""
    doc = fitz.open(work_path)
    try:
        _validate(doc, regions)
        by_page: dict[int, list[str]] = {}
        for r in regions:
            p1 = int(r["page"])
            page = doc.load_page(p1 - 1)
            by_page.setdefault(p1, [])
            for t in _captured_tokens(page, _fitz_rect(page, r)):
                if t not in by_page[p1]:
                    by_page[p1].append(t)
        return {"willRedact": [{"page": p, "strings": s} for p, s in sorted(by_page.items())]}
    finally:
        doc.close()


def apply_redaction(work_path: str, regions: list[dict], fill: Optional[list[float]] = None,
                    images: str = "pixels") -> dict:
    """Entfernt Inhalt in den Regionen endgueltig, zeichnet die Box und verifiziert."""
    if images not in _IMAGES:
        raise RedactError(f"Unbekannter Bildmodus '{images}'; erlaubt: {', '.join(_IMAGES)}")
    fillc = tuple(fill) if fill else (0.0, 0.0, 0.0)
    doc = fitz.open(work_path)
    try:
        _validate(doc, regions)
        affected = sorted({int(r["page"]) for r in regions})
        # 1) betroffene Woerter VOR der Roteierung erfassen (Pro-Seite)
        captured: dict[int, list[str]] = {p: [] for p in affected}
        for r in regions:
            p1 = int(r["page"])
            page = doc.load_page(p1 - 1)
            for t in _captured_tokens(page, _fitz_rect(page, r)):
                if t not in captured[p1]:
                    captured[p1].append(t)
        # 2) Redact-Annots setzen und je betroffener Seite anwenden
        for r in regions:
            page = doc.load_page(int(r["page"]) - 1)
            page.add_redact_annot(_fitz_rect(page, r), fill=fillc)
        for p1 in affected:
            doc.load_page(p1 - 1).apply_redactions(
                images=_IMAGES[images],
                graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
                text=fitz.PDF_REDACT_TEXT_REMOVE,
            )
        # 3) atomar speichern
        d = os.path.dirname(work_path)
        fd, tmp = tempfile.mkstemp(prefix=".redact-", suffix=".pdf", dir=d)
        os.close(fd)
        try:
            doc.save(tmp, garbage=3, deflate=True)
            os.replace(tmp, work_path)
        except Exception:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise
    finally:
        doc.close()

    # 4) Verifikationslauf: betroffenen Text neu extrahieren, Pruefen dass Strings weg sind
    removed: list[str] = []
    remaining: list[str] = []
    vdoc = fitz.open(work_path)
    try:
        for p1 in affected:
            txt = vdoc.load_page(p1 - 1).get_text()
            low = txt.lower()
            for t in captured.get(p1, []):
                (remaining if t.lower() in low else removed).append(t)
    finally:
        vdoc.close()
    return {
        "appliedPages": affected,
        "captured": {str(p): captured[p] for p in affected},
        "removed": removed,
        "remaining": remaining,
        "verified": len(remaining) == 0,
    }
