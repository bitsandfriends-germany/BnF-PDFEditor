"""Sanitise, Metadaten-Scrub und Flatten (SYSTEM PROMPT PART 2, Section 10 + 7).

Alle drei mutieren die Arbeitskopie und sind Commands (Snapshot + Undo im Router).

Sanitise entfernt eingebettetes JavaScript, eingebettete Dateien, Launch-Aktionen und
JS-/Launch-Aktionsreferenzen und zAEHLT, was gefunden und entfernt wurde (Section 10:
"listing what was found and removed"). Interne GoTo-Links und URI-Links bleiben erhalten.

Metadaten-Scrub entfernt Autor/Producer/Erstellungs- und Aenderungsdaten UND den XMP-Stream.

Flatten brennt Annotationen und Formularfelder in den Seiteninhalt (bake) - Kategorie fuer
Kategorie, damit Stempel (die schon Inhalt sind) getrennt behandelt werden koennen.
"""
from __future__ import annotations

import os
import tempfile
from typing import Optional

import pikepdf
import pymupdf as fitz
from pikepdf import Name

from backend.pdflib import PdfError


class SecurityError(PdfError):
    code = "security_error"
    status = 422


def _is_dict(o) -> bool:
    try:
        o.keys()
        return True
    except Exception:
        return False


def _atomic_replace(save_fn, work_path: str) -> None:
    d = os.path.dirname(work_path)
    fd, tmp = tempfile.mkstemp(prefix=".sec-", suffix=".pdf", dir=d)
    os.close(fd)
    try:
        save_fn(tmp)
        os.replace(tmp, work_path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def _action_category(v) -> Optional[str]:
    """Ist dieser (moeglicherweise aufgeloeste) Wert eine JS-/Launch-Aktion?"""
    try:
        s = v.get("/S") if _is_dict(v) else None
    except Exception:
        return None
    if s == Name("/JavaScript"):
        return "javascript"
    if s == Name("/Launch"):
        return "launch"
    # /AA enthaelt event->aktion-Dicts: Kindkinder pruefen
    if _is_dict(v) and s is None:
        try:
            for k in list(v.keys()):
                sub = _action_category(v.get(k))
                if sub:
                    return sub
        except Exception:
            pass
    return None


def sanitize(work_path: str) -> dict:
    """Entfernt JS / eingebettete Dateien / Launch-Aktionen; meldet Zaehlungen."""
    found = {"javascript": 0, "embeddedFiles": 0, "launchActions": 0}

    def _do_save(tmp: str) -> None:
        pdf = pikepdf.Pdf.open(work_path)
        try:
            root = pdf.Root
            # Root.Names: /JavaScript und /EmbeddedFiles entfernen
            names = root.get("/Names")
            if _is_dict(names):
                for key, cat in (("/JavaScript", "javascript"), ("/EmbeddedFiles", "embeddedFiles")):
                    if key in names:
                        del names[key]
                        found[cat] += 1
            # Root /OpenAction
            if "/OpenAction" in root:
                cat = _action_category(root.get("/OpenAction"))
                if cat:
                    found[cat if cat != "launch" else "launchActions"] += 1
                    del root["/OpenAction"]
            # Ueber alle Objekte: Action-/JS-Schluessel und Eingebettete-Datei-Stroeme
            for obj in pdf.objects:
                try:
                    if obj.get("/Type") == Name("/EmbeddedFile"):
                        found["embeddedFiles"] += 1
                except Exception:
                    pass
                if not _is_dict(obj):
                    continue
                for key in ("/AA", "/OpenAction", "/JavaScript", "/JS", "/A"):
                    try:
                        if key not in obj:
                            continue
                    except Exception:
                        continue
                    cat = _action_category(obj.get(key))
                    if cat:
                        found[cat if cat != "launch" else "launchActions"] += 1
                        try:
                            del obj[key]
                        except Exception:
                            pass
            # JS-Anzeigename im Names-Baum kann geleert zurueckbleiben; Speichern reicht.
            pdf.save(tmp)
        finally:
            pdf.close()

    _atomic_replace(_do_save, work_path)
    total = sum(found.values())
    return {"removed": found, "total": total, "clean": total == 0}


def scrub_metadata(work_path: str) -> dict:
    """Entfernt Docinfo-Autor/Producer/Daten und den XMP-Stream."""
    doc = fitz.open(work_path)
    try:
        had_xmp = bool(doc.get_xml_metadata())
        doc.set_metadata({})
        try:
            doc.del_xml_metadata()
        except Exception:
            pass
        _atomic_replace(lambda tmp: doc.save(tmp, garbage=3, deflate=True), work_path)
    finally:
        doc.close()
    return {"scrubbed": True, "hadXmp": had_xmp}


_FLATTEN = {"annotations": ("annots",), "forms": ("widgets",)}


def flatten(work_path: str, categories: Optional[list[str]] = None) -> dict:
    """§7/§11: Annotationen und/oder Formularfelder in den Seiteninhalt einbrennen.
    Kategorien: 'annotations', 'forms'. 'stamps' sind bereits Inhalt -> No-op-Hinweis."""
    cats = categories if categories else ["annotations", "forms"]
    for c in cats:
        if c not in _FLATTEN:
            raise SecurityError(f"Unbekannte Flatten-Kategorie '{c}'; erlaubt: annotations, forms")
    bake_annots = "annotations" in cats
    bake_widgets = "forms" in cats

    doc = fitz.open(work_path)
    try:
        n_annots = sum(len(list(doc.load_page(i).annots())) for i in range(doc.page_count))
        n_widgets = sum(len(list(doc.load_page(i).widgets())) for i in range(doc.page_count))
        if bake_annots or bake_widgets:
            doc.bake(annots=bake_annots, widgets=bake_widgets)
        _atomic_replace(lambda tmp: doc.save(tmp, garbage=3, deflate=True), work_path)
    finally:
        doc.close()
    return {
        "flattened": cats,
        "annotationsBurned": n_annots if bake_annots else 0,
        "formFieldsBurned": n_widgets if bake_widgets else 0,
    }


# --------------------------------------------------------------- Verschlüsseln (Section 10)
# PyMuPDF kann AES-256 + Berechtigungs-Bitmaske nativ (pikepdf.Encryption kann keine
# Berechtigungen setzen, verifiziert). User-Passwort = Oeffnen, Owner-Passwort = Rechte aendern.
_ALL_PERMS = (fitz.PDF_PERM_PRINT | fitz.PDF_PERM_PRINT_HQ | fitz.PDF_PERM_COPY
              | fitz.PDF_PERM_MODIFY | fitz.PDF_PERM_ANNOTATE | fitz.PDF_PERM_FORM
              | fitz.PDF_PERM_ACCESSIBILITY | fitz.PDF_PERM_ASSEMBLE)

_FLAGMAP = {
    "copy": fitz.PDF_PERM_COPY,
    "modify": fitz.PDF_PERM_MODIFY,
    "annotate": fitz.PDF_PERM_ANNOTATE,
    "form": fitz.PDF_PERM_FORM,
    "accessibility": fitz.PDF_PERM_ACCESSIBILITY,
    "assembly": fitz.PDF_PERM_ASSEMBLE,
}


def perm_bits(permissions: Optional[dict]) -> int:
    """Section-10-Berechtigungsdict -> PDF-Flag-Bitmaske. Ohne Angabe: alles erlaubt.
    printing: 'none' | 'low' | 'full'. Advisory - kompatible Reader halten sich daran."""
    if not permissions:
        return _ALL_PERMS
    bits = 0
    printing = str(permissions.get("printing", "full")).lower()
    if printing in ("low", "full"):
        bits |= fitz.PDF_PERM_PRINT
    if printing == "full":
        bits |= fitz.PDF_PERM_PRINT_HQ
    for k, bit in _FLAGMAP.items():
        if permissions.get(k):
            bits |= bit
    return bits


def encrypt_work(work_path: str, user_pw: str, owner_pw: Optional[str] = None,
                 permissions: Optional[dict] = None) -> dict:
    """AES-256 (R6) auf die Arbeitskopie, getrennte User-/Owner-Passwoerter + Berechtigungen.
    Owner defaultet auf das User-Passwort, wenn weggelassen (Section 10 warnt vor diesem Fall)."""
    if not user_pw:
        raise SecurityError("Oeffnungs-Passwort (User) darf nicht leer sein")
    owner = owner_pw or user_pw
    bits = perm_bits(permissions)
    doc = fitz.open(work_path)
    try:
        _atomic_replace(lambda tmp: doc.save(
            tmp, encryption=fitz.PDF_ENCRYPT_AES_256, permissions=bits,
            owner_pw=owner, user_pw=user_pw), work_path)
    finally:
        doc.close()
    return {"encrypted": True, "algorithm": "AES-256 (R6)", "permissions": permissions or {},
            "ownerDefaultsToUser": owner_pw is None}


def remove_encryption_copy(src_path: str, owner_password: str, dest_dir: str,
                           base_name: Optional[str] = None) -> dict:
    """§10: Entschluesselt in eine NEUE Datei (nie in-place). Braucht das OWNER-Passwort:
    ein reines Oeffnungs-(User-)Passwort reicht ausdruecklich nicht."""
    if not os.path.isfile(src_path):
        raise SecurityError(f"Quelldatei nicht gefunden: {src_path}")
    if not dest_dir or not os.path.isdir(dest_dir) or not os.access(dest_dir, os.W_OK):
        from backend.pdflib import WriteDenied
        raise WriteDenied("Kein Schreibrecht auf das Zielverzeichnis")
    doc = fitz.open(src_path)
    try:
        if not doc.needs_pass:
            raise SecurityError("Dokument ist nicht verschluesselt")
        if doc.authenticate(owner_password) == 0:
            raise PasswordRequiredF("Besitzer-Passwort ist falsch")
        if not (doc.permissions & fitz.PDF_PERM_MODIFY):
            raise SecurityError("Entschluesseln erfordert das Besitzer-Passwort, nicht das Oeffnungs-Passwort")
        from backend.pdflib import unique_filename
        stem = base_name or (os.path.splitext(os.path.basename(src_path))[0] + "_entschluesselt")
        dest = unique_filename(dest_dir, stem, ".pdf")
        doc.save(dest, encryption=fitz.PDF_ENCRYPT_NONE, garbage=3, deflate=True)
    finally:
        doc.close()
    return {"path": dest, "decrypted": True}


# PasswordRequired-artige 422 mit klarem Text (eigene Subklasse, gleiche Semantik)
from backend.pdflib import PasswordRequired as PasswordRequiredF  # noqa: E402
