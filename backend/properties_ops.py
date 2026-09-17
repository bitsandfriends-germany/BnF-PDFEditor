"""Read-only document properties for the properties panel (functional scope, Section 4).

Nur Fakten, die die Bibliothek wirklich liefert — keine erfundenen Werte. Lineareisung wird per
pikepdf ERKANNT (is_linearized); das Erzeugen bleibt Konflikt C3. Fonts werden seitenuebergreifend
aggregiert; 'embedded' ueber den extrahierten Font-Content bestimmt (leer -> nicht eingebettet).
"""
from __future__ import annotations

import os
from typing import Optional

import pymupdf as fitz

from backend.pdflib import PdfError


class PropertiesError(PdfError):
    code = "properties_error"
    status = 422


def _fmt_dates(md: dict) -> dict:
    # PDF-Datumsstrings 'D:YYYYMMDDHHmmSS...' -> ISO-artig, leer wenn nicht gesetzt.
    def norm(v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        s = v[2:] if v.startswith("D:") else v
        return s or None
    return {"creationDate": norm(md.get("creationDate")), "modDate": norm(md.get("modDate"))}


def _has_javascript(doc: fitz.Document) -> bool:
    # Katalog/Seiten nach /JavaScript durchsuchen (guenstig: nur xref-Objektstrings).
    try:
        n = doc.xref_length()
    except Exception:
        return False
    for x in range(1, n):
        try:
            s = doc.xref_object(x, compressed=True)
        except Exception:
            continue
        if "/JavaScript" in s or "/JS" in s:
            return True
    return False


def collect_properties(work_path: str, original_path: Optional[str], page1: int) -> dict:
    if not os.path.isfile(work_path):
        raise PropertiesError("Arbeitskopie nicht gefunden.")
    try:
        doc = fitz.open(work_path)
    except Exception as e:
        raise PropertiesError(f"Dokument konnte nicht gelesen werden: {e}")
    try:
        n = doc.page_count
        p = min(max(1, page1), max(1, n))
        pg = doc[p - 1] if n > 0 else None
        rect = pg.rect if pg else None
        rot = pg.rotation if pg else 0

        # Font-Aggregation seitenuebergreifend, dedupliziert nach Basisname+xref.
        seen: dict = {}
        for i in range(n):
            try:
                fonts = doc[i].get_fonts(full=True)
            except Exception:
                fonts = []
            for f in fonts:
                xref = f[0]
                if xref in seen:
                    continue
                embedded = False
                try:
                    _b, _ext, _typ, content = doc.extract_font(xref)
                    embedded = bool(content)
                except Exception:
                    embedded = False
                seen[xref] = {"name": f[3], "type": f[2], "embedded": embedded}
        fonts_out = sorted(seen.values(), key=lambda d: (str(d["name"] or ""), d["embedded"]))

        md = doc.metadata or {}
        has_forms = False
        try:
            has_forms = doc.xref_get_key(doc.pdf_catalog(), "AcroForm")[0] != "null"
        except Exception:
            has_forms = False

        linearized: Optional[bool] = None
        tagged = False
        try:
            import pikepdf
            with pikepdf.open(work_path, allow_overwriting_input=False) as _pdf:
                linearized = bool(_pdf.is_linearized)
                mark = _pdf.Root.get("/MarkInfo")
                if mark is not None:
                    try:
                        tagged = bool(mark.get("/Marked", False))
                    except Exception:
                        tagged = False
        except Exception:
            linearized = None

        size = None
        try:
            src = original_path or work_path
            if src and os.path.isfile(src):
                size = os.path.getsize(src)
        except Exception:
            size = None

        return {
            "fileSizeBytes": size,
            "pageCount": n,
            "pdfVersion": (md.get("format") or "").replace("PDF", "").strip() or None,
            "producer": md.get("producer") or None,
            "creator": md.get("creator") or None,
            **_fmt_dates(md),
            "currentPage": p if n > 0 else None,
            "pageWidth": round(rect.width, 1) if rect else None,
            "pageHeight": round(rect.height, 1) if rect else None,
            "pageRotation": rot,
            "encrypted": bool(doc.is_encrypted),
            "encryptionAlgorithm": md.get("encryption") or None,
            "permissions": int(doc.permissions) if doc.permissions is not None else None,
            "linearized": linearized,
            "tagged": tagged,
            "hasForms": has_forms,
            "attachmentCount": int(doc.embfile_count()),
            "hasJavaScript": _has_javascript(doc),
            "fonts": fonts_out,
        }
    finally:
        doc.close()
