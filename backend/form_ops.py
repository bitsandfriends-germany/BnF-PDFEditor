"""AcroForm-Formularfelder (Section 11).

Erkennung + Ausfuellen auf der Arbeitskopie. XFA wird erkannt und gemeldet (XFA ist [OUT];
die App sagt es ausdruecklich, statt eine leere Seite zu zeigen). Rechtecke werden im
PDF-User-Space (unten-links) zurueckgegeben, konsistent mit Stempeln/Annotationen; der
Renderer rechnet sie in seine CSS-Position um.
"""
from __future__ import annotations

from typing import Any, Optional

import re
import pymupdf as fitz

import os

from backend import pdflib


def _atomic_save(doc: "fitz.Document", work_path: str) -> None:
    tmp = work_path + ".tmp"
    doc.save(tmp, garbage=3, deflate=True)
    doc.close()
    os.replace(tmp, work_path)


class FormError(Exception):
    """Fachlicher Fehler an einem Formularfeld (klare, handelbare Meldung)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
        self.code = "form_error"
        self.status_code = 422


_CHECKBOX = 2
_SIG = 6
_COMBO = 3
_LIST = 4
_RADIO = 5
_TEXT = 7
_F_RO = 1      # readOnly-Bit
_F_REQ = 2     # required-Bit
_F_MULTI = 4096  # multiline (Text)

_LABELS = {0: "Unknown", 1: "Button", 2: "CheckBox", 3: "ComboBox", 4: "ListBox", 5: "RadioButton", 6: "Signature", 7: "Text"}


def _hex_val(v: Any) -> str:
    return "" if v is None else (v if isinstance(v, str) else str(v))


def _display_value(w: "fitz.Widget") -> Any:
    """Normalisierter Wert: Checkbox -> bool, Radio/Combobox/Text -> String."""
    v = w.field_value
    if w.field_type == _CHECKBOX:
        return v in (True, "On", "Yes", "on", "yes")
    return _hex_val(v)


def _is_xfa(doc: "fitz.Document") -> bool:
    cat = doc.pdf_catalog()
    kind, val = doc.xref_get_key(cat, "AcroForm")
    if kind == "null" or not val:
        return False
    if kind == "dict":
        return "/XFA" in val
    try:  # AcroForm als xref-Referenz
        ax = int(val.split()[0])
        return doc.xref_get_key(ax, "XFA")[0] != "null"
    except (ValueError, IndexError):
        return False


def _has_acroform(doc: "fitz.Document") -> bool:
    return doc.xref_get_key(doc.pdf_catalog(), "AcroForm")[0] != "null"


def _widget_signed(doc: "fitz.Document", w: "fitz.Widget") -> bool:
    """R64: True, wenn das Signaturfeld einen Wert (/V) traegt. Der Wert ist ein
    indirektes /Sig-Objekt — MuPDF zeigt es im Widget-Wortlaut als '/V n n R'."""
    try:
        obj = doc.xref_object(w.xref)
        if re.search(r"/V\s+\d+\s+\d+\s+R", obj):
            return True
        # Feld-Dictionary (Parent) kann /V tragen
        try:
            rp = doc.xref_get_key(w.xref, "Parent")
            if rp[0] == "xref":
                m = re.search(r"(\d+)\s+\d+\s+R", rp[1])
                if m and re.search(r"/V\s+\d+\s+\d+\s+R", doc.xref_object(int(m.group(1)))):
                    return True
        except Exception:
            pass
        return False
    except Exception:
        return False


def list_form_fields(work_path: str) -> dict:
    try:
        doc = fitz.open(work_path)
    except Exception as exc:
        raise FormError(f"Dokument konnte nicht gelesen werden: {exc}") from exc
    try:
        fields: list[dict] = []
        for pno in range(doc.page_count):
            page = doc.load_page(pno)
            # R71: w.rect (Widget) liegt im UNGEDREHTEN PDF-User-Space, page.rect dagegen
            # enthaelt die Seitenrotation (/Rotate). Referenz muss die ungedrehte CropBox sein:
            # sonst rutscht ein Feld auf einer gedrehten Seite um die halbe Seitenhoehe, weil
            # die Anzeige die Drehung selbst anwendet (FormLayer in der gedrehten Huelle).
            box = page.cropbox
            ph = float(box.height)
            ox = float(box.x0)
            oy = float(box.y0)
            for w in page.widgets() or []:
                if not w.field_name:
                    continue
                r = w.rect
                fields.append({
                    "name": w.field_name,
                    "page": pno + 1,
                    "type": _LABELS.get(w.field_type, w.field_type_string or "Unknown"),
                    "value": _display_value(w),
                    "options": list(w.choice_values or []),
                    "required": bool(w.field_flags & _F_REQ),
                    "readOnly": bool(w.field_flags & _F_RO),
                    "multiline": bool(w.field_flags & _F_MULTI and w.field_type == _TEXT),
                    "fontSize": w.text_fontsize,
                    "maxLen": getattr(w, "text_maxlen", 0) or 0,
                    "rect": {
                        "x": float(r.x0) - ox,
                        "y": ph - (float(r.y1) - oy),
                        "width": float(r.width),
                        "height": float(r.height),
                    },
                    # R64: Unterzeichnet? (Widget-/Parent-/Sig auf Wert-/Feldebene)
                    "signed": _widget_signed(doc, w),
                })
        return {"hasAcroForm": _has_acroform(doc), "hasXfa": _is_xfa(doc), "count": len(fields), "fields": fields}
    finally:
        doc.close()


def _apply_value(w: "fitz.Widget", value: Any) -> None:
    if w.field_type == _SIG:
        # Ein Signaturfeld fuellen kann nur die Signaturfunktion.
        raise FormError("Signaturfelder koennen nicht gefuellt werden")
    if w.field_type == _CHECKBOX:
        if isinstance(value, str):
            checked = value.lower() in ("true", "on", "yes", "1")
        else:
            checked = bool(value)
        w.field_value = "On" if checked else "Off"
    elif w.field_type in (_COMBO, _LIST, _RADIO):
        w.field_value = "" if value is None else str(value)
    else:
        w.field_value = "" if value is None else str(value)


def set_field_value(work_path: str, name: str, value: Any) -> dict:
    if not name:
        raise FormError("Feldname fehlt.")
    try:
        doc = fitz.open(work_path)
    except Exception as exc:
        raise FormError(f"Dokument konnte nicht gelesen werden: {exc}") from exc
    try:
        for pno in range(doc.page_count):
            page = doc.load_page(pno)
            for w in page.widgets() or []:
                if w.field_name != name:
                    continue
                if w.field_flags & _F_RO:
                    raise FormError(f"Feld '{name}' ist schreibgeschuetzt.")
                _apply_value(w, value)
                w.update()
                shown = _display_value(w)  # vor dem Speichern abgreifen (danach ist der Doc geschlossen)
                _atomic_save(doc, work_path)
                return {"name": name, "value": shown}
        raise FormError(f"Feld '{name}' wurde nicht gefunden.")
    except FormError:
        raise
    except Exception as exc:
        raise FormError(f"Feld '{name}' konnte nicht gesetzt werden: {exc}") from exc


def reset_form(work_path: str, names: Optional[list[str]] = None) -> dict:
    """Alle (oder benannte) Felder auf ihren Default (/DV) zuruecksetzen; ohne /DV -> leer."""
    try:
        doc = fitz.open(work_path)
    except Exception as exc:
        raise FormError(f"Dokument konnte nicht gelesen werden: {exc}") from exc
    try:
        want = None if not names else set(names)
        reset = 0
        for pno in range(doc.page_count):
            page = doc.load_page(pno)
            for w in page.widgets() or []:
                if not w.field_name or (want is not None and w.field_name not in want):
                    continue
                if w.field_flags & _F_RO:
                    continue
                if w.field_type == _SIG:
                    continue  # Signaturfelder haben keinen zuruecksetzbaren Wert
                kind, dv = doc.xref_get_key(w.xref, "DV")
                if kind == "null":
                    _apply_value(w, "Off" if w.field_type == _CHECKBOX else "")
                else:
                    _apply_value(w, dv.strip("()") if isinstance(dv, str) else dv)
                w.update()
                reset += 1
        if reset == 0 and want:
            raise FormError("Keines der angegebenen Felder war zuruecksetzbar.")
        _atomic_save(doc, work_path)
        return {"reset": reset}
    except FormError:
        raise
    except Exception as exc:
        raise FormError(f"Formular konnte nicht zurueckgesetzt werden: {exc}") from exc
