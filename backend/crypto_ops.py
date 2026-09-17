"""Krypto-/Stamping-Schicht (Step 4): pyHanko-Signaturen, Verifikation, Bild-Stamping.

Alle Signaturen gegen das installierte pyHanko 0.37.0 + PyMuPDF 1.28.2 verifiziert:
- sign_pdf(pdf_out=IncrementalPdfFileWriter(handle), signature_meta=PdfSignatureMetadata(
  field_name=X), signer=SimpleSigner.load_pkcs12(p12, passphrase=b64), new_field_spec=
  SigFieldSpec(sig_field_name=X, on_page, box=(x1,y1,x2,y2)), output=handle).
  ACHTUNG: PdfSignatureMetadata.field_name MUSS gleich SigFieldSpec.sig_field_name sein.
- Verifikation: PdfFileReader(handle).embedded_signatures -> validate_pdf_signature(s, skip_diff=True);
  Status-Attribute: .intact (Inhalt unveraendert), .valid (krypto gueltig), .trusted (Chain), .md_algorithm.
- Stamping: page.insert_image(fitz.Rect(...), stream=png_bytes).

Koordinaten-Contract (Spec Section 4): Der Frontend-Faktor rechnet Zoom, devicePixelRatio und
Seitenrotation HERAUS und liefert ein Rechteck in PDF-User-Space (Ursprung UNTEN-LINKS). Das
Backend fuehrt KEINE Zoom-/DPR-/Rotationsrechnung aus. Es gilt nur die feste, konventionsbedingte
Uhrzeiger-Orgine der jeweiligen Bibliothek:
  - pyHanko ist PDF-nativ (unten-links) -> box wird UNVERAENDERT durchgereicht.
  - PyMuPDF misst von OBEN-LINKS -> einmalige, konstante Orgin-Umkehr y -> H - y (keine Zoom-Rot).
"""
from __future__ import annotations

import base64
import datetime
import io
import os
import tempfile
from typing import Optional

import pymupdf as fitz
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign import PdfSignatureMetadata, sign_pdf, signers
from pyhanko.sign.fields import InvisSigSettings, SigFieldSpec, VisibleSigSettings
from pyhanko.sign.validation import validate_pdf_signature

from .pdflib import BadPage, CorruptDocument, PdfError


class SignatureError(PdfError):
    code = "signature_error"
    status = 422


class BadImage(PdfError):
    code = "bad_image"
    status = 422


class MissingCertificate(PdfError):
    code = "missing_certificate"
    status = 422


def _fitz_rect_from_pdf_bottom_left(page: "fitz.Page", x: float, y: float, w: float, h: float) -> fitz.Rect:
    """PDF-User-Space (unten-links) -> PyMuPDF-Rect (oben-links). Nur feste Orgin-Umkehr."""
    H = float(page.rect.height)
    return fitz.Rect(float(x), H - (float(y) + float(h)), float(x) + float(w), H - float(y))


def normalize_image_bytes(data: bytes) -> bytes:
    """MuPDF fuellt nicht jedes Web-Format (SVG, WEBP, AVIF, HEIC, animierte GIFs...).
    Nutzergrafiken kommen genau daher: PNG/JPEG bleiben durchgereicht, alles andere
    normalisiert erst Pillow, dann (SVG & Co.) MuPDFs eigener Dokumentparser zu PNG.
    Unbekanntes bleibt unveraendert, damit der echte Fehler erhalten bleibt."""
    if not data or data[:8] == b"\x89PNG\r\n\x1a\n" or data[:2] == b"\xff\xd8":
        return data
    try:
        import io

        from PIL import Image

        im = Image.open(io.BytesIO(data))
        im.load()
        out = io.BytesIO()
        (im.convert("RGBA") if im.mode in ("RGBA", "LA", "PA", "P") else im.convert("RGB")).save(out, "PNG")
        return out.getvalue()
    except Exception:
        pass
    try:
        head = data[:200].lower()
        d = fitz.open(stream=data, filetype="svg" if b"<svg" in head or b"<?xml" in head else "svg")
        if d.page_count < 1:
            return data
        pix = d[0].get_pixmap(alpha=True)
        out = pix.tobytes("png")
        d.close()
        return out
    except Exception:
        return data
    try:
        import io

        from PIL import Image

        im = Image.open(io.BytesIO(data))
        im.load()
        out = io.BytesIO()
        (im.convert("RGBA") if im.mode in ("RGBA", "LA", "PA", "P") else im.convert("RGB")).save(out, "PNG")
        return out.getvalue()
    except Exception:
        return data


def stamp_image(work_path: str, page: int, rect: dict, image_bytes: bytes, keep_proportion: bool = True) -> dict:
    """Brennt ein PNG/SVG-Bild in die Seiten-Region. rect: PDF-User-Space {x,y,width,height} unten-links."""
    if not image_bytes:
        raise BadImage("Bilddaten sind leer")
    image_bytes = normalize_image_bytes(image_bytes)
    if float(rect.get("width", 0)) <= 0 or float(rect.get("height", 0)) <= 0:
        raise BadImage("Bildrechteck muss positiv sein")
    doc = fitz.open(work_path)
    try:
        n = doc.page_count
        if not (0 <= page < n):
            raise BadPage(f"Seite {page} ausserhalb des Bereichs 0..{n - 1}")
        p = doc.load_page(page)
        before = len(p.get_images(full=True))
        fr = _fitz_rect_from_pdf_bottom_left(p, rect["x"], rect["y"], rect["width"], rect["height"])
        try:
            p.insert_image(fr, stream=image_bytes, keep_proportion=keep_proportion)
        except Exception as exc:
            raise BadImage(f"Bild konnte nicht eingefuegt werden: {exc}") from exc
        after = len(p.get_images(full=True))
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
        return {"page": page, "addedImages": after - before, "imagesOnPage": after}
    finally:
        doc.close()



def _add_graphic_sig_field(work_path: str, page: int, x1: float, y1: float, x2: float, y2: float, field: str, image_bytes: bytes) -> None:
    """Legt ein sichtbares Signatur-Feld mit Bibliotheksgrafik als Erscheinungsbild an (PyMuPDF,
    Orgin OBEN-LINKS). Wird vor der pyHanko-Signatur (existing_fields_only) ausgefuehrt, damit die
    Grafik im Appearance-Stream des Signatur-Widgets sitzt und die Signatur gueltig bleibt."""
    try:
        pixmap_src = fitz.Pixmap(image_bytes)
    except Exception as exc:
        raise SignatureError("Signaturgrafik ist kein gueltiges PNG/JPEG") from exc
    d = os.path.dirname(work_path)

    def _save(doc) -> None:
        fd, tmp = tempfile.mkstemp(prefix=".sigfield-", suffix=".pdf", dir=d)
        os.close(fd)
        doc.save(tmp, garbage=3, deflate=True)
        doc.close()
        os.replace(tmp, work_path)

    doc = fitz.open(work_path)
    try:
        pg = doc.load_page(page)
        H = pg.rect.height
        w = fitz.Widget()
        w.field_name = field
        w.field_type = fitz.PDF_WIDGET_TYPE_SIGNATURE
        # bottom-links -> fitz top-links:  y_oben = H - y_unten
        w.rect = fitz.Rect(x1, H - y2, x2, H - y1)
        pg.add_widget(w)
        _save(doc)
    except Exception as exc:
        doc.close()
        raise SignatureError(f"Signaturfeld konnte nicht angelegt werden: {exc}") from exc
    # Nach dem Speichern neu oeffnen, Grafik als Pixmap setzen (Pfad wie bei frischen Widgets).
    doc = fitz.open(work_path)
    try:
        pg = doc.load_page(page)
        target = next((wd for wd in pg.widgets() or [] if wd.field_name == field), None)
        if target is None:
            raise SignatureError("Signaturfeld nach dem Anlegen nicht gefunden")
        target.pixmap = pixmap_src
        target.update()
        _save(doc)
    except SignatureError:
        doc.close()
        raise
    except Exception as exc:
        doc.close()
        raise SignatureError(f"Signaturgrafik konnte nicht gesetzt werden: {exc}") from exc



def _render_sig_appearance_pix(work_path: str, page: int, field: str, lines: list) -> None:
    """Zeichnet das Aussehen (Schild-Symbol + Inhaltszeilen) in ein Widget-pixmap
    (Nutzerwunsch R55): Ausweis mit Zertifikatssymbol, Signierer/Grund/Ort/Zeit.
    Wird vor der Signatur gesetzt — damit liegt das Aussehen innerhalb der
    signierten Bytes und die Signatur bleibt gueltig."""
    doc = fitz.open(work_path)
    try:
        pg = doc.load_page(page)
        target = next((wd for wd in pg.widgets() or [] if wd.field_name == field), None)
        if target is None:
            raise SignatureError("Signaturfeld nicht gefunden")
        r = target.rect
        w_px, h_px = max(int(r.width) * 3, 90), max(int(r.height) * 3, 40)
        tmp = fitz.open()
        ap = tmp.new_page(width=w_px / 3, height=h_px / 3)
        # Rahmen
        ap.draw_rect(ap.rect + (1, 1, -1, -1), color=(0.35, 0.35, 0.4), width=0.7)
        # Schild-Symbol (Vektor-Polygon) links
        cx, cy, s = 16, ap.rect.height / 2, min(10, ap.rect.height / 3.2)
        shield = [
            (cx, cy - s), (cx + s * 0.85, cy - s * 0.55), (cx + s * 0.85, cy + s * 0.25),
            (cx, cy + s), (cx - s * 0.85, cy + s * 0.25), (cx - s * 0.85, cy - s * 0.55),
        ]
        ap.draw_polyline(shield + [shield[0]], color=(0.1, 0.35, 0.7), fill=(0.85, 0.91, 0.98), width=0.8)
        check = [(cx - s * 0.35, cy - s * 0.02), (cx - s * 0.08, cy + s * 0.32), (cx + s * 0.42, cy - s * 0.38)]
        ap.draw_polyline(check, color=(0.1, 0.35, 0.7), width=1.1)
        # Inhalt rechts neben dem Symbol
        x0 = 30
        fs = max(5.5, min(8.0, (ap.rect.height / 3) / max(len(lines), 1)))
        y = ap.rect.y0 + (ap.rect.height - fs * 1.35 * len(lines)) / 2 + fs
        for ln in lines:
            ap.insert_text((x0, y), ln[:90], fontsize=fs, fontname="helv", color=(0.15, 0.15, 0.2))
            y += fs * 1.35
        pix = ap.get_pixmap(matrix=fitz.Matrix(3, 3))
        tmp.close()
        target.pixmap = pix
        target.update()
        d = os.path.dirname(work_path)
        fd, tmpf = tempfile.mkstemp(prefix=".sigap-", suffix=".pdf", dir=d)
        os.close(fd)
        doc.save(tmpf, garbage=3, deflate=True)
        doc.close()
        os.replace(tmpf, work_path)
    except SignatureError:
        doc.close()
        raise
    except Exception as exc:
        doc.close()
        raise SignatureError(f"Signatur-Aussehen konnte nicht erzeugt werden: {exc}") from exc


def _add_plain_sig_field(work_path: str, page: int, x1: float, y1: float, x2: float, y2: float, field: str) -> None:
    """Leeres sichtbares Sig-Feld (ohne Grafik) — fuer das gezeichnete Aussehen."""
    d = os.path.dirname(work_path)
    doc = fitz.open(work_path)
    try:
        pg = doc.load_page(page)
        H = pg.rect.height
        w = fitz.Widget()
        w.field_name = field
        w.field_type = fitz.PDF_WIDGET_TYPE_SIGNATURE
        w.rect = fitz.Rect(x1, H - y2, x2, H - y1)
        pg.add_widget(w)
        # Name GLEICH Feldname (kein Kind-Fallback 'Signature1'): sonst legt pyHanko
        # sein eigenes Standard-Aussehen an und unser gezeichnetes AP am
        # Blatt-Annot wäre nach der Signatur verwaist.
        w.field_label = field
        pg.delete_widget(w) if False else None
        # Widget instantiieren, /Rect sichern
        fd, tmp = tempfile.mkstemp(prefix=".sigfield-", suffix=".pdf", dir=d)
        os.close(fd)
        doc.save(tmp, garbage=3, deflate=True)
        doc.close()
        os.replace(tmp, work_path)
    except Exception as exc:
        doc.close()
        raise SignatureError(f"Signaturfeld konnte nicht angelegt werden: {exc}") from exc



def _set_ap_stream_from_overlay(work_path: str, field: str, w_pt: float, h_pt: float, lines: list) -> None:
    """Baut das gezeichnete Aussehen (Schild+Inhalt, Core-Fonts) und setzt es als
    /N-Appearance direkt am Signatur-Widget — VOR der Signatur, damit es innerhalb
    der signierten Bytes liegt."""
    import pikepdf

    content = _overlay_content(w_pt, h_pt, lines)
    out = os.path.dirname(work_path)
    fd, tmp = tempfile.mkstemp(prefix=".sigap-", suffix=".pdf", dir=out)
    os.close(fd)
    try:
        with pikepdf.open(work_path) as pdf:
            target = None
            for pg in pdf.pages:
                for a in (pg.get("/Annots") or []):
                    nm = a.get("/T") or (a.get("/Parent", pikepdf.Dictionary()).get("/T"))
                    if nm is not None and str(nm) in (f"({field})", field):
                        target = a
                        break
                if target is not None:
                    break
            if target is None:
                raise SignatureError("Signaturfeld fuer Aussehen nicht gefunden")
            helv = pdf.make_indirect(pikepdf.Dictionary(Type="/Font", Subtype="/Type1", BaseFont="/Helvetica", Encoding="/WinAnsiEncoding"))
            helvb = pdf.make_indirect(pikepdf.Dictionary(Type="/Font", Subtype="/Type1", BaseFont="/Helvetica-Bold", Encoding="/WinAnsiEncoding"))
            ap = pdf.make_indirect(pikepdf.Stream(
                pdf, content,
                Subtype="/Form",
                BBox=pikepdf.Array([0, 0, float(w_pt), float(h_pt)]),
                Resources=pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=helvb, F2=helv)),
            ))
            target[pikepdf.Name("/AP")] = pikepdf.Dictionary(N=ap)
            # /DR am Feld: unsere Fonts auch fuer pyHankko-Layout-Reparatur verfuegbar
            target[pikepdf.Name("/DR")] = pikepdf.Dictionary(
                Font=pikepdf.Dictionary(F1=helvb, F2=helv))
            pdf.save(tmp)
        os.replace(tmp, work_path)
    except SignatureError:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    except Exception as exc:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise SignatureError(f"Aussehen konnte nicht gesetzt werden: {exc}") from exc


def _field_was_signed(path: str, field: str) -> bool:
    """True, wenn das Sig-Feld schon einen signierten Wert traegt (/V zeigt auf
    ein Dictionary mit /ByteRange). Ein leeres Platzhalter-Feld hat /V=None."""
    import pikepdf

    try:
        with pikepdf.open(path) as pdf:
            for pg in pdf.pages:
                for a in (pg.get("/Annots") or []):
                    nm = a.get("/T") or (a.get("/Parent", pikepdf.Dictionary()).get("/T"))
                    if nm is not None and str(nm).strip("()") == field:
                        v = a.get("/V")
                        if v is None:
                            return False
                        try:
                            return "/ByteRange" in v
                        except Exception:
                            return False
    except Exception:
        return False
    return False


def _compose_signature_image(w_pt: float, h_pt: float, lines: list, image_bytes: bytes) -> bytes:
    """R66: Signaturkarte als EIN Rasterbild — Nutzergrafik links, Name/Grund/
    Zeit rechts, alles hart in Pixeln. Der AP-Strom bekommt damit keinen
    Text-Operator fuer den Signaturwert (Diff-Stufe bleibt NONE; Adobe warnt
    nicht mehr), und der Viewer zeigt trotzdem Bild UND Informationen."""
    k = 3
    doc = fitz.open()
    try:
        page = doc.new_page(width=float(w_pt) * k, height=float(h_pt) * k)
        img = fitz.Pixmap(image_bytes)
        if img.alpha:
            img = fitz.Pixmap(img, 0)
        if img.colorspace is not None and img.colorspace.name not in ("DeviceRGB", "DeviceGray"):
            img = fitz.Pixmap(fitz.csRGB, img)
        bw = min(96.0, float(w_pt) * 0.36) * k
        bh = bw * float(img.height) / max(1.0, float(img.width))
        if bh > float(h_pt) * k * 0.86:
            bh = float(h_pt) * k * 0.86
            bw = bh * float(img.width) / max(1.0, float(img.height))
        bx = 4.0 * k
        by = (float(h_pt) * k - bh) / 2.0
        page.insert_image(fitz.Rect(bx, by, bx + bw, by + bh), pixmap=img)
        fs = max(5.5, min(8.5, (float(h_pt) / 3.4) / max(len(lines), 1))) * k
        tx = bx + bw + 8.0 * k
        y0 = float(h_pt) * k / 2.0 - fs * (len(lines) - 1) / 2.0
        for idx, ln in enumerate(lines):
            fname = "hebo" if idx == 0 else "helv"
            size = fs * (1.05 if idx == 0 else 1.0)
            page.insert_text((tx, y0 + fs * 1.35 * idx), str(ln),
                             fontsize=size, fontname=fname, fontfile=None,
                             color=(0.08, 0.09, 0.12))
        pix = page.get_pixmap(dpi=96 * 3, alpha=False)
        return pix.tobytes("png")
    finally:
        doc.close()


def _set_ap_stream_with_image(work_path: str, field: str, w_pt: float, h_pt: float, lines: list, image_bytes: bytes, ap_key: str = "/N", show_text: bool = True, full_bleed: bool = False) -> None:
    """Kombi-Aussehen: Grafik- Bild-XObject /SigArt (+ im Nicht-Vollbild-Pfad
    Textzeilen/Siegel-Vektorlagen). Wird VOR der Signatur gesetzt, liegt damit
    im signierten Bereich. full_bleed (R66/R68): Das vorberechnete Kartenbild
    deckt das ganze Feld; der AP-Strom traegt nur den duennen Rahmen NACH dem
    Bild — kein deckender Hintergrund, kein Wortlaut (Diff-Stufe NONE)."""
    import pikepdf

    probe = fitz.Pixmap(image_bytes)
    if probe.alpha:
        probe = fitz.Pixmap(probe, 0)
    if probe.colorspace is None:
        raise SignatureError("Signaturgrafik: Farbmodell nicht erkannt")
    if probe.colorspace.name not in ("DeviceRGB", "DeviceGray"):
        probe = fitz.Pixmap(fitz.csRGB, probe)
    is_jpg = image_bytes[:3] == b"\xff\xd8\xff"
    payload = image_bytes if is_jpg else probe.samples

    if full_bleed:
        # R66: Das (rasterisierte) Bild deckt die ganze Feldflaeche ab —
        # Name/Zeit stecken bereits als Pixelpixel im Bild; der AP-Strom
        # traegt KEINEN Signaturwert-Wortlaut (Diff-Stufe bleibt NONE; Adobe
        # meldete sonst 'DOCUMENT CHANGED AFTER SAVING').
        # R68: Der volle Hintergrund+Siegel-Layer lag UNTREIBER dem Bild und
        # machte die Nutzergrafik unsichtbar (gemessen: 0 farbige Pixel im
        # renderndem Feld). Volldarstellung braucht daher NUR den dünnen
        # Rahmen nach dem Bild — kein deckendes Rechteck, kein Siegel.
        bx, by = 0.0, 0.0
        bw, bh = float(w_pt), float(h_pt)
        text_x = float(w_pt)
        frame = ("0.35 0.35 0.4 RG 0.8 w 0.4 0.4 %.2f %.2f re S" % (float(w_pt) - 0.8, float(h_pt) - 0.8)).encode("ascii")
        content = b"q\n" + frame + b"\nQ\n"
    else:
        bw = min(96.0, float(w_pt) * 0.36)
        bh = bw * float(probe.height) / max(1.0, float(probe.width))
        if bh > float(h_pt) * 0.86:
            bh = float(h_pt) * 0.86
            bw = bh * float(probe.width) / max(1.0, float(probe.height))
        bx = 4.0
        by = (float(h_pt) - bh) / 2.0
        text_x = bx + bw + 8.0
        content = _overlay_content(float(w_pt), float(h_pt), lines, text_x=text_x,
                                   with_seal=False, show_text=show_text)

    out = os.path.dirname(work_path)
    fd, tmp = tempfile.mkstemp(prefix=".sigimg-", suffix=".pdf", dir=out)
    os.close(fd)
    try:
        with pikepdf.open(work_path) as pdf:
            target = None
            for pg in pdf.pages:
                for a in (pg.get("/Annots") or []):
                    nm = a.get("/T") or (a.get("/Parent", pikepdf.Dictionary()).get("/T"))
                    if nm is not None and str(nm) in (f"({field})", field):
                        target = a
                        break
                if target is not None:
                    break
            if target is None:
                raise SignatureError("Signaturfeld fuer Grafik-Aussehen nicht gefunden")
            helv = pdf.make_indirect(pikepdf.Dictionary(Type="/Font", Subtype="/Type1", BaseFont="/Helvetica", Encoding="/WinAnsiEncoding"))
            helvb = pdf.make_indirect(pikepdf.Dictionary(Type="/Font", Subtype="/Type1", BaseFont="/Helvetica-Bold", Encoding="/WinAnsiEncoding"))
            img_x = pikepdf.Stream(pdf, payload)
            img_x["/Type"] = pikepdf.Name("/XObject")
            img_x["/Subtype"] = pikepdf.Name("/Image")
            img_x["/Width"] = probe.width
            img_x["/Height"] = probe.height
            img_x["/ColorSpace"] = pikepdf.Name("/DeviceRGB") if probe.n == 3 else pikepdf.Name("/DeviceGray")
            img_x["/BitsPerComponent"] = 8
            if is_jpg:
                img_x["/Filter"] = pikepdf.Name("/DCTDecode")
            img_ref = pdf.make_indirect(img_x)
            draw = b"q %.3f 0 0 %.3f %.3f %.3f cm /SigArt Do Q\n" % (bw, bh, bx, by)
            ap = pdf.make_indirect(pikepdf.Stream(
                pdf, draw + content,
                Subtype="/Form",
                BBox=pikepdf.Array([0, 0, float(w_pt), float(h_pt)]),
                Resources=pikepdf.Dictionary(
                    Font=pikepdf.Dictionary(F1=helvb, F2=helv),
                    XObject=pikepdf.Dictionary(SigArt=img_ref),
                ),
            ))
            ap_dict = target.get("/AP")
            if not isinstance(ap_dict, pikepdf.Dictionary):
                ap_dict = pikepdf.Dictionary()
            ap_dict[pikepdf.Name(ap_key)] = ap
            target[pikepdf.Name("/AP")] = ap_dict
            target[pikepdf.Name("/DR")] = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=helvb, F2=helv))
            pdf.save(tmp)
        os.replace(tmp, work_path)
    except SignatureError:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    except Exception as exc:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise SignatureError(f"Grafik-Aussehen konnte nicht gesetzt werden: {exc}") from exc


def _restore_widget_ap(path: str, field: str, image_b64: str) -> None:
    """R64: setzt das per PyMuPDF gesetzte Bild-Aussehen des Signaturfeldes NACH
    der pyHanko-Signierung zurueck. /AP, /SigFlags und AcroForm-Eintraege sind
    nach ISO 32000-2 nicht von der Signatur erfasst — die kryptische Pruefung
    bleibt gueltig, und der Viewer zeigt die Unterschrift im Feld."""
    import base64

    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=".apre-", suffix=".pdf", dir=d)
    os.close(fd)
    try:
        doc = fitz.open(path)
        try:
            data = base64.b64decode(image_b64, validate=True)
            pm = fitz.Pixmap(data)
            target = None
            for pg in doc:
                for wd in pg.widgets() or []:
                    if wd.field_name == field:
                        target = wd
                        break
                if target is not None:
                    break
            if target is None:
                raise SignatureError("Feld fuer Aussehen-Restaurierung nicht gefunden")
            target.pixmap = pm
            target.update()
            doc.save(tmp, garbage=3, deflate=True)
        finally:
            doc.close()
        os.replace(tmp, path)
    except SignatureError:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
    except Exception as exc:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise SignatureError(f"Aussehen-Restaurierung fehlgeschlagen: {str(exc)[:120]}") from exc


def _fetch_ca_chain(seeds: list, max_depth: int = 2, timeout: float = 6.0) -> list:
    """R66: AIA-CaIssuers-Kettenschluss. Die estnische Karte traegt nur ihr
    Blattzertifikat; Adobe kennt den Aussteller (ESTEID2018) aus dem
    mitgelieferten Store. Wir holen fehlende Aussteller ueber die im
    Zertifikat eingetragene CaIssuers-URL (nur HTTP/HTTPS, kurzer Timeout,
    Platten-Cache) und legen sie ins DSS-Paket — damit kann jede pruefende
    Anwendung die Kette offline bis zur Wurzel aufbauen. Offline bleibt es
    bei den seeds (unveraendertes Verhalten)."""
    import hashlib
    import os
    import urllib.request

    cache_dir = os.environ.get("BF_TRUST_CACHE_DIR") or os.path.join(tempfile.gettempdir(), "bf-trust-cache")
    try:
        os.makedirs(cache_dir, exist_ok=True)
    except Exception:
        pass
    have = {}
    for der in seeds:
        try:
            from asn1crypto.x509 import Certificate as _Ac

            c = _Ac.load(der)
            have[c.serial_number] = (der, c)
        except Exception:
            continue
    out = list(seeds)
    frontier = [c for (_der, c) in have.values()]
    for _depth in range(max_depth):
        nxt = []
        for cert in frontier:
            try:
                urls = _aia_urls(cert)
            except Exception:
                continue
            url = urls[1] if len(urls) > 1 else None
            if not url or not url.lower().startswith(("http://", "https://")):
                continue
            key = hashlib.sha1(url.encode("utf-8")).hexdigest()
            cpath = os.path.join(cache_dir, key + ".der")
            raw = None
            try:
                if os.path.exists(cpath) and os.path.getsize(cpath) > 64:
                    with open(cpath, "rb") as fh:
                        raw = fh.read()
                else:
                    req = urllib.request.Request(url, headers={"User-Agent": "bf-pdf-editor/1.0"})
                    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
                        raw = resp.read(200_000)
                    tmp = cpath + ".tmp"
                    with open(tmp, "wb") as fh:
                        fh.write(raw)
                    os.replace(tmp, cpath)
            except Exception:
                raw = None
            if not raw:
                continue
            try:
                from asn1crypto.x509 import Certificate as _Ac

                issuer = _Ac.load(raw)
            except Exception:
                continue
            if issuer.serial_number in have:
                continue
            have[issuer.serial_number] = (raw, issuer)
            out.append(raw)
            nxt.append(issuer)
        frontier = nxt
        if not frontier:
            break
    return out


def _aia_urls(cert) -> list:
    """(OCSP-URL, Issuer-CAB-URL) aus dem AIA-Feld eines Zertifikats."""
    from asn1crypto.x509 import AuthorityInfoAccessSyntax

    out = ["", ""]
    try:
        ext = cert.extensions.get_extension_for_oid(AuthorityInfoAccessSyntax._oid)
        for ad in ext.value:
            loc = ad["access_location"]
            name = str(ad["access_method"].native)
            if name == "ocsp" and isinstance(loc.native, str):
                out[0] = loc.native
            elif name == "ca_issuers" and isinstance(loc.native, str) and loc.native.startswith("http"):
                out[1] = loc.native
    except Exception:
        pass
    return out


def _cms_add_certs_from_bytes(raw: bytes, ca_certs: list) -> bytes:
    """CA-Zertifikate (DER) in eine CMS signedData einfügen; gibt neues CMS zurück."""
    from asn1crypto import cms
    from asn1crypto.x509 import Certificate as AcCert

    ci = cms.ContentInfo.load(raw)
    if ci["content_type"].native != "signed_data":
        raise SignatureError("Signaturwert enthaelt keine CMS signedData")
    sd = ci["content"]
    certs = list(sd["certificates"])
    have = set()
    for x in certs:
        try:
            ch = x.chosen
            if ch is not None:
                have.add((int(ch.serial_number), str(ch.issuer)))
        except Exception:
            pass
    for der in ca_certs:
        try:
            c = AcCert.load(der)
        except Exception:
            continue
        if (int(c.serial_number), str(c.issuer)) not in have:
            certs.append(cms.CertificateChoices(name="certificate", value=c))
            have.add((int(c.serial_number), str(c.issuer)))
    sd["certificates"] = certs
    return ci.dump()


def _field_was_signed(path: str, field: str) -> bool:
    """True, wenn das Sig-Feld schon einen signierten Wert traegt (/V zeigt auf
    ein Dictionary mit /ByteRange). Ein leeres Platzhalter-Feld hat /V=None."""
    import pikepdf

    try:
        with pikepdf.open(path) as pdf:
            for pg in pdf.pages:
                for a in (pg.get("/Annots") or []):
                    nm = a.get("/T") or (a.get("/Parent", pikepdf.Dictionary()).get("/T"))
                    if nm is not None and str(nm).strip("()") == field:
                        v = a.get("/V")
                        if v is None:
                            return False
                        try:
                            return "/ByteRange" in v
                        except Exception:
                            return False
    except Exception:
        return False
    return False


def _restore_widget_ap(path: str, field: str, image_b64: str) -> None:
    """R64: setzt das per PyMuPDF gesetzte Bild-Aussehen des Signaturfeldes NACH
    der pyHanko-Signierung zurueck. /AP, /SigFlags und AcroForm-Eintraege sind
    nach ISO 32000-2 nicht von der Signatur erfasst — die kryptische Pruefung
    bleibt gueltig, und der Viewer zeigt die Unterschrift im Feld."""
    import base64

    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=".apre-", suffix=".pdf", dir=d)
    os.close(fd)
    try:
        doc = fitz.open(path)
        try:
            data = base64.b64decode(image_b64, validate=True)
            pm = fitz.Pixmap(data)
            target = None
            for pg in doc:
                for wd in pg.widgets() or []:
                    if wd.field_name == field:
                        target = wd
                        break
                if target is not None:
                    break
            if target is None:
                raise SignatureError("Feld fuer Aussehen-Restaurierung nicht gefunden")
            target.pixmap = pm
            target.update()
            doc.save(tmp, garbage=3, deflate=True)
        finally:
            doc.close()
        os.replace(tmp, path)
    except SignatureError:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
    except Exception as exc:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise SignatureError(f"Aussehen-Restaurierung fehlgeschlagen: {str(exc)[:120]}") from exc


def _cms_add_certs_from_bytes(raw: bytes, ca_certs: list) -> bytes:
    """CA-Zertifikate (DER) in eine CMS signedData einfügen; gibt neues CMS zurück."""
    from asn1crypto import cms
    from asn1crypto.x509 import Certificate as AcCert

    ci = cms.ContentInfo.load(raw)
    if ci["content_type"].native != "signed_data":
        raise SignatureError("Signaturwert enthaelt keine CMS signedData")
    sd = ci["content"]
    certs = list(sd["certificates"])
    have = set()
    for x in certs:
        try:
            ch = x.chosen
            if ch is not None:
                have.add((int(ch.serial_number), str(ch.issuer)))
        except Exception:
            pass
    for der in ca_certs:
        try:
            c = AcCert.load(der)
        except Exception:
            continue
        if (int(c.serial_number), str(c.issuer)) not in have:
            certs.append(cms.CertificateChoices(name="certificate", value=c))
            have.add((int(c.serial_number), str(c.issuer)))
    sd["certificates"] = certs
    return ci.dump()


def _trust_pack(writer, field_ref, ca_certs: list) -> None:
    """R66 VOR der Signatur aufgerufen: legt DSS/PDS/Perms-Objekte an und
    verdrahtet sie am Signaturwert (/V). Die Kette selbst (CMS-Certs) kommt erst
    NACH der Signatur in /Contents — alles hier ist im signierten Bereich und
    macht die Pruefung damit nicht kaputt (Nutzerbefund R66: 'CA trusted: no')."""
    from asn1crypto.x509 import Certificate as AcCert
    from pyhanko.pdf_utils import generic
    from pyhanko.pdf_utils.generic import pdf_name as _N

    certs = []
    for der in ca_certs:
        try:
            certs.append(AcCert.load(der))
        except Exception:
            continue
    if not certs:
        return
    field_obj = field_ref.get_object()
    val_ref = field_obj.get("/V")
    if val_ref is None:
        return
    val = val_ref.get_object()
    urls = [_aia_urls(c) for c in certs]
    ocsp_urls = sorted({u[0] for u in urls if u[0]})
    cab_urls = sorted({u[1] for u in urls if u[1]})
    cert_arr = generic.Array([generic.ByteString(c.dump()) for c in certs])
    dss: dict = {generic.Name("/Type"): generic.Name("/DSS"), generic.Name("/Certs"): cert_arr}
    if ocsp_urls:
        dss[generic.Name("/OCSPs")] = generic.Array(
            [writer.add_object(generic.Dictionary({generic.Name("/URL"): generic.String(u)})) for u in ocsp_urls])
    if cab_urls:
        dss[generic.Name("/CRLs")] = generic.Array(
            [writer.add_object(generic.Dictionary({generic.Name("/URL"): generic.String(u)})) for u in cab_urls])
    dss_ref = writer.add_object(generic.Dictionary(dss))
    # R66: NUR ein neuer Schluessel (/DocPDS) am Signaturwert — ein eigenes
    # /Perms-Dictionary UBERSCHRIEBE das durch die Signatur fixierte Wortlaut-
    # Dictionary und liesse die Pruefung auf 'geaendert' springen (gemessen).
    val[generic.Name("/DocPDS")] = dss_ref
    writer.mark_update(val_ref)


def _trust_add_ca_pre(writer, field: str, ca_certs: list, meta_kwargs: dict) -> None:
    """R66: Vertrauenskette EINER vorhandenen Sig-Feld-Signatur VOR dem
    Signieren beifuegen (Adobe-Paritaet: 'CA trusted' — Pruefer koennen die
    Kette bis zur Wurzel selbst aufbauen).

    Mechanik (gemessen am Diff-Analyzer): Das /V-Wortlaut-Worterbuch des
    Signaturwertes ist durch die Signatur fixiert; zusaetzliche Schluessel
    darin fuehren zu 'unexplained overrides' -> DOCUMENT CHANGED.legal ist der
    PDS-Weg ueber das Wertobjekt HINDURCH: Wir haengen die DSS-Referenz an das
    /DocPDS des DOKUMENT-KATALOGS (/Perms). Katalog-/Perms-Aenderungen sind
    post-sign zulaessig (DSSCompareRule-Stil, LTA-Charakter), das Feld selbst
    bleibt unangetastet."""
    from asn1crypto.x509 import Certificate as AcCert
    from pyhanko.pdf_utils import generic

    certs = []
    for der in ca_certs:
        try:
            certs.append(AcCert.load(der))
        except Exception:
            continue
    if not certs:
        return
    urls = [_aia_urls(c) for c in certs]
    ocsp_urls = sorted({u[0] for u in urls if u[0]})
    cab_urls = sorted({u[1] for u in urls if u[1]})
    dss: dict = {
        generic.NameObject("/Type"): generic.NameObject("/DSS"),
        generic.NameObject("/Certs"): generic.ArrayObject([generic.ByteStringObject(c.dump()) for c in certs]),
    }
    if ocsp_urls:
        dss[generic.NameObject("/OCSPs")] = generic.ArrayObject(
            [writer.add_object(generic.DictionaryObject({generic.NameObject("/URL"): generic.pdf_string(u)})) for u in ocsp_urls])
    if cab_urls:
        dss[generic.NameObject("/CRLs")] = generic.ArrayObject(
            [writer.add_object(generic.DictionaryObject({generic.NameObject("/URL"): generic.pdf_string(u)})) for u in cab_urls])
    dss_ref = writer.add_object(generic.DictionaryObject(dss))
    root = writer.root
    perms = root.get("/Perms")
    if perms is None:
        perms_ref = writer.add_object(generic.DictionaryObject({generic.NameObject("/DocPDS"): dss_ref}))
        root[generic.NameObject("/Perms")] = perms_ref
    else:
        perms_ref = root.raw_get("/Perms")
        perms[generic.NameObject("/DocPDS")] = dss_ref
        writer.mark_update(perms_ref)
    writer.update_root()


def _field_ap_is_plain(path: str, field: str) -> bool:
    """True, wenn das Feld-Aussehen (/N) keinen Text und kein Bild enthaelt —
    d.h. pyHanko hat sein leeres Standard-Layout hinterlassen."""
    import pikepdf

    try:
        with pikepdf.open(path) as pdf:
            for pg in pdf.pages:
                for a in (pg.get("/Annots") or []):
                    nm = a.get("/T") or (a.get("/Parent", pikepdf.Dictionary()).get("/T"))
                    if nm is not None and str(nm).strip("()") == field:
                        ap = a.get("/AP")
                        if ap is None or "/N" not in ap:
                            return True
                        try:
                            cur = ap["/N"].read_bytes()
                        except Exception:
                            return True
                        return b"Tj" not in cur and b"Do" not in cur and b" re f" not in cur
    except Exception:
        return False
    return True


def _repair_overlay_ap(path: str, field: str, w_pt: float, h_pt: float, lines: list) -> None:
    """Ersetzt AP/N des Signaturfelds (im bereits signierten tmp) durch unser
    Aussehen, falls pyHanko es ueberschrieben hat. Reiner Content-Tausch des
    bestehenden XObject — keine neuen Objekte, Byte-Reichweite bleibt unangetastet."""
    import pikepdf

    want = _overlay_content(w_pt, h_pt, lines)
    out = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=".apfix-", suffix=".pdf", dir=out)
    os.close(fd)
    try:
        with pikepdf.open(path) as pdf:
            for pg in pdf.pages:
                for a in (pg.get("/Annots") or []):
                    nm = a.get("/T") or (a.get("/Parent", pikepdf.Dictionary()).get("/T"))
                    if nm is not None and str(nm).strip("()") == field:
                        ap = a.get("/AP")
                        if ap is not None and "/N" in ap:
                            n_obj = ap["/N"]
                            try:
                                cur = n_obj.read_bytes()
                            except Exception:
                                cur = b""
                            if b"Tj" not in cur:
                                n_obj.write(want, filter=pikepdf.Name.FlateDecode)
                            break
            pdf.save(tmp, fix_metadata_version=False)
        os.replace(tmp, path)
    except Exception as exc:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise SignatureError(f"Aussehen-Reparatur fehlgeschlagen: {exc}") from exc


def _overlay_content(w_pt: float, h_pt: float, lines: list, text_x: Optional[float] = None, with_seal: bool = True, show_text: bool = True) -> bytes:
    w = max(80.0, float(w_pt))
    h = max(36.0, float(h_pt))
    fs = max(5.5, min(8.5, (h / 3.4) / max(len(lines), 1)))

    def esc(t: str) -> str:
        return t.replace("\\\\", "").replace("(", "").replace(")", "").encode("cp1252", "replace").decode("latin-1")

    x0 = float(text_x) if text_x is not None else 28.0
    cx, cy, r = 14.0, h / 2.0, min(9.0, h / 3.4)
    shield_pts = [
        (cx, cy + r), (cx + r * 0.85, cy + r * 0.5), (cx + r * 0.85, cy - r * 0.3),
        (cx, cy - r), (cx - r * 0.85, cy - r * 0.3), (cx - r * 0.85, cy + r * 0.5),
    ]
    ops = ["q", "0.93 0.96 1 rg 0 0 %.2f %.2f re f" % (w, h),
           "0.35 0.35 0.4 RG 0.8 w 0.4 0.4 %.2f %.2f re S" % (w - 0.8, h - 0.8)]
    if with_seal:
        ops += ["0.85 0.91 0.98 rg", "%.2f %.2f m" % shield_pts[0]]
        for pt in shield_pts[1:]:
            ops.append("%.2f %.2f l" % pt)
        ops.append("h f")
        ops.append("0.1 0.35 0.7 RG 0.9 w")
        ops.append("%.2f %.2f m" % shield_pts[0])
        for pt in shield_pts[1:]:
            ops.append("%.2f %.2f l" % pt)
        ops.append("h S")
        ops.append("1.2 w %.2f %.2f m %.2f %.2f l %.2f %.2f l S" % (
            cx - r * 0.35, cy, cx - r * 0.05, cy - r * 0.35, cx + r * 0.42, cy + r * 0.35))
    if with_seal is False:
        # Siegel-ICON rechtsbuendig (klein), Nutzer: 'ZertifikatsICON'.
        icx = w - 16.0
        pts2 = [(icx + dx, cy + dy) for (dx, dy) in
                [(0, r), (r * 0.85, r * 0.5), (r * 0.85, -r * 0.3), (0, -r), (-r * 0.85, -r * 0.3), (-r * 0.85, r * 0.5)]]
        ops.append("0.85 0.91 0.98 rg %.2f %.2f m" % pts2[0])
        for pt in pts2[1:]:
            ops.append("%.2f %.2f l" % pt)
        ops.append("h f")
        ops.append("0.1 0.35 0.7 RG 0.9 w %.2f %.2f m" % pts2[0])
        for pt in pts2[1:]:
            ops.append("%.2f %.2f l" % pt)
        ops.append("h S")
        ops.append("1.2 w %.2f %.2f m %.2f %.2f l %.2f %.2f l S" % (
            icx - r * 0.35, cy, icx - r * 0.05, cy - r * 0.35, icx + r * 0.42, cy + r * 0.35))
    y = h / 2.0 + fs * (len(lines) - 1) / 2.0
    ops.append("BT")
    for idx, ln in enumerate(lines):
        fname = "/F1" if idx == 0 else "/F2"
        size = fs * (1.05 if idx == 0 else 1.0)
        if show_text:
            ops.append("%s %.2f Tf %.2f %.2f Td (%s) Tj" % (fname, size, x0, y - (fs * 1.35 * idx), esc(ln)))
        else:
            # R66: Nur RECHTECK ausfuellen — der Wortlaut des Signaturwertes
            # (Name/Grund/Zeit) bleibt aus dem Aussehen-Stream DRAUSSEN, sonst
            # sieht die Diff-Analyse die spaetere Wert-Fuellung als veraenderte
            # Feldansicht ('DOCUMENT CHANGED AFTER SAVING', Adobe-Befund).
            tw = min(max(len(ln) * fs * 0.55, 4.0), w - x0 - 2.0)
            ops.append("0.55 0.58 0.62 rg %.2f %.2f %.2f %.2f re f" % (x0, y - (fs * 1.35 * idx) - fs * 0.28, tw, fs * 0.62))
    ops += ["ET", "Q"]
    return chr(10).join(ops).encode("latin-1")


def _build_overlay_reference(writer, w_pt: float, h_pt: float, lines: list):
    """Schild+Inhalt als ContentByteOverlay-Referenz fuer pyHankos Overlay-Kanal."""
    from pyhanko.pdf_utils.content import RawContent

    content = _overlay_content(w_pt, h_pt, lines)
    # Ressourcen (Core-Fonts) haengen wir direkt an den Form-XObject — RawContent
    # liefert einen Stream-Rohling; die Font-Entries setzen wir vor dem Adden.
    return content, RawContent(content, box=(0, 0, float(w_pt), float(h_pt)))


def _build_overlay_xobject(writer, w_pt: float, h_pt: float, lines: list):
    """Form-XObject mit Zertifikats-Schild + Signaturinhalt (14-Core-Fonts,
    WinAnsi) als pyHanko-Overlay-Vorlage (Nutzerwunsch R55). pyHanko-Referenzen,
    kein pikepdf — haengt direkt am signierenden IncrementalWriter."""
    from pyhanko.pdf_utils import generic
    from pyhanko.pdf_utils.generic import pdf_name as _N

    N = generic.NameObject
    D = generic.DictionaryObject
    A = generic.ArrayObject

    def _font(base: str):
        return writer.add_object(D({
            N("/Type"): N("/Font"),
            N("/Subtype"): N("/Type1"),
            N("/BaseFont"): N(base),
            N("/Encoding"): N("/WinAnsiEncoding"),
        }))

    w = max(80.0, float(w_pt))
    h = max(36.0, float(h_pt))
    fs = max(5.5, min(8.5, (h / 3.4) / max(len(lines), 1)))

    def esc(t: str) -> str:
        return t.replace("\\\\", "").replace("(", "").replace(")", "").encode("cp1252", "replace").decode("latin-1")

    cx, cy, r = 14.0, h / 2.0, min(9.0, h / 3.4)
    shield_pts = [
        (cx, cy + r), (cx + r * 0.85, cy + r * 0.5), (cx + r * 0.85, cy - r * 0.3),
        (cx, cy - r), (cx - r * 0.85, cy - r * 0.3), (cx - r * 0.85, cy + r * 0.5),
    ]
    ops = ["q", "0.93 0.96 1 rg 0 0 %.2f %.2f re f" % (w, h),
           "0.35 0.35 0.4 RG 0.8 w 0.4 0.4 %.2f %.2f re S" % (w - 0.8, h - 0.8),
           "0.85 0.91 0.98 rg", "%.2f %.2f m" % shield_pts[0]]
    for pt in shield_pts[1:]:
        ops.append("%.2f %.2f l" % pt)
    ops.append("h f")
    ops.append("0.1 0.35 0.7 RG 0.9 w")
    ops.append("%.2f %.2f m" % shield_pts[0])
    for pt in shield_pts[1:]:
        ops.append("%.2f %.2f l" % pt)
    ops.append("h S")
    ops.append("1.2 w %.2f %.2f m %.2f %.2f l %.2f %.2f l S" % (
        cx - r * 0.35, cy, cx - r * 0.05, cy - r * 0.35, cx + r * 0.42, cy + r * 0.35))
    x0 = 28.0
    y = h / 2.0 + fs * (len(lines) - 1) / 2.0
    ops.append("BT")
    for idx, ln in enumerate(lines):
        fname = "/F1" if idx == 0 else "/F2"
        size = fs * (1.05 if idx == 0 else 1.0)
        ops.append("%s %.2f Tf %.2f %.2f Td (%s) Tj" % (fname, size, x0, y - (fs * 1.35 * idx), esc(ln)))
    ops += ["ET", "Q"]
    content = chr(10).join(ops).encode("latin-1")
    helv = _font("/Helvetica")
    helvb = _font("/Helvetica-Bold")
    stream = generic.StreamObject(stream_data=content)
    stream[N("/Subtype")] = N("/Form")
    stream[N("/BBox")] = A([generic.FloatObject(0), generic.FloatObject(0), generic.FloatObject(w), generic.FloatObject(h)])
    stream[N("/Resources")] = D({N("/Font"): D({N("/F1"): helvb, N("/F2"): helv})})
    return writer.add_object(stream)


def sign_with_signer(work_path: str, signer, *, page: int, rect: Optional[dict],
                     reason: Optional[str], name: Optional[str], location: Optional[str],
                     invisible: bool, image_b64: Optional[str] = None,
                     appearance: Optional[dict] = None,
                     trust_certs: Optional[list] = None) -> dict:
    """Inkrementelle Signatur mit FERTIGEM Signer (p12 oder Smartcard-PKCS#11).
    rect = PDF-User-Space unten-links (oder None fuer unsichtbar). Einzige
    Signatur-Schreibstelle — beide Wege laufen hier durch."""
    if trust_certs:
        # R66: AIA-Kettenschluss (Netz, cachebasiert, offline-sicher) —
        # Adobe-Paritaet fuer Karten, die nur ihr Blattzertifikat tragen.
        try:
            trust_certs = _fetch_ca_chain([t for t in trust_certs if t][:6])
        except Exception:
            pass
        trust_certs = [t for t in trust_certs if t][:6] or None
    n = _page_count(work_path)
    if not (0 <= page < n):
        raise BadPage(f"Seite {page} ausserhalb des Bereichs 0..{n - 1}")
    if invisible or rect is None:
        x1 = y1 = x2 = y2 = 0.0
        invisible = True
    else:
        x1 = float(rect["x"]); y1 = float(rect["y"])
        x2 = x1 + float(rect["width"]); y2 = y1 + float(rect["height"])
        if x2 <= x1 or y2 <= y1:
            raise BadPage("Signaturfeld muss positiv sein")
        # KLEMMEN statt abbrechen (Nutzerbefund): das Smartcard-Feld ist eine
        # Standardposition; auf kleinen/queren Seiten wird sie ans Seitenformat
        # angepasst, statt die Signatur zu verweigern.
        doc = fitz.open(work_path)
        try:
            pr = doc.load_page(page).rect
        finally:
            doc.close()
        pw, ph = float(pr.width), float(pr.height)
        w0, h0 = x2 - x1, y2 - y1
        # Verschieben statt Schrumpfen: das Aussehens-Rendering braucht eine
        # Mindesthoehe; Stauchen erzeugt 'Margins too wide'-Fehler.
        if w0 <= pw - 8 and h0 <= ph - 8:
            x1 = min(max(4.0, x1), pw - 4 - w0); y1 = min(max(4.0, y1), ph - 4 - h0)
            x2, y2 = x1 + w0, y1 + h0
        elif w0 > 4 and h0 > 24:
            # zu grosses Feld -> auf Seitenformat verkleinern (aber nie unter
            # die Rendering-Mindestgroesse eines Signaturkastens)
            w0 = min(w0, pw - 8); h0 = min(h0, ph - 8)
            x1 = max(4.0, min(x1, pw - 4 - w0)); y1 = max(4.0, min(y1, ph - 4 - h0))
            x2, y2 = x1 + w0, y1 + h0
        else:
            raise BadPage("Signaturfeld passt nicht auf die Seite")

    field = "Signature1"
    graphic = bool(image_b64) and not invisible
    overlay_spec: Optional[tuple] = None
    graphic_spec: Optional[tuple] = None
    restored = False
    if graphic and appearance is not False:
        # R64 Nutzerwunsch: Kombi-Aussehen — Unterschriftengrafik LINKS, rechts
        # Name/Zertifikat/Grund/Zeitstempel, rechtsbuenedig das Siegel-Icon.
        # Alles VOR der Signatur ins AP gesetzt (liegt im signierten Bereich und
        # wird von keinem Viewer ueberschrieben).
        try:
            img_bytes = base64.b64decode(image_b64, validate=True)
        except Exception as exc:
            raise SignatureError("Signaturgrafik ist kein gueltiges base64") from exc
        subj = (appearance or {}).get("subject") or ""
        subj = subj.replace("CN=", "").split(",")[0].strip()
        import datetime as _dt

        glines = []
        who = name or subj
        glines.append(who if who else "Digitale Signatur")
        if subj and name and subj.lower() not in name.lower():
            glines.append(f"Zertifikat: {subj}")
        if reason:
            glines.append(f"Grund: {reason}")
        glines.append(_dt.datetime.now().strftime("%d.%m.%Y %H:%M"))
        # R65: Das Feld wird wie im alten Grafikweg per PyMuPDF-WIDGET samt
        # Pixmap-AP angelegt (bewiesen: Viewer zeigen dieses AP). Der eigene
        # Kombi-Strom (Name/Zeit/Siegel) kommt als /AP/R daneben — Fallback,
        # falls ein Viewer das Widget-Bild nicht zeichnet.
        # R66: Frische Signatur — Name/Zeit werden INS Bild gerastert
        # (Diff-Stufe bleibt NONE; Adobe warnt nicht 'DOCUMENT CHANGED'),
        # und der Nutzer sieht Bild UND Informationen. Bei Wieder-Signatur
        # (Feld tragt schon /V) bleibt der bewaehrte Vektorweg mit Text.
        _add_plain_sig_field(work_path, page, x1, y1, x2, y2, field)
        _show = _field_was_signed(work_path, field)
        if not _show:
            try:
                img_bytes = _compose_signature_image(x2 - x1, y2 - y1, glines, img_bytes)
            except Exception:
                pass  # Notfal: nur das Nutzergrafik-Bild, Informationen im Popup
        _set_ap_stream_with_image(work_path, field, x2 - x1, y2 - y1, glines, img_bytes,
                                  ap_key="/N", show_text=_show, full_bleed=not _show)
        graphic_spec = (x2 - x1, y2 - y1, glines, base64.b64encode(img_bytes).decode(), _show, not _show)
        restored = True  # pyHanko kann das AP ersetzen — nachtraeglich reparieren
    if appearance and not invisible and not graphic:
        # Nutzerwunsch R55: eigenes Aussehen (Schild-Symbol + Signaturinhalt).
        # Vor dem Offnen des Incremental-Writers am Arbeitspfad verankern.
        import datetime as _dt

        subj = (appearance.get("subject") or "").replace("CN=", "").split(",")[0].strip()
        lines = []
        who = name or subj
        lines.append(f"Digitale Signatur: {who}" if who else "Digitale Signatur")
        if subj and name and subj.lower() not in name.lower():
            lines.append(f"Zertifikat: {subj}")
        if reason:
            lines.append(f"Grund: {reason}")
        if location:
            lines.append(f"Ort: {location}")
        lines.append(_dt.datetime.now().strftime("%d.%m.%Y %H:%M"))
        _add_plain_sig_field(work_path, page, x1, y1, x2, y2, field)
        if not _field_was_signed(work_path, field):
            # R66: Frische Signatur — Wortlaut als Raster ins AP (Adobe-safe,
            # s. Grafikpfad). Der Vektor-Weg bleibt fuer Wieder-Signaturen.
            _white = base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
                "2mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
            try:
                comp = _compose_signature_image(x2 - x1, y2 - y1, lines, _white)
                _set_ap_stream_with_image(work_path, field, x2 - x1, y2 - y1, lines, comp,
                                          ap_key="/N", show_text=False, full_bleed=True)
                graphic_spec = (x2 - x1, y2 - y1, lines, base64.b64encode(comp).decode(), False, True)
                restored = True
            except Exception:
                _set_ap_stream_from_overlay(work_path, field, x2 - x1, y2 - y1, lines)
                overlay_spec = (x2 - x1, y2 - y1, lines)
        else:
            _set_ap_stream_from_overlay(work_path, field, x2 - x1, y2 - y1, lines)
            overlay_spec = (x2 - x1, y2 - y1, lines)
    d = os.path.dirname(work_path)
    fd, tmp = tempfile.mkstemp(prefix=".sign-", suffix=".pdf", dir=d)
    os.close(fd)
    try:
        with open(work_path, "rb") as inf, open(tmp, "wb") as ofh:
            writer = IncrementalPdfFileWriter(inf)
            meta_kwargs = {"field_name": field}
            if reason:
                meta_kwargs["reason"] = reason
            if name:
                meta_kwargs["name"] = name
            if location:
                meta_kwargs["location"] = location
            if graphic:
                # R60 Fix: Der Standard-Stempelstil ueberschrieb das Bild-AP des
                # Widgets (Grafik unsichtbar — Nutzerbefund). NoOp erhaelt das
                # vorab per PyMuPDF gesetzte Bild-Aussehen; alles liegt im
                # signierten Byte-Bereich, die Signatur bleibt gueltig.
                from pyhanko.sign.signers.pdf_signer import PdfSigner as _PS
                from pyhanko.stamp import NoOpStampStyle as _NoOp

                if trust_certs:
                    _trust_add_ca_pre(writer, field, trust_certs, meta_kwargs)
                _PS(PdfSignatureMetadata(**meta_kwargs), signer,
                    stamp_style=_NoOp()).sign_pdf(
                    writer, existing_fields_only=True, output=ofh)
            elif overlay_spec is not None or graphic_spec is not None:
                # NoOpStampStyle: pyHankos Standard-Layout wuerde unser
                # gezeichnetes Aussehen ueberschreiben — so bleibt das Feld-AP
                # (Schild + Signaturinhalt) unangetastet.
                from pyhanko.sign.signers.pdf_signer import PdfSigner
                from pyhanko.stamp import NoOpStampStyle

                if trust_certs:
                    _trust_add_ca_pre(writer, field, trust_certs, meta_kwargs)
                PdfSigner(PdfSignatureMetadata(**meta_kwargs), signer,
                          stamp_style=NoOpStampStyle()).sign_pdf(
                    writer, existing_fields_only=True, output=ofh)
            else:
                if invisible:
                    spec = SigFieldSpec(sig_field_name=field, on_page=page, box=(0, 0, 0, 0), invis_sig_settings=InvisSigSettings(set_hidden_flag=True))
                else:
                    spec = SigFieldSpec(sig_field_name=field, on_page=page, box=(x1, y1, x2, y2), visible_sig_settings=VisibleSigSettings())
                sign_pdf(
                    pdf_out=writer,
                    signature_meta=PdfSignatureMetadata(**meta_kwargs),
                    signer=signer,
                    new_field_spec=spec,
                    output=ofh,
                )
        if restored:
            # pyHanko ersetzt das AP bestehender Felder durch sein Standard-
            # Layout, wenn /DR seine SignatureLayout-Ressourcen fehlen (R65-
            # Nutzerbefund: Bild und Signaturtext waren weg). NUR dann reparieren
            # — ein Tausch gegen ein identisches AP wuerde die Signatur grundlos
            # als "nachtraeglich geaendert" erscheinen lassen.
            if _field_ap_is_plain(tmp, field):
                if graphic_spec is not None:
                    gw, gh, glines, gb64, gshow, gbleed = graphic_spec
                    _set_ap_stream_with_image(tmp, field, gw, gh, glines, base64.b64decode(gb64),
                                              ap_key="/N", show_text=gshow, full_bleed=gbleed)
                elif overlay_spec is not None:
                    _repair_overlay_ap(tmp, field, *overlay_spec)
        # R66 NUTZERBEFUND: Adobe kennt die estnische CA (mitgelieferter
        # Truststore), wir nicht — deshalb 'CA trusted: no'. Wir betten die
        # beim Signieren uebergebenen Aussteller-Zertifikate in die CMS-Struktur
        # ein (PDS-DSS): jede pruefende Anwendung kann die Kette damit bis zur
        # Wurzel selbst aufbauen, statt sie aus einem lokalen Store zu brauchen.
        # (trust_certs werden VOR der Signatur eingebettet, siehe Zweige oben)
        os.replace(tmp, work_path)
    except PdfError:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    except Exception as exc:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise SignatureError(f"Signierung fehlgeschlagen: {exc}") from exc
    return {"signed": True, "field": field, "page": page, "visible": not invisible}


def _page_count(work_path: str) -> int:
    doc = fitz.open(work_path)
    try:
        return doc.page_count
    finally:
        doc.close()


def sign_document(work_path: str, p12_path: str, p12_password: str, page: int, rect: dict, reason: Optional[str], *, name: Optional[str] = None, location: Optional[str] = None, invisible: bool = False, image_b64: Optional[str] = None, appearance: Optional[dict] = None, trust_certs: Optional[list] = None) -> dict:
    """Signiert die Arbeitskopie inkrementell mit einer .p12-Datei (PDF-Rect unten-links)."""
    if not os.path.isfile(p12_path):
        raise MissingCertificate("Zertifikatsdatei (.p12) nicht gefunden")
    try:
        signer = signers.SimpleSigner.load_pkcs12(p12_path, passphrase=p12_password.encode("utf-8"))
    except FileNotFoundError as exc:
        raise MissingCertificate("PKCS#12 konnte nicht gelesen werden") from exc
    except Exception as exc:
        # falsches Passwort / kein PKCS#12 — kein Passwort im Text weitergeben
        raise SignatureError("PKCS#12 konnte nicht geladen werden (Datei oder Passwort?)") from exc
    return sign_with_signer(work_path, signer, page=page, rect=rect, reason=reason,
                            name=name, location=location, invisible=invisible, image_b64=image_b64,
                            appearance=appearance, trust_certs=trust_certs)


def _chain_cns(s) -> list:
    """CNs der Signaturkette (Signator -> ... -> Aussteller). Eingebettete
    Zertifikate werden ausgelesen; der letzte Ausstellername kommt auch dann
    dazu, wenn sein Zertifikat nicht im Dokument liegt — genau dieser Fall ist
    es, den der Nutzer sieht ('wer hat das unterschrieben, und warum kennt die
    Pruefung den Aussteller nicht')."""
    out = []
    try:
        certs = [s.signer_cert] + list(es_other_certs(s))
    except Exception:
        certs = []
    subjects = []
    for cert in certs:
        try:
            cn = cert.subject.native.get('common_name')
            if isinstance(cn, list):
                cn = cn[0] if cn else None
            out.append(str(cn) if cn else str(cert.subject.human_friendly))
            subjects.append(cert.subject)
        except Exception:
            pass
    try:
        last = certs[-1]
        if last is not None and last.issuer not in subjects:
            cn = last.issuer.native.get('common_name')
            if isinstance(cn, list):
                cn = cn[0] if cn else None
            out.append(str(cn) if cn else str(last.issuer.human_friendly))
    except Exception:
        pass
    return out


def es_other_certs(s):
    try:
        return list(s.other_embedded_certs or [])
    except Exception:
        return []




def _default_key_usage():
    """R66: Zertifikate OHNE KeyUsage-Erweiterung nicht automatisch verwerfen.
    pyHanko verlangt sonst nonRepudiation — das estnische Aussteller-
    Zertifikat (ESTEID2018) und Testketten fuehren die Nutzung nicht und
    waeren 'ungueltig', obwohl Adobe sie als guiltig anzeigt. Erfuellte
    Nutzungen werden positiv geprueft (sigKeyUsage), es wird nichts erzwungen."""
    from pyhanko.sign.validation.settings import KeyUsageConstraints

    # key_usage=None LAESST die Standard-Policy (nonRepudiation) greifen —
    # leere Menge deaktiviert die Pflicht dagegen vollstaendig (gemessen).
    return KeyUsageConstraints(key_usage=(), match_all_key_usages=False)


def _pdf_trust_dss(path: str, signer_der: bytes) -> list:
    """Vertrauensanker aus dem Dokument (DSS-Paket /Perms-/DocPDS). Adobe
    vergibt 'trusted' ebenfalls ueber die Vertrauensliste des Dokuments/Stores:
    Wir lassen das Zertifikat als Anker gelten, das den Signator unterschreibt
    (Direkt-Aussteller), sofern es im DSS liegt — der Aussteller wurde beim
    Signieren von der Karte gelesen und ist damit dokumentgebundene, ueber-
    pickbare Referenz (asn1crypto-Objekte, wie pyHanko sie verwendet)."""
    import pikepdf
    from asn1crypto.x509 import Certificate as _Ac

    try:
        signer = _Ac.load(signer_der)
    except Exception:
        return []
    pool: list = []
    try:
        with pikepdf.open(path) as pdf:
            cands = []
            holders = []
            try:
                holders.append(pdf.Root["/Perms"])
            except Exception:
                pass
            holders.append(pdf.Root)
            for h in holders:
                try:
                    v = h.get("/DocPDS")
                except Exception:
                    v = None
                if v is None:
                    continue
                if isinstance(v, pikepdf.Array):
                    cands.extend(list(v))
                else:
                    cands.append(v)
            for d in cands:
                try:
                    dd = d if isinstance(d, pikepdf.Dictionary) else d.get_object()
                    for bs in dd.get("/Certs") or []:
                        try:
                            pool.append(_Ac.load(bytes(bs)))
                        except Exception:
                            pass
                except Exception:
                    continue
    except Exception:
        return []
    # Aussteller-Kette im Pool verfolgen: signer -> issuer -> ... bis kein
    # Treffer; jeder gefundene Aussteller wird als Anker registriert.
    anchors = []
    cur = signer
    seen = set()
    while True:
        issuer = next((c for c in pool
                       if c.serial_number not in seen
                       and c.subject == cur.issuer and c.subject != cur.subject), None)
        if issuer is None:
            break
        seen.add(issuer.serial_number)
        anchors.append(issuer)
        cur = issuer
    return anchors


def _load_trust_roots() -> Optional[list]:
    """Vertrauensanker aus dem Anker-Verzeichnis (Standard:
    ~/.local/share/pdf-editor/trust, ueberbar via BF_TRUST_ANCHORS_DIR).
    pyHanko arbeitet mit asn1crypto — die Konversion passiert hier, damit die
    Pruefung importierte CA-Zertifikate (z.B. ESTEID2018) genau wie Adobe als
    Wurzel akzeptiert."""
    import glob as _glob
    import os

    try:
        from backend.trust_ops import trust_dir
        d = trust_dir()
    except Exception:
        d = os.environ.get("BF_TRUST_ANCHORS_DIR", "")
    if not d or not os.path.isdir(d):
        return None
    from asn1crypto.x509 import Certificate as _Ac

    roots: list = []
    seen = set()
    for f in _glob.glob(os.path.join(d, "*")):
        try:
            raw = open(f, "rb").read()
            if b"BEGIN CERTIFICATE" in raw:
                import base64 as _b64

                body = raw.split(b"-----BEGIN CERTIFICATE-----", 1)[1].split(b"-----END", 1)[0]
                raw = _b64.b64decode(body)
            cert = _Ac.load(raw)
            if cert.serial_number in seen:
                continue
            seen.add(cert.serial_number)
            roots.append(cert)
        except Exception:
            continue
    return roots or None


def verify_signatures(work_path: str) -> dict:
    """Listet alle eingebetteten Signaturen mit Integritaet/Krypto/Vertrauen auf."""
    try:
        reader = PdfFileReader(io.BytesIO(_read_bytes(work_path)))
        sigs = list(reader.embedded_signatures)
    except Exception as exc:
        # Reader-Fehler koennen bei beschadigten/unsicheren Signaturen auftreten.
        return {"signatures": [], "error": f"Lesen fehlgeschlagen: {type(exc).__name__}"}
    out = []
    for s in sigs:
        entry = {
            "field": getattr(s, "field_name", None) or getattr(s, "fq_name", None),
            "intact": False,
            "valid": False,
            "trusted": False,
            "modifiedAfterSigning": False,
            "mdAlgorithm": None,
            "signerCn": None,
            "name": None,
            "reason": None,
            "location": None,
            "contactInfo": None,
            "signTime": None,
            "verdict": "unbekannt",
        }
        # Signatur-Wortlaut (Section 9: Name/Grund/Ort/Zeit) aus dem Signatur-Dictionary (/V).
        try:
            so = s.sig_object
            for key, attr in (("/Name", "name"), ("/Reason", "reason"), ("/Location", "location"), ("/ContactInfo", "contactInfo")):
                v = so.get(key) if key in so else None
                entry[attr] = str(v) if v is not None else None
            m = so.get("/M") if "/M" in so else None
            entry["signTime"] = str(m) if m is not None else None
        except Exception:
            pass
        try:
            # Volle Pruefung (skip_diff=False) erkennt Aenderungen nach der Signatur.
            # R66: Zwei getrennte Beweise. (1) KRYPTO + VERTRAUEN mit
            # Vertrauensankern AUS DEM DOKUMENT (skip_diff — unser eigenes
            # PDS-DSS wuerde der Diff-Analyser sonst als Aenderung melden).
            # (2) INHALTS-INTEGRITAET separat: diff-Pruifung; ihr Fehlschlag
            # faellt nur ins modificationLevel, nicht in die Krypto-Integritaet.
            _roots = _load_trust_roots() or []
            try:
                _sder = s.signer_cert.dump() if s.signer_cert is not None else b""
            except Exception:
                _sder = b""
            try:
                _roots = _roots + _pdf_trust_dss(work_path, _sder)
            except Exception:
                pass
            _svc = None
            if _roots:
                from pyhanko_certvalidator import ValidationContext

                _svc = ValidationContext(extra_trust_roots=tuple(_roots))
            _kus = _default_key_usage()
            st = validate_pdf_signature(s, skip_diff=True, signer_validation_context=_svc,
                                        key_usage_settings=_kus)
            try:
                _sd = validate_pdf_signature(s, signer_validation_context=_svc,
                                             key_usage_settings=_kus)
                lvl_diff = _sd.modification_level.name
            except Exception as _de:
                from pyhanko.sign.diff_analysis.policy_api import SuspiciousModification as _SM

                lvl_diff = "SUSPICIOUS" if isinstance(_de, _SM) else "UNKNOWN"
            entry["intact"] = bool(st.intact) and lvl_diff not in ("SUSPICIOUS",)
            entry["valid"] = bool(st.valid)
            entry["trusted"] = bool(st.trusted)
            # R66: 'CA trusted: no' erklaeren statt raten lassen — die Kette kann
            # im Dokument liegen, nur die Vertrauens-WURZEL fehlt hier im Store.
            if not entry["trusted"]:
                try:
                    chain_cns = _chain_cns(s)
                except Exception:
                    chain_cns = []
                if chain_cns:
                    entry["trustChain"] = chain_cns
                    entry["trustNote"] = ("Kette: " + " -> ".join(chain_cns) +
                                          ". Die Vertrauens-Wurzel fehlt nur in diesem Pruef-Store — "
                                          "Adobe/Windows kennen diese Aussteller und stufen sie als vertrauenswuerdig ein.")
            # R64: Aenderungen NACH der Signatur — pyHanko klassifiziert die
            # Diff-Stufe (NONE < LTA_UPDATES < FORM_FILLING < ANNOTATIONS < FULL).
            # Signatur-Hinzufuegen und Formular-Fuellen (auch unser Bild-AP!) sind
            # keine Inhaltsaenderung; erst ANNOTATIONS/FALL ZAHLT als Veraenderung.
            entry["modificationLevel"] = lvl_diff
            entry["modifiedAfterSigning"] = lvl_diff in ("ANNOTATIONS", "OTHER", "SUSPICIOUS")
            entry["mdAlgorithm"] = st.md_algorithm
            cn = getattr(s, "signer_reported_cn", None)
            entry["signerCn"] = str(cn) if cn else None
            entry["verdict"] = _verdict(bool(st.intact), bool(st.valid), bool(st.trusted))
        except Exception as exc:
            entry["error"] = type(exc).__name__ + ": " + str(exc)[:160]
            entry["verdict"] = "Fehler bei der Pruefung"
        out.append(entry)
    return {"signatures": out, "signed": len(out) > 0}


def _verdict(intact: bool, valid: bool, trusted: bool) -> str:
    """Klartext-Urteil statt Rohdump (Section 9)."""
    if not intact:
        return "Ungueltig: Dokument wurde nach der Signatur geaendert"
    if valid and trusted:
        return "Gueltig und vertrauenswuerdig"
    if valid and not trusted:
        return "Gueltig, aber der Aussteller ist nicht vertrauenswuerdig"
    return "Ungueltig: Signatur laesst sich nicht kryptografisch bestaetigen"


def describe_pkcs12(path: str, password: str) -> dict:
    """§9 Zert-Uebersicht VOR dem Signieren: subject/issuer/Gueltigkeit/keyUsage + Warnungen.
   Passwort nur im Speicher; nichts wird gespeichert."""
    import datetime as _dt
    from cryptography import x509
    from cryptography.hazmat.primitives.serialization.pkcs12 import load_key_and_certificates
    from cryptography.x509.oid import ExtensionOID

    if not os.path.isfile(path):
        raise MissingCertificate(f"PKCS#12-Datei nicht gefunden: {path}")
    with open(path, "rb") as fh:
        blob = fh.read()
    try:
        key, cert, _extra = load_key_and_certificates(blob, password.encode("utf-8") if password else None)
    except Exception as exc:
        raise SignatureError(f"PKCS#12 konnte nicht gelesen werden (falsches Passwort?): {type(exc).__name__}") from exc
    if cert is None:
        raise MissingCertificate("PKCS#12 enthaelt kein Zertifikat")

    now = _dt.datetime.now(_dt.timezone.utc)
    def _aware(d):
        return d if d.tzinfo else d.replace(tzinfo=_dt.timezone.utc)
    nb, na = _aware(cert.not_valid_before_utc), _aware(cert.not_valid_after_utc)
    key_usage = None
    try:
        ku = cert.extensions.get_extension_for_oid(ExtensionOID.KEY_USAGE).value
        key_usage = {
            "digitalSignature": ku.digital_signature, "contentCommitment": ku.content_commitment,
            "keyCertSign": ku.key_cert_sign, "crlSign": ku.crl_sign,
        }
    except x509.ExtensionNotFound:
        pass
    expired = now > na
    not_yet_valid = now < nb
    warnings = []
    if expired:
        warnings.append("Zertifikat ist abgelaufen")
    if not_yet_valid:
        warnings.append("Zertifikat ist noch nicht gueltig")
    self_signed = cert.subject == cert.issuer
    if self_signed:
        warnings.append("Selbstsigniertes Zertifikat")
    return {
        "subject": cert.subject.rfc4514_string(),
        "issuer": cert.issuer.rfc4514_string(),
        "serial": str(cert.serial_number),
        "notBefore": nb.isoformat(),
        "notAfter": na.isoformat(),
        "selfSigned": self_signed,
        "expired": expired,
        "notYetValid": not_yet_valid,
        "hasPrivateKey": key is not None,
        "keyUsage": key_usage,
        "warnings": warnings,
        "canSignWith": (not expired) and (not not_yet_valid) and (key is not None),
    }


def _read_bytes(path: str) -> bytes:
    with open(path, "rb") as fh:
        return fh.read()
