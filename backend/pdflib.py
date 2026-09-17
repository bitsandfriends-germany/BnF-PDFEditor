"""PDF-Bibliotheksschicht: PyMuPDF (Seiten-OPs), pikepdf (Metadaten/Encryption).

Alle Signaturen gegen die im venv installierten Versionen verifiziert (nicht aus dem Kopf):
- PyMuPDF 1.28.2: `fitz.open(path)` hat KEIN `password`-Kwarg — Passwort nur via `doc.authenticate(pw)`.
  `authenticate()` liefert ein Rechte-BITMASK, nicht 0/1/2: nur-user=2, owner=4, owner==user=6,
  falsch/fehlend=0. Read-only daher `(rc & 4) == 0`. Weiter: `Document.page_count`, `load_page`,
  `Page.rotation/set_rotation`, `delete_page(pno)`, `insert_pdf(docsrc, from_page, to_page, start_at)`.
  Achtung `Document.save(encryption=...)`: `PDF_ENCRYPT_KEEP=0` (behält bei!), `PDF_ENCRYPT_NONE=1`.
- pikepdf 10.13: `pikepdf.open(path, password=)`, `pdf.docinfo['/Title']`, `pdf.save(encryption=Encryption(...))`,
  `pikepdf.Encryption(owner=, user=, R=6)`, `pikepdf.PasswordError`.

Backend fuehrt KEINE Koordinatentransformation aus (Spec Section 4): Eingaben kommen bereits in
PDF-User-Space. Seiten-OPs laufen auf der (internen, entschluesselten) Arbeitskopie.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import dataclass, field
from typing import Optional

import pymupdf as fitz
import pikepdf

from backend.pages import PageRangeError, parse_page_range, parse_page_range_set


class PdfError(Exception):
    """Basisfehler mit stabilem Code + HTTP-Status fuer den Error-Handler."""

    code = "pdf_error"
    status = 422

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class PasswordRequired(PdfError):
    code = "password_required"
    status = 422


class WrongPassword(PdfError):
    code = "wrong_password"
    status = 422


class CorruptDocument(PdfError):
    code = "corrupt_document"
    status = 422


class WriteDenied(PdfError):
    code = "write_denied"
    status = 422


class BadPage(PdfError):
    code = "bad_page"
    status = 422


class NoDocument(PdfError):
    code = "no_document"
    status = 409


class ReadOnly(PdfError):
    code = "read_only"
    status = 409


@dataclass
class OpenResult:
    page_count: int
    width: float
    height: float
    rotation: int
    encrypted: bool
    read_only: bool  # geoeffnet mit user- aber ohne owner-Passwort


def _validate_and_check(path: str, password: Optional[str]) -> tuple[fitz.Document, bool, bool]:
    """Oeffnet zum Pruefen. Liefert (doc, read_only, was_encrypted). Wirft bei defekt/Passwort."""
    if not os.path.isfile(path):
        raise CorruptDocument(f"Datei nicht gefunden: {os.path.basename(path)}")
    try:
        doc = fitz.open(path)  # Passwort NIE als Kwarg: in PyMuPDF 1.28 nur via authenticate()
    except Exception as exc:  # PyMuPDF wirft vielfaeltige Fehler bei defekten Dateien
        raise CorruptDocument(f"PDF konnte nicht gelesen werden: {exc}") from exc
    # Verschlüsselungsstatus VOR authenticate() abgreifen: is_encrypted wird nach erfolgreichem
    # Entschuesseln zurueckgesetzt. needs_pass/is_encrypted verraten es zutraeglich.
    was_encrypted = bool(doc.needs_pass or doc.is_encrypted)
    if doc.needs_pass:
        rc = doc.authenticate(password or "")
        if rc == 0:
            doc.close()
            raise WrongPassword("Falsches oder fehlendes Passwort")
        # PyMuPDF 1.28.2 liefert Rechte-Bits, NICHT 0/1/2. Am Zielprofil (pikepdf R6) empirisch
        # verifiziert: owner==user -> 6, nur-user -> 2, owner -> 4. Owner-Rechte sind Bit 4.
        # Schreibgeschuetzt genau dann, wenn die Owner-Rechte (Bit 4) fehlen (Spec Section 4).
        return doc, (rc & 4) == 0, was_encrypted
    return doc, False, was_encrypted


def open_into_work(src_path: str, password: Optional[str], work_path: str) -> OpenResult:
    """Oeffnet Original, schreibt entschluesselte Arbeitskopie, liefert Strukturinfo."""
    doc, read_only, was_encrypted = _validate_and_check(src_path, password)
    try:
        if doc.page_count == 0:
            raise CorruptDocument("Dokument enthaelt keine Seiten")
        first = doc.load_page(0)
        rect = first.rect
        rot = first.rotation
        info = OpenResult(
            page_count=doc.page_count,
            width=round(float(rect.width), 2),
            height=round(float(rect.height), 2),
            rotation=int(rot),
            encrypted=was_encrypted,
            read_only=read_only,
        )
        # Arbeitskopie immer unverschluesselt: PDF_ENCRYPT_NONE=1 (encryption=0 waere KEEP und
        # wuerde die Quelle-Verschluesselung beibehalten!). Die kuenftige Verschluesselung wird
        # erst beim Speichern erneut angewandt.
        doc.save(work_path, encryption=fitz.PDF_ENCRYPT_NONE, garbage=3, deflate=True)
    finally:
        doc.close()
    return info


def page_count(work_path: str) -> int:
    doc = fitz.open(work_path)
    try:
        return doc.page_count
    finally:
        doc.close()


def page_sizes(work_path: str) -> list[dict]:
    doc = fitz.open(work_path)
    try:
        out = []
        for i in range(doc.page_count):
            p = doc.load_page(i)
            out.append({"index": i, "width": round(float(p.rect.width), 2), "height": round(float(p.rect.height), 2), "rotation": int(p.rotation)})
        return out
    finally:
        doc.close()


def _atomic_replace(work_path: str, doc: fitz.Document) -> None:
    """PyMuPDF-Speicherung in temporraere Datei daneben, dann atomares os.replace."""
    d = os.path.dirname(work_path)
    fd, tmp = tempfile.mkstemp(prefix=".op-", suffix=".pdf", dir=d)
    os.close(fd)
    try:
        doc.save(tmp, garbage=3, deflate=True)
        os.replace(tmp, work_path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def rotate_page(work_path: str, page: int, delta: int) -> dict:
    doc = fitz.open(work_path)
    try:
        if not (0 <= page < doc.page_count):
            raise BadPage(f"Seite {page} ausserhalb des Bereichs 0..{doc.page_count - 1}")
        p = doc.load_page(page)
        new_rot = (int(p.rotation) + int(delta)) % 360
        p.set_rotation(new_rot)
        _atomic_replace(work_path, doc)
        return {"index": page, "rotation": new_rot}
    finally:
        doc.close()


def delete_page(work_path: str, page: int) -> dict:
    doc = fitz.open(work_path)
    try:
        if not (0 <= page < doc.page_count):
            raise BadPage(f"Seite {page} ausserhalb des Bereichs 0..{doc.page_count - 1}")
        if doc.page_count <= 1:
            raise BadPage("Die letzte Seite kann nicht geloescht werden")
        doc.delete_page(page)
        _atomic_replace(work_path, doc)
        return {"page_count": doc.page_count}
    finally:
        doc.close()


def reorder_pages(work_path: str, order: list[int]) -> dict:
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        if sorted(order) != list(range(n)):
            raise BadPage("Reihenfolge muss jede Seite genau einmal enthalten")
        new = fitz.open()
        try:
            for idx in order:
                new.insert_pdf(doc, from_page=idx, to_page=idx)
            _atomic_replace(work_path, new)
        finally:
            new.close()
        return {"page_count": n, "order": order}
    finally:
        doc.close()


def merge_pdf(work_path: str, other_path: str) -> dict:
    if not os.path.isfile(other_path):
        raise CorruptDocument("Anzuhängende Datei nicht gefunden")
    doc = fitz.open(work_path)
    try:
        try:
            other = fitz.open(other_path)
        except Exception as exc:
            raise CorruptDocument(f"Anzuhängende PDF ungueltig: {exc}") from exc
        if other.needs_pass:
            other.close()
            raise PasswordRequired("Die anzuhängende Datei ist passwortgeschuetzt")
        before = doc.page_count
        # Gliederungen BEIDER Dokumente einfangen: insert_pdf uebernimmt die Outline der
        # Quelle NICHT. Ohne das hier gingen die Lesezeichen des angehaengten Dokuments
        # verloren (Teil der merge-Zusagen aus Teil 2 / PART 3 §3).
        target_toc = doc.get_toc()
        source_toc = other.get_toc()
        try:
            doc.insert_pdf(other)
        finally:
            other.close()
        # Quellen-Lesezeichen um die bisherige Seitenzahl verschieben und anhaengen.
        if source_toc:
            shifted = [[lvl, title, pg + before] for (lvl, title, pg) in source_toc if pg >= 1]
            doc.set_toc(target_toc + shifted)
        _atomic_replace(work_path, doc)
        return {"page_count": doc.page_count, "added": doc.page_count - before}
    finally:
        doc.close()


def get_metadata(work_path: str) -> dict:
    pdf = pikepdf.open(work_path)
    try:
        di = pdf.docinfo
        def g(k: str) -> str:
            v = di.get(f"/{k}")
            return str(v) if v is not None else ""
        return {
            "title": g("Title"),
            "author": g("Author"),
            "subject": g("Subject"),
            "keywords": g("Keywords"),
        }
    finally:
        pdf.close()


def set_metadata(work_path: str, title: str, author: str, subject: str, keywords: str) -> dict:
    pdf = pikepdf.open(work_path)
    try:
        di = pdf.docinfo
        for key, value in (("/Title", title), ("/Author", author), ("/Subject", subject), ("/Keywords", keywords)):
            if value == "":
                if key in di:
                    del di[key]
            else:
                di[key] = pikepdf.String(value)
        _pikepdf_atomic(pdf, work_path)
        return {"title": title, "author": author, "subject": subject, "keywords": keywords}
    finally:
        pdf.close()


def _pikepdf_atomic(pdf: "pikepdf.Pdf", dest: str) -> None:
    d = os.path.dirname(dest)
    fd, tmp = tempfile.mkstemp(prefix=".op-", suffix=".pdf", dir=d)
    os.close(fd)
    try:
        pdf.save(tmp)
        os.replace(tmp, dest)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def encrypt_work(work_path: str, password: str) -> dict:
    """Wendet AES-256 (R=6) auf die Arbeitskopie an. Password nur im Speicher (Session)."""
    if len(password) < 1:
        raise PdfError("Passwort darf nicht leer sein")
    pdf = pikepdf.open(work_path)
    try:
        enc = pikepdf.Encryption(owner=password, user=password, R=6)
        _pikepdf_atomic_with_enc(pdf, work_path, enc)
        return {"encrypted": True, "algorithm": "AES-256 (R6)"}
    finally:
        pdf.close()


def _pikepdf_atomic_with_enc(pdf: "pikepdf.Pdf", dest: str, enc: "pikepdf.Encryption") -> None:
    d = os.path.dirname(dest)
    fd, tmp = tempfile.mkstemp(prefix=".op-", suffix=".pdf", dir=d)
    os.close(fd)
    try:
        pdf.save(tmp, encryption=enc)
        os.replace(tmp, dest)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def remove_signatures(work_path: str) -> dict:
    """Entfernt alle digitalen Signaturen (Widget-Annots + Sig-Felder) per pikepdf.
    Regulaerer, undo-barer Schritt: inkrementelle Signatur-Reste werden durch einen
    sauberen Neubeginn ersetzt."""
    import pikepdf

    out = os.path.dirname(os.path.abspath(work_path)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".rmsig-", suffix=".pdf", dir=out)
    os.close(fd)
    removed = 0
    try:
        with pikepdf.open(work_path) as pdf:
            for page in pdf.pages:
                annots = page.get("/Annots")
                if annots is None:
                    continue
                keep = []
                for a in annots:
                    try:
                        obj = a
                        ft = obj.get("/FT")
                        if ft is None and obj.get("/Parent") is not None:
                            ft = obj["/Parent"].get("/FT")
                        is_sig = (ft is not None and str(ft) == "/Sig")
                        sv = obj.get("/V")
                        if not is_sig and sv is not None and str(sv.get("/Type") if sv.is_dictionary else "") == "/Sig":
                            is_sig = True
                        if is_sig:
                            removed += 1
                            continue
                    except Exception:
                        pass
                    keep.append(a)
                if len(keep) != len(annots):
                    if keep:
                        page[pikepdf.Name("/Annots")] = pikepdf.Array(keep)
                    else:
                        del page[pikepdf.Name("/Annots")]
            root = pdf.Root
            acro = root.get("/AcroForm")
            if acro is not None:
                fields = acro.get("/Fields")
                if fields is not None:
                    kf = []
                    for f in fields:
                        try:
                            ft = f.get("/FT")
                            if ft is None and f.get("/Parent") is not None:
                                ft = f["/Parent"].get("/FT")
                            if ft is not None and str(ft) == "/Sig":
                                removed += 1
                                continue
                        except Exception:
                            pass
                        kf.append(f)
                    if kf:
                        acro[pikepdf.Name("/Fields")] = pikepdf.Array(kf)
                    else:
                        del acro[pikepdf.Name("/Fields")]
                    if len(kf) == 0:
                        del root[pikepdf.Name("/AcroForm")]
            if removed == 0:
                os.remove(tmp)
                return {"removed": 0}
            pdf.save(tmp)
        os.replace(tmp, work_path)
        return {"removed": removed}
    except Exception as exc:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise PdfError(f"Signaturen entfernen fehlgeschlagen: {exc}") from exc


def save_document(work_path: str, target_path: str, encryption: Optional[dict]) -> dict:
    """Speichert die Arbeitskopie zielgerichtet. Bei gespeicherter Encryption wird wieder
    mit derselben Verschluesselung geschrieben (kein stilles Entschluesseln)."""
    d = os.path.dirname(os.path.abspath(target_path)) or "."
    if not os.path.isdir(d) or not os.access(d, os.W_OK):
        raise WriteDenied("Kein Schreibrecht auf das Zielverzeichnis")
    # Zielpruefung bei existierender Datei
    if os.path.exists(target_path) and not os.access(target_path, os.W_OK):
        raise WriteDenied("Zieldatei ist schreibgeschuetzt")
    pdf_dir = os.path.dirname(os.path.abspath(target_path)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".save-", suffix=".pdf", dir=pdf_dir)
    os.close(fd)
    # Signatur-Ehrlichkeit (§2/§3): jedes Umschreiben (pikepdf.save oder fitz-Verschlüsselung)
    # zerstört die ByteRange der inkrementellen Signatur und hinterrücks eine Schein-Signatur
    # (Reste von /Sig mit veralteten Offsets) zurücklässt. Eine signierte Arbeitskopie wird daher
    # BYTE-GENAU kopiert; nachträgliche Verschlüsselung eines signierten Dokuments wird
    # abgelehnt, statt die Signatur still zu brechen.
    probe = fitz.open(work_path)
    try:
        signed = probe.get_sigflags() != -1
    finally:
        probe.close()
    if signed and encryption and encryption.get("active"):
        if os.path.exists(tmp):
            os.remove(tmp)
        raise WriteDenied("Signiertes Dokument kann nicht nachträglich verschlüsselt werden (Würde die Signatur zerstören)")
    try:
        if signed:
            shutil.copyfile(work_path, tmp)  # Byte-exakt: Inkrement + ByteRange bleiben gültig
        elif encryption and encryption.get("active"):
            # Arbeitskopie ist unverschluesselt; AES-256 + Berechtigungen erst hier anwenden.
            from backend.security_ops import perm_bits
            pw = encryption["user_pw"]
            opw = encryption.get("owner_pw") or pw
            bits = perm_bits(encryption.get("permissions"))
            doc = fitz.open(work_path)
            try:
                doc.save(tmp, encryption=fitz.PDF_ENCRYPT_AES_256, permissions=bits,
                         owner_pw=opw, user_pw=pw, garbage=3, deflate=True)
            finally:
                doc.close()
        else:
            pdf = pikepdf.open(work_path)
            try:
                pdf.save(tmp)
            finally:
                pdf.close()
        with open(tmp, "rb") as fh:
            os.fsync(fh.fileno())
        os.replace(tmp, target_path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return {"saved": True, "path": target_path, "encrypted": bool(encryption and encryption.get("active"))}


# ============================================================ Seitenverwaltung (Section 6)
# Alle selektionsbasierten OPs nehmen die Section-3-Seitenbereichs-Syntax entgegen.
# Order-insensitive OPs (Rotieren, Loeschen) nutzen die Mense; order-sensitive OPs
# (Duplizieren, Extrahieren) die erhaltene Reihenfolge. PageRangeError -> BadPage (422).


def _range_list(expr: str, total: int) -> list[int]:
    try:
        return parse_page_range(expr, total)
    except PageRangeError as exc:
        raise BadPage(str(exc)) from exc


def _range_set(expr: str, total: int) -> set[int]:
    try:
        return parse_page_range_set(expr, total)
    except PageRangeError as exc:
        raise BadPage(str(exc)) from exc


def unique_filename(dest_dir: str, stem: str, ext: str = ".pdf") -> str:
    """§2.6: nie stilles Ueberschreiben. Name, bei Kollision _1, _2 ..."""
    if not os.path.isdir(dest_dir):
        raise WriteDenied("Zielverzeichnis existiert nicht: %s" % dest_dir)
    if not os.access(dest_dir, os.W_OK):
        raise WriteDenied("Kein Schreibrecht auf das Zielverzeichnis")
    candidate = os.path.join(dest_dir, stem + ext)
    k = 1
    while os.path.exists(candidate):
        candidate = os.path.join(dest_dir, "%s_%d%s" % (stem, k, ext))
        k += 1
    return candidate


def _save_new_doc(new: "fitz.Document", dest_path: str) -> None:
    d = os.path.dirname(os.path.abspath(dest_path)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".extract-", suffix=".pdf", dir=d)
    os.close(fd)
    try:
        new.save(tmp, garbage=3, deflate=True)
        os.replace(tmp, dest_path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def rotate_pages(work_path: str, expr: str, delta: int) -> dict:
    """Rotiert eine Auswahl (order-insensitiv). delta in Grad (90/180/-90)."""
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = _range_set(expr, n)
        applied = []
        for p in sorted(pages):
            page = doc.load_page(p - 1)
            new_rot = (int(page.rotation) + int(delta)) % 360
            page.set_rotation(new_rot)
            applied.append({"page": p, "rotation": new_rot})
        _atomic_replace(work_path, doc)
        return {"rotated": len(applied), "pages": applied}
    finally:
        doc.close()


def delete_pages(work_path: str, expr: str) -> dict:
    """Loescht eine Auswahl (order-insensitiv). Wache: nicht alle Seiten loeschen."""
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = _range_set(expr, n)
        if len(pages) >= n:
            raise BadPage("Es koennen nicht alle Seiten geloescht werden — ein PDF muss mindestens eine Seite behalten")
        for p in sorted(pages, reverse=True):
            doc.delete_page(p - 1)
        _atomic_replace(work_path, doc)
        return {"deleted": len(pages), "page_count": doc.page_count}
    finally:
        doc.close()


def _resolve_insert_pos(position: str, page: Optional[int], n: int) -> int:
    """Liest die Einfuegeposition (1-basierte Eingabe) als 0-basierten Index aus."""
    if position in ("before", "after"):
        if page is None or not (1 <= page <= n):
            raise BadPage("before/after benoetigt eine gueltige Seitenzahl 1-%d" % n)
        return (page - 1) if position == "before" else page
    if position == "start":
        return 0
    if position == "end":
        return n
    raise BadPage("Ungueltige Einfuegeposition '%s'" % position)


def duplicate_pages(work_path: str, expr: str, position: str, page: Optional[int]) -> dict:
    """Kopiert eine Auswahl (Reihenfolge erhaelt) und fugt sie an gewuelter Position ein.

    position: 'start' | 'end' | 'before' | 'after' (mit page 1-basiert fuer before/after)."""
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        selected = _range_list(expr, n)  # 1-basiert, Reihenfolge erhalten
        pos = _resolve_insert_pos(position, page, n)

        originals = list(range(n))  # 0-basierte Indizes in Reihenfolge
        target = originals[:pos] + [p - 1 for p in selected] + originals[pos:]

        new = fitz.open()
        try:
            for idx in target:
                new.insert_pdf(doc, from_page=idx, to_page=idx)
            _atomic_replace(work_path, new)
        finally:
            new.close()
        return {"added": len(selected), "page_count": n + len(selected)}
    finally:
        doc.close()


def extract_pages(work_path: str, expr: str, dest_dir: str, each: bool, base_name: Optional[str]) -> dict:
    """§6: Extrahiert eine Auswahl in neue Datei(en). Quelle bleibt unveraendert (kein
    before_mutation). each=True -> eine Datei pro Seite. Nie stilles Ueberschreiben (§2.6)."""
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pages = _range_list(expr, n)  # Reihenfolge erhaelt (Extraktion ist order-sensitiv)
        base = base_name or "extract"
        created: list[str] = []
        if each:
            for p in pages:
                new = fitz.open()
                try:
                    new.insert_pdf(doc, from_page=p - 1, to_page=p - 1)
                    dest = unique_filename(dest_dir, "%s_p%d" % (base, p))
                    _save_new_doc(new, dest)
                    created.append(dest)
                finally:
                    new.close()
        else:
            new = fitz.open()
            try:
                for p in pages:
                    new.insert_pdf(doc, from_page=p - 1, to_page=p - 1)
                dest = unique_filename(dest_dir, base)
                _save_new_doc(new, dest)
                created.append(dest)
            finally:
                new.close()
        return {"created": created, "count": len(created), "pages": len(pages)}
    finally:
        doc.close()


def _split_segments(n: int, mode: str, page: Optional[int], count: Optional[int], points: Optional[list[int]]) -> list[list[int]]:
    """Berechnet Seiten-Segmente (0-basierte Indizes) fuer den Split-Modus."""
    if mode == "at":
        if page is None or not (1 < page <= n):
            raise BadPage("Split 'at' benoetigt eine Seite 2-%d (Schnitt VOR dieser Seite)" % n)
        return [list(range(0, page - 1)), list(range(page - 1, n))]
    if mode == "everyN":
        if not count or count < 1:
            raise BadPage("Split 'everyN' benoetigt eine Schrittweite >= 1")
        return [list(range(i, min(i + count, n))) for i in range(0, n, count)]
    if mode == "every":
        return [[i] for i in range(n)]
    if mode == "points":
        if not points:
            raise BadPage("Split 'points' benoetigt eine Liste von Seitenzahlen")
        cuts = sorted({p for p in points if 1 < p <= n})
        bounds = [0] + [c - 1 for c in cuts] + [n]
        return [list(range(bounds[i], bounds[i + 1])) for i in range(len(bounds) - 1)]
    raise BadPage("Ungueltiger Split-Modus '%s'" % mode)


def split_document(work_path: str, mode: str, page: Optional[int], count: Optional[int],
                   points: Optional[list[int]], dest_dir: str, base_name: Optional[str]) -> dict:
    """§6: Splittet in mehrere Dateien <base>_1.pdf, _2.pdf, ... Nie stilles Ueberschreiben."""
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        segments = _split_segments(n, mode, page, count, points)
        if len(segments) < 2:
            raise BadPage("Aus dieser Aufteilung wuerden weniger als zwei Dateien entstehen")
        base = base_name or "split"
        created: list[str] = []
        for i, seg in enumerate(segments, start=1):
            new = fitz.open()
            try:
                for idx in seg:
                    new.insert_pdf(doc, from_page=idx, to_page=idx)
                dest = unique_filename(dest_dir, "%s_%d" % (base, i))
                _save_new_doc(new, dest)
                created.append(dest)
            finally:
                new.close()
        return {"created": created, "count": len(created), "parts": [len(s) for s in segments]}
    finally:
        doc.close()


def insert_pages(work_path: str, position: str, page: Optional[int], source: dict) -> dict:
    """§6: Fuegt Seiten an gewaelter Position ein. Quelle: 'blank' (width/height pt),
    'image' (path) oder 'pdf' (path, optional expr/section + password + scale)."""
    kind = source.get("kind")
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        pos = _resolve_insert_pos(position, page, n)
        added = 0

        if kind == "blank":
            w = float(source.get("width") or 0)
            h = float(source.get("height") or 0)
            if w <= 0 or h <= 0:
                raise BadPage("Leere Seite benoetigt positive Breite und Hoehe in pt")
            doc.new_page(pos, width=w, height=h)
            added = 1

        elif kind == "image":
            path = source.get("path")
            if not path or not os.path.isfile(path):
                raise CorruptDocument("Bilddatei nicht gefunden")
            try:
                pix = fitz.Pixmap(path)
            except Exception as exc:
                raise CorruptDocument(f"Bild ungueltig: {exc}") from exc
            p = doc.new_page(pos, width=pix.width, height=pix.height)
            p.insert_image(p.rect, filename=path)
            added = 1

        elif kind == "pdf":
            spath = source.get("path")
            if not spath or not os.path.isfile(spath):
                raise CorruptDocument("Quell-PDF nicht gefunden")
            try:
                src = fitz.open(spath)
            except Exception as exc:
                raise CorruptDocument(f"Quell-PDF ungueltig: {exc}") from exc
            try:
                if src.needs_pass:
                    pw = source.get("password")
                    if not pw:
                        raise PasswordRequired("Die Quelldatei ist passwortgeschuetzt — Passwort erforderlich")
                    rc = src.authenticate(pw)
                    if rc == 0:
                        raise WrongPassword("Das Passwort fuer die Quelldatei ist nicht korrekt")
                expr = source.get("expr")
                idxs = _range_list(expr, src.page_count) if expr else list(range(1, src.page_count + 1))
                scale = bool(source.get("scale", False))
                # Zielgroesse fuer 'scale': Seite am Einfuege-Anker (1-basierte page, sonst Start/End)
                tw = th = 0.0
                if scale:
                    anchor = (page - 1) if (position in ("before", "after") and page) else (pos if pos < n else n - 1)
                    anchor = max(0, min(anchor, n - 1))
                    r = doc.load_page(anchor).rect
                    tw, th = float(r.width), float(r.height)
                for k, p1 in enumerate(idxs):
                    if scale:
                        np_ = doc.new_page(pos + k, width=tw, height=th)
                        np_.show_pdf_page(np_.rect, src, p1 - 1)
                    else:
                        doc.insert_pdf(src, from_page=p1 - 1, to_page=p1 - 1, start_at=pos + k)
                    added += 1
            finally:
                src.close()

        else:
            raise BadPage("Unbekannte Einfuegequelle '%s'" % kind)

        _atomic_replace(work_path, doc)
        return {"added": added, "page_count": n + added}
    finally:
        doc.close()
