"""Read-only PDF outline / bookmarks for the outline panel (functional scope, Section 5).

PyMuPDFs `get_toc()` liefert [Ebene, Titel, Seite] mit 1-basierten Seitenzahlen. Das Panel ist in
V1 bewusst read-only; das Bearbeiten (V1.1) und die KI-generierte Gliederung schreiben dieselbe
Struktur. Keine erfundenen Eintraege: leere Gliederung -> leere Liste.
"""
from __future__ import annotations

import pymupdf as fitz

from backend.pdflib import PdfError


class OutlineError(PdfError):
    code = "outline_error"
    status = 422


def get_outline(work_path: str) -> dict:
    """Gliederung des Dokuments als Liste {level, title, page} (Seite 1-basiert)."""
    try:
        doc = fitz.open(work_path)
    except Exception as exc:
        raise OutlineError(f"Dokument konnte nicht gelesen werden: {exc}") from exc
    try:
        raw = doc.get_toc(simple=True)
    except Exception as exc:
        raise OutlineError(f"Gliederung konnte nicht gelesen werden: {exc}") from exc
    finally:
        doc.close()
    outline = []
    for item in raw:
        try:
            level, title, page = item[0], item[1], item[2]
        except (IndexError, TypeError):
            continue
        if isinstance(page, dict):  # simplified=False Variante absichern
            page = page.get("n", 0)
        try:
            page_i = int(page)
        except (TypeError, ValueError):
            continue
        outline.append({"level": int(level), "title": str(title), "page": page_i})
    return {"outline": outline, "count": len(outline)}
