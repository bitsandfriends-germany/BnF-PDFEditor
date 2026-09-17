"""Annotationen aufzählen und entfernen (funktionale Sektion 8).

Die Liste ist das Rueckgrat eines brauchbaren Review-Werkzeugs: jede Annotation mit Seite,
Typ, Autor, Datum und Text. Entfernen wirkt auf einen Seitenbereich (geteilter §3-Parser,
mengenbasiert, da Reihenfolge-unabhaengig). Alle Mutationen laufen ueber die Session + das
Signatur-Gate; das Entfernen ist ein rueckgaengiger Command (Snapshot vorher).
"""
from __future__ import annotations

import os
from typing import Optional

import pymupdf as fitz

from backend.pages import parse_page_range_set
from backend.pdflib import PdfError


class AnnotationError(PdfError):
    code = "annotation_error"
    status = 422


def _safe(d, key: str) -> str:
    v = d.get(key) if isinstance(d, dict) else None
    return str(v) if v else ""


def list_annotations(work_path: str) -> dict:
    """Alle Annotationen des Dokuments (Seite 1-basiert), in Lesereihenfolge."""
    try:
        doc = fitz.open(work_path)
    except Exception as exc:
        raise AnnotationError(f"Dokument konnte nicht gelesen werden: {exc}") from exc
    out = []
    try:
        n = doc.page_count
        for p in range(n):
            page = doc.load_page(p)
            idx = 0
            for a in page.annots() or []:
                info = a.info or {}
                try:
                    type_name = a.type[1] if isinstance(a.type, tuple) and len(a.type) > 1 else "Unknown"
                except Exception:
                    type_name = "Unknown"
                out.append({
                    "id": f"{p + 1}:{idx}",
                    "page": p + 1,
                    "type": type_name,
                    "author": _safe(info, "title") or _safe(info, "name"),
                    "date": _safe(info, "creationDate") or _safe(info, "modDate"),
                    "text": _safe(info, "content") or _safe(info, "subject"),
                })
                idx += 1
    finally:
        doc.close()
    return {"annotations": out, "count": len(out)}


def _atomic_save(doc, work_path: str) -> None:
    tmp = work_path + ".tmp"
    doc.save(tmp, garbage=3, deflate=True)
    doc.close()
    os.replace(tmp, work_path)


def remove_annotations(work_path: str, expr: Optional[str]) -> dict:
    """Alle Annotationen auf den Seiten des Bereichs entfernen. expr=None -> alle Seiten."""
    try:
        doc = fitz.open(work_path)
    except Exception as exc:
        raise AnnotationError(f"Dokument konnte nicht gelesen werden: {exc}") from exc
    try:
        n = doc.page_count
        pages = sorted(parse_page_range_set(expr or "all", n)) if n else []
        removed = 0
        for p1 in pages:
            page = doc.load_page(p1 - 1)
            ann = list(page.annots() or [])
            for a in ann:
                try:
                    page.delete_annot(a)
                    removed += 1
                except Exception:
                    # Einzelne nicht loeschbare Annotation ueberspringen, nicht abbrechen.
                    continue
        _atomic_save(doc, work_path)
        return {"removed": removed}
    except PdfError:
        raise
    except Exception as exc:
        raise AnnotationError(f"Annotationen konnten nicht entfernt werden: {exc}") from exc

# Erlaubte Anlege-Typen (Section 8 V1-Grundmenge): Klebezettel, Freitext, Text-Markup.
_MARKUP = {"Highlight", "Underline", "StrikeOut", "Squiggly"}
_ADDABLE = {"Text", "FreeText"} | _MARKUP


def _hex_to_rgb(color: Optional[str]):
    """'#rrggbb' -> (r,g,b) in 0..1; Fallback schwarz. Transparente/leere Werte toleriert."""
    if not color or not color.startswith("#") or len(color) != 7:
        return (0.0, 0.0, 0.0)
    try:
        return tuple(int(color[i:i + 2], 16) / 255.0 for i in (1, 3, 5))
    except ValueError:
        return (0.0, 0.0, 0.0)


def add_annotation(work_path: str, *, page: int, annot_type: str, rect, text: str = "",
                   color: Optional[str] = None, opacity: float = 1.0, author: str = "",
                   fontsize: float = 12.0) -> dict:
    """Neue Annotation auf einer Seite anlegen (rect = PDF-User-Space, unten-links). Rueckgabe der
    neu angelegten Annotation (id/seitentyp/autor/text) fuer die sofortige Listenaktualisierung."""
    if annot_type not in _ADDABLE:
        raise AnnotationError(f"Unbekannter Annotationstyp '{annot_type}'; erlaubt: {', '.join(sorted(_ADDABLE))}")
    try:
        doc = fitz.open(work_path)
    except Exception as exc:
        raise AnnotationError(f"Dokument konnte nicht gelesen werden: {exc}") from exc
    try:
        n = doc.page_count
        if page < 0 or page >= n:
            raise AnnotationError(f"Seite {page + 1} ausserhalb des Bereichs 1-{n}.")
        target = doc.load_page(page)
        # Eingang ist PDF-User-Space (unten-links, wie Overlay/Stempel); fitz rechnet oben-links.
        ph = float(target.rect.height)
        x, y = float(rect["x"]), float(rect["y"])
        w, h = float(rect.get("width", 0)), float(rect.get("height", 0))
        w = max(w, 1.0)
        h = max(h, 1.0)
        fitz_rect = fitz.Rect(x, ph - (y + h), x + w, ph - y)
        rgb = _hex_to_rgb(color)
        op = max(0.0, min(1.0, float(opacity)))
        try:
            if annot_type == "Text":
                a = target.add_text_annot((x, ph - y), text)
            elif annot_type == "FreeText":
                a = target.add_freetext_annot(fitz_rect, text, fontsize=fontsize)
            elif annot_type == "Highlight":
                a = target.add_highlight_annot(fitz_rect)
            elif annot_type == "Underline":
                a = target.add_underline_annot(fitz_rect)
            elif annot_type == "StrikeOut":
                a = target.add_strikeout_annot(fitz_rect)
            elif annot_type == "Squiggly":
                a = target.add_squiggly_annot(fitz_rect)
            else:  # pragma: no cover - durch Whitelist abgedeckt
                raise AnnotationError(f"Typ '{annot_type}' wird nicht unterstuetzt.")
            if annot_type == "FreeText":
                try:
                    a.set_colors(fill=rgb, stroke=rgb)
                except Exception:
                    pass
            elif annot_type != "Text":  # Markup + Linien: Strichfarbe = gewaehlte Farbe
                try:
                    a.set_colors(stroke=rgb)
                except Exception:
                    pass
            try:
                a.set_opacity(op)
            except Exception:
                pass
            a.set_info(title=author or "", content=text or "")
            a.update()
        except AnnotationError:
            raise
        except Exception as exc:
            raise AnnotationError(f"Annotation '{annot_type}' konnte nicht angelegt werden: {exc}") from exc
        # Index + Zusammenfassung VOR dem Speichern erheben (danach ist der Doc geschlossen).
        info = a.info or {}
        idx = max(0, sum(1 for _ in (target.annots() or [])) - 1)
        _atomic_save(doc, work_path)
        return {
            "id": f"{page + 1}:{idx}",
            "page": page + 1,
            "type": annot_type,
            "author": _safe(info, "title"),
            "date": _safe(info, "creationDate") or _safe(info, "modDate"),
            "text": _safe(info, "content") or _safe(info, "subject"),
        }
    except PdfError:
        raise
    except AnnotationError:
        raise
    except Exception as exc:
        raise AnnotationError(f"Annotation konnte nicht angelegt werden: {exc}") from exc

# --- Einzelne Annotation bearbeiten (Section 8: select, move, resize, restyle, delete) ---

def _resolve(doc, ann_id: str):
    """id '{seite}:{index}' (Seite 1-basiert, Index ueber page.annots()) -> (page, annot)."""
    try:
        page_str, idx_str = str(ann_id).split(":")
        p = int(page_str) - 1
        idx = int(idx_str)
    except (ValueError, AttributeError):
        raise AnnotationError(f"Ungueltige Annotations-ID '{ann_id}'.")
    if p < 0 or p >= doc.page_count:
        raise AnnotationError(f"Seite {p + 1} ausserhalb des Bereichs 1-{doc.page_count}.")
    page = doc.load_page(p)
    anns = list(page.annots() or [])
    if idx < 0 or idx >= len(anns):
        raise AnnotationError("Annotation nicht gefunden (evtl. verschoben oder geloescht).")
    return page, anns[idx]


def _rgb_to_hex(rgb) -> Optional[str]:
    if not rgb or not isinstance(rgb, (tuple, list)) or len(rgb) < 3:
        return None
    try:
        return "#%02x%02x%02x" % tuple(max(0, min(255, int(round(float(c) * 255)))) for c in rgb[:3])
    except (ValueError, TypeError):
        return None


def _annot_rect_bottom_left(page, a) -> dict:
    ph = float(page.rect.height)
    r = a.rect
    return {"x": float(r.x0), "y": ph - float(r.y1), "width": float(r.width), "height": float(r.height)}


def _summary(page, a, ann_id: str) -> dict:
    info = a.info or {}
    try:
        type_name = a.type[1] if isinstance(a.type, tuple) and len(a.type) > 1 else "Unknown"
    except Exception:
        type_name = "Unknown"
    colors = getattr(a, "colors", None) or {}
    # PyMuPDF liefert je nach Version 'stroke'/'fill' oder 'st'/'fl'.
    stroke = colors.get("stroke") or colors.get("st")
    fill = colors.get("fill") or colors.get("fl")
    color = _rgb_to_hex(stroke) or _rgb_to_hex(fill)
    try:
        op = float(a.opacity) if a.opacity and a.opacity > 0 else 1.0
    except Exception:
        op = 1.0
    return {
        "id": ann_id,
        "page": page.number + 1,
        "type": type_name,
        "text": _safe(info, "content") or _safe(info, "subject"),
        "author": _safe(info, "title") or _safe(info, "name"),
        "date": _safe(info, "creationDate") or _safe(info, "modDate"),
        "color": color,
        "opacity": op,
        "rect": _annot_rect_bottom_left(page, a),
    }


def get_annotation(work_path: str, ann_id: str) -> dict:
    try:
        doc = fitz.open(work_path)
    except Exception as exc:
        raise AnnotationError(f"Dokument konnte nicht gelesen werden: {exc}") from exc
    try:
        page, a = _resolve(doc, ann_id)
        return _summary(page, a, ann_id)
    finally:
        doc.close()


def edit_annotation(work_path: str, ann_id: str, *, text=None, author=None, color=None,
                    opacity=None, rect=None) -> dict:
    """Bewegt/resized (rect = PDF-User-Space unten-links, absolut), restylt (color/opacity) und/oder
    aendert Text/Autor. Nur uebergebene Felder werden geaendert. Rueckgabe der aktualisierten Zusammenfassung."""
    try:
        doc = fitz.open(work_path)
    except Exception as exc:
        raise AnnotationError(f"Dokument konnte nicht gelesen werden: {exc}") from exc
    try:
        page, a = _resolve(doc, ann_id)
        ph = float(page.rect.height)
        try:
            if rect is not None:
                x = float(rect["x"]); y = float(rect["y"])
                w = max(float(rect.get("width", 1)), 1.0)
                h = max(float(rect.get("height", 1)), 1.0)
                a.set_rect(fitz.Rect(x, ph - (y + h), x + w, ph - y))
            if color:
                rgb = _hex_to_rgb(color)
                try:
                    a.set_colors(stroke=rgb, fill=rgb)
                except Exception:
                    a.set_colors(stroke=rgb)
            if opacity is not None:
                try:
                    a.set_opacity(max(0.0, min(1.0, float(opacity))))
                except Exception:
                    pass
            if text is not None or author is not None:
                info = dict(a.info or {})
                if text is not None:
                    info["content"] = text
                if author is not None:
                    info["title"] = author
                a.set_info(info)
            a.update()
        except AnnotationError:
            raise
        except Exception as exc:
            raise AnnotationError(f"Annotation konnte nicht bearbeitet werden: {exc}") from exc
        summ = _summary(page, a, ann_id)
        _atomic_save(doc, work_path)
        return summ
    except AnnotationError:
        raise
    except PdfError:
        raise
    except Exception as exc:
        raise AnnotationError(f"Annotation konnte nicht bearbeitet werden: {exc}") from exc


def delete_annotation(work_path: str, ann_id: str) -> dict:
    try:
        doc = fitz.open(work_path)
    except Exception as exc:
        raise AnnotationError(f"Dokument konnte nicht gelesen werden: {exc}") from exc
    try:
        page, a = _resolve(doc, ann_id)
        try:
            page.delete_annot(a)
        except Exception as exc:
            raise AnnotationError(f"Annotation konnte nicht geloescht werden: {exc}") from exc
        _atomic_save(doc, work_path)
        return {"deleted": 1}
    except AnnotationError:
        raise
    except PdfError:
        raise
    except Exception as exc:
        raise AnnotationError(f"Annotation konnte nicht geloescht werden: {exc}") from exc

