"""Visuelle Signatur-Bibliothek (SYSTEM PROMPT PART 2, Section 9).

Speicher unter ~/.local/share/pdf-editor/signatures/ (ueberbar via PDF_EDITOR_SIG_DIR fuer
Tests). Das VERZEICHNIS ist der Index: jedes Signatur-Objekt ist eine Bilddatei `<id>.<ext>`
plus eine gleichnamige Seite `<id>.json` (Name, Standardgroesse in pt, Standarddeckkraft,
Erstellungsdatum). Es wird KEINE Index-Datei gepflegt - der Nutzer kann Dateien von Hand
hinzufuegen/entfernen, und die Anwendung pickt das hoch.

Bilder werden beim Import IN das Verzeichnis KOPIERT, nie nur referenziert - eine Signatur,
die kaputtgeht, weil der Nutzer die Quelldatei verschoben hat, ist ein vermeidbarer Fehler.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import time
import uuid
from typing import Optional

import pymupdf as fitz

_EXT_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml"}
_ALLOWED_EXT = set(_EXT_MIME)


def sig_dir() -> str:
    d = os.environ.get("PDF_EDITOR_SIG_DIR")
    if not d:
        d = os.path.join(os.path.expanduser("~"), ".local", "share", "pdf-editor", "signatures")
    os.makedirs(d, exist_ok=True)
    return d


class SignatureLibError(Exception):
    code = "signature_lib_error"
    status = 422


def _meta_path(d: str, sid: str) -> str:
    return os.path.join(d, sid + ".json")


def _find_image(d: str, sid: str) -> Optional[str]:
    for ext in _ALLOWED_EXT:
        p = os.path.join(d, sid + ext)
        if os.path.isfile(p):
            return p
    return None


def list_signatures() -> dict:
    d = sig_dir()
    out = []
    for fname in sorted(os.listdir(d)):
        if not fname.endswith(".json"):
            continue
        sid = fname[:-5]
        img = _find_image(d, sid)
        meta = {}
        try:
            with open(_meta_path(d, sid), encoding="utf-8") as fh:
                meta = json.load(fh)
        except Exception:
            meta = {}
        out.append({
            "id": sid,
            "name": meta.get("name") or sid,
            "fileName": os.path.basename(img) if img else None,
            "defaultSizePt": meta.get("defaultSizePt", 160),
            "defaultOpacity": meta.get("defaultOpacity", 1.0),
            "createdAt": meta.get("createdAt"),
            "mime": _EXT_MIME.get(os.path.splitext(img)[1]) if img else None,
            "hasImage": img is not None,
        })
    out.sort(key=lambda x: x.get("createdAt") or "", reverse=True)
    return {"signatures": out, "dir": d}


def _write_meta(d: str, sid: str, name: str, size_pt: float, opacity: float) -> dict:
    meta = {"name": name, "defaultSizePt": float(size_pt), "defaultOpacity": float(opacity),
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    with open(_meta_path(d, sid), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    return meta


def import_signature_bytes(name: str, image_bytes: bytes, ext: str,
                           size_pt: float = 160, opacity: float = 1.0) -> dict:
    """Import aus Bytes (Upload, Canvas-Drawing oder gerenderter Text)."""
    ext = ext.lower()
    if ext not in _ALLOWED_EXT:
        raise SignatureLibError(f"Ungueltiges Bildformat '{ext}'; erlaubt: {', '.join(sorted(_ALLOWED_EXT))}")
    if not image_bytes:
        raise SignatureLibError("Bilddaten sind leer")
    if not (0.0 <= opacity <= 1.0):
        raise SignatureLibError("Deckkraft muss zwischen 0 und 1 liegen")
    d = sig_dir()
    sid = uuid.uuid4().hex
    with open(os.path.join(d, sid + ext), "wb") as fh:
        fh.write(image_bytes)  # KOPIERT in die Bibliothek, nie Referenz
    meta = _write_meta(d, sid, name or "Signatur", size_pt, opacity)
    return {"id": sid, "mime": _EXT_MIME[ext], **meta}


def import_signature_file(name: str, src_path: str, size_pt: float = 160, opacity: float = 1.0) -> dict:
    """§9: Bild-datei importieren; wird in die Bibliothek KOPIERT."""
    if not os.path.isfile(src_path):
        raise SignatureLibError(f"Datei nicht gefunden: {src_path}")
    ext = os.path.splitext(src_path)[1].lower()
    if ext not in _ALLOWED_EXT:
        raise SignatureLibError(f"Ungueltiges Bildformat '{ext}'; erlaubt: {', '.join(sorted(_ALLOWED_EXT))}")
    d = sig_dir()
    sid = uuid.uuid4().hex
    shutil.copy2(src_path, os.path.join(d, sid + ext))
    meta = _write_meta(d, sid, name or "Signatur", size_pt, opacity)
    return {"id": sid, "mime": _EXT_MIME[ext], **meta}


def text_to_png(text: str, fontname: str = "helv", fontsize: float = 64,
                color: str = "#000000", padding: float = 20) -> bytes:
    """§9 Quelle 'getippter Name': rendert Text als TRANSPARENTES PNG.
    Hinweis: nur Base-14-Schriften; eine echte Handschrift-Schrift waere ein Bundle und ist
    hier bewusst nicht enthalten (Stack-Policy). Die Form ist trotzdem nutzbar."""
    if not text.strip():
        raise SignatureLibError("Text ist leer")
    w = int(fitz.get_text_length(text, fontname=fontname, fontsize=fontsize) + 2 * padding)
    h = int(fontsize * 1.6 + 2 * padding)
    doc = fitz.open()
    try:
        page = doc.new_page(width=max(w, 1), height=max(h, 1))
        rgb = tuple(int(color.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)) if color else (0, 0, 0)
        page.insert_text((padding, h - padding - fontsize * 0.3), text,
                         fontname=fontname, fontsize=fontsize, color=rgb)
        pix = page.get_pixmap(alpha=True)  # Hintergrund transparent, nur Text undicht
        return pix.tobytes("png")
    finally:
        doc.close()


def read_signature_image(sid: str) -> tuple[bytes, str]:
    d = sig_dir()
    img = _find_image(d, sid)
    if not img:
        raise SignatureLibError(f"Signatur nicht gefunden: {sid}")
    with open(img, "rb") as fh:
        data = fh.read()
    return data, _EXT_MIME[os.path.splitext(img)[1]]


def delete_signature(sid: str) -> dict:
    d = sig_dir()
    removed = False
    for p in (_find_image(d, sid), _meta_path(d, sid)):
        if p and os.path.isfile(p):
            os.remove(p)
            removed = True
    if not removed:
        raise SignatureLibError(f"Signatur nicht gefunden: {sid}")
    return {"deleted": sid}
