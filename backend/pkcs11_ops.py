"""Smartcard-/PKCS#11-Signatur (Nutzerwunsch Runde 52): Signaturen von der echten Karte
lesen und Dokumente damit unterschreiben.

Echt verifiziert (dieses System): IDEMIA-Karte im Alcor-Leser ueber
/usr/lib64/pkcs11/opensc-pkcs11.so — Zertifikat OHNE PIN auslesbar (CN-Subjekt,
KA_ID), private Schluessel erst nach Login. pyHanko liefert PKCS11SigningContext/
-PKCS11Signer; wir speisen den Signer in denselben sign_pdf-Pfad ein wie die
.p12-Signatur (crypt_ops), inkl. sichtbarem Feld/unsichtbarer Signatur/Grafik.

PIN-Behandlung: PINs werden NIE geloogt, NIE in Dateien/Responses abgelegt und nur
funktional weitergereicht (pyHanko > Token). Karten-PIN (Login) und optionale
Signatur-PIN (z. B. PIN2 bei Berufsausweisen) sind getrennte Felder.
"""

from __future__ import annotations

import base64
import logging
from typing import Any, Optional

log = logging.getLogger("pdf-editor")


class Pkcs11Error(__import__("backend.pdflib", fromlist=["PdfError"]).PdfError):
    """Ueber PdfError: sauberer 4xx + Fehlercode statt HTTP-500 (Nutzerbefund 500)."""
    code = "pkcs11_error"
    status = 422


def _classify_pkcs11_exc(exc: Exception) -> "Pkcs11Error":
    """python-pkcs11/pyHanko-Fehler in klare, bedienbare Meldungen uebersetzen.
    Klasse UND Text zaehlen (python-pkcs11 liefert teils leere Messages).
    Niemals die PIN selbst in der Meldung."""
    blob = f"{exc} {type(exc).__name__} {type(exc).__mro__}".lower()
    if "cancel" in blob or "aborted" in blob:
        return Pkcs11Error("Vorgang an der Karte abgebrochen")
    if "incorrect" in blob or "bad_pin" in blob or "pin is bad" in blob:
        return Pkcs11Error("PIN ist falsch. Bitte erneut eingeben.")
    if "locked" in blob or "lock" in blob:
        return Pkcs11Error("PIN gesperrt. Entsperren noetig (z.B. Kartensoftware).")
    if "pin" in blob and ("invalid" in blob or "len" in blob or "range" in blob):
        return Pkcs11Error("PIN ungueltig (Laenge?) — bitte Karten-PIN verwenden.")
    if "pin" in blob:
        return Pkcs11Error("Karte lehnt die PIN ab (falsch oder gesperrt).")
    return Pkcs11Error(f"Karten-Vorgang fehlgeschlagen: {str(exc)[:120]}")


# Ubliche OpenSC-Pfade (Fedora/Debian) + p11-kit-Proxy; existierende werden getestet.
_CANDIDATE_MODULES = [
    "/usr/lib64/pkcs11/opensc-pkcs11.so",
    "/usr/lib64/pkcs11/onepin-opensc-pkcs11.so",
    "/usr/lib/x86_64-linux-gnu/pkcs11/opensc-pkcs11.so",
    "/usr/lib/pkcs11/opensc-pkcs11.so",
    "/usr/share/p11-kit/modules/p11-kit-proxy.so",
    "/usr/lib64/pkcs11/p11-kit-client.so",
]


def available_modules() -> list[str]:
    import os

    return [p for p in _CANDIDATE_MODULES if os.path.exists(p)]


def _lib(module_path: str):
    import pkcs11

    try:
        return pkcs11.lib(module_path)
    except Exception as exc:  # noqa: BLE001
        raise Pkcs11Error(f"PKCS#11-Modul nicht ladbar: {module_path}") from exc


def list_devices(module_path: Optional[str] = None) -> dict:
    """Karten ohne PIN lesen: Geschaeft nur mit Token-Slots."""
    mods = [module_path] if module_path else available_modules()
    devices: list[dict[str, Any]] = []
    seen_errors: list[str] = []
    for mp in mods:
        try:
            lib = _lib(mp)
        except Pkcs11Error as exc:
            seen_errors.append(str(exc))
            continue
        for slot in lib.get_slots():
            try:
                tok = slot.get_token() if hasattr(slot, "get_token") else getattr(slot, "token", None)
            except Exception:  # noqa: BLE001
                tok = None
            if tok is None:
                continue
            try:
                devices.append({
                    "module": mp,
                    "slot": int(slot.slot_id),
                    "label": str(tok.label).strip(),
                    # R59/60 Nutzerbefund: Karten fuehren PIN1 (Authentication) und
                    # PIN2 (Signatur) als eigene Token-Slots. Die Label der Karte
                    # enthalten den PIN-Hinweis — ans UI durchreichen, damit der
                    # Nutzer weis, welcher Slot die Signatur-PIN verlangt.
                    "pinHint": "(PIN2)" if "PIN2" in str(tok.label) else ("(PIN1)" if "PIN1" in str(tok.label) else ""),
                    "manufacturer": str(tok.manufacturer_id).strip(),
                    "model": str(tok.model).strip(),
                })
            except Exception as exc:  # noqa: BLE001
                seen_errors.append(f"slot {getattr(slot, 'slot_id', '?')}: {exc}")
    return {"devices": devices, "modules": available_modules(), "errors": seen_errors}


def list_certificates(module_path: str, slot_id: int) -> dict:
    """Oeffentliche Zertifikate der Karte (ohne Login). Key-Referenz wird best effort
    mitgenommen: viele Karten fuehren denselben CKA_ID fuer CERT und PRIVATE_KEY."""
    from pkcs11 import Attribute, ObjectClass

    lib = _lib(module_path)
    target = None
    for slot in lib.get_slots():
        if int(slot.slot_id) == int(slot_id) and (slot.flags and 0x01):
            target = slot
            break
    if target is None:
        raise Pkcs11Error(f"Slot {slot_id} hat keine Karte")
    try:
        sess = target.get_token().open()
    except Exception as exc:  # noqa: BLE001
        raise Pkcs11Error("Karte kann nicht geoeffnet werden") from exc
    out = []
    cert_ders: dict[str, str] = {}
    try:
        key_ids: list[bytes] = []
        try:
            for k in sess.get_objects([(Attribute.CLASS, ObjectClass.PRIVATE_KEY)]):
                if k[Attribute.ID]:
                    key_ids.append(bytes(k[Attribute.ID]))
        except Exception:  # noqa: BLE001 - key-Aufzaehlung kann Login brauchen
            pass
        for c in sess.get_objects([(Attribute.CLASS, ObjectClass.CERTIFICATE)]):
            val = bytes(c[Attribute.VALUE]) if c[Attribute.VALUE] else b""
            if not val:
                continue
            cid = bytes(c[Attribute.ID]) if c[Attribute.ID] else b""
            lbl = c[Attribute.LABEL]
            if isinstance(lbl, bytes):
                lbl = lbl.decode("utf-8", "replace")
            info: dict[str, Any] = {"id": cid.hex(), "label": lbl or ""}
            try:
                from cryptography import x509 as cx

                cert = cx.load_der_x509_certificate(val)
                cn = cert.subject.get_attributes_for_oid(cx.NameOID.COMMON_NAME)
                info["subject"] = cn[0].value if cn else cert.subject.rfc4514_string()[:60]
                info["notAfter"] = cert.not_valid_after_utc.isoformat()
                info["algorithm"] = str(cert.signature_algorithm_oid.dotted_string)
                # R60: Detail-Popup (Nutzerwunsch) — volle Daten ohne Login.
                import hashlib

                info["subjectFull"] = cert.subject.rfc4514_string()
                info["issuerFull"] = cert.issuer.rfc4514_string()
                nb = getattr(cert, "not_valid_before_utc", None) or cert.not_valid_before
                info["notBefore"] = (nb if isinstance(nb, __import__("datetime").datetime) else nb).isoformat() if nb else None
                info["serial"] = format(cert.serial_number, "x")
                info["sha1"] = hashlib.sha1(cert.fingerprint(hashes.SHA256()) if False else cert.fingerprint(__import__("cryptography.hazmat.primitives.hashes", fromlist=["SHA1"]).SHA1())).hexdigest()
                info["keyBits"] = getattr(cert.public_key(), "key_size", None)
            except Exception as exc:  # noqa: BLE001
                info["subject"] = f"(Zertifikat nicht lesbar: {str(exc)[:30]})"
            # Schluessel existiert oft unter derselben ID (PKCS#15-Karten) oder wurde
            # gefunden — hasKey ist Hinweis, keine Garantie (Login kann Liste aendern).
            info["hasKey"] = (cid in key_ids) or bool(cid)
            out.append(info)
            # R66: Die rohen DER-Ketten bleiben serverseitig (session-eigener
            # Cache) — der Signierpfad haengt die Aussteller-Zertifikate als
            # Vertrauensliste an die Signatur (Adobe-Paritaet bei 'CA trusted').
            cert_ders[cid.hex()] = base64.b64encode(val).decode()
    finally:
        try:
            sess.close()
        except Exception:  # noqa: BLE001
            pass
    return {"certificates": out, "certDers": cert_ders}


def verify_pin(module_path: str, slot_id: int, pin: str, sig_pin: Optional[str] = None) -> dict:
    """Prueft PIN(s) durch Session-Login, OHNE zu signieren (Nutzerablauf R58/59:
    gruener Haken VOR der Signatur). python-pkcs11 meldet Login beim token.open().
    Die PIN wird niemals geloggt oder zurueckgegeben."""
    import pkcs11

    logins = [pin] + ([sig_pin] if sig_pin and sig_pin != pin else [])
    try:
        lib = pkcs11.lib(module_path)
        slot = next((x for x in lib.get_slots() if int(x.slot_id) == int(slot_id) and x.flags and 0x01), None)
        if slot is None:
            raise Pkcs11Error("Karte/Slot nicht gefunden")
        token = slot.get_token()
        for candidate in logins:
            session = None
            try:
                # user_pin im open() == Login; falsche PIN wirft PINIncorrect/PKCS11Error.
                session = token.open(rw=False, user_pin=candidate)
            except Exception as login_exc:
                # python-pkcs11-Klassen heissen z.B. PINIncorrect / PKCS11Error — der
                # String kann leer sein, daher immer auch den Klassennamen pruefen.
                # R66a: NIE roh re-raisen (rohe pkcs11-Fehler -> HTTP 500);
                # immer in Pkcs11Error (422 + Klartext) uebersetzen.
                blob = (str(login_exc) + " " + type(login_exc).__name__).lower()
                if "already" not in blob:
                    raise _classify_pkcs11_exc(login_exc) from login_exc
            finally:
                if session is not None:
                    try:
                        session.close()
                    except Exception:
                        pass
        return {"verified": True, "logins": len(logins)}
    except Pkcs11Error:
        raise
    except Exception as exc:
        # R66a: Der Nutzer sah bei falscher PIN 'HTTP 500' — jede Karte-Antwort
        # wird jetzt in eine klare 422-Meldung uebersetzt (NameError 'text'/'cls'
        # aus frueherer Fassung behoben).
        raise _classify_pkcs11_exc(exc) from exc


def sign_pdf_pkcs11(work_path: str, *, module_path: str, slot_id: int, cert_id: str,
                    pin: str, sig_pin: Optional[str], page: int, rect: Optional[dict],
                    invisible: bool, reason: Optional[str], name: Optional[str],
                    location: Optional[str], appearance: Optional[dict] = None,
                    image_b64: Optional[str] = None,
                    ca_certs_b64: Optional[list] = None) -> dict:
    """Inkrementelle Signatur mit Karten-Schluessel. rect = PDF unten-links (oder None)."""
    from pyhanko.sign.pkcs11 import PKCS11SignatureConfig, PKCS11SigningContext, PKCS11SigningPinEntryMode

    from backend import crypto_ops

    if not pin:
        raise Pkcs11Error("PIN fehlt")
    try:
        cid = bytes.fromhex(cert_id)
    except ValueError as exc:
        raise Pkcs11Error("Zertifikats-ID ist kein Hex") from exc

    cfg = PKCS11SignatureConfig(
        module_path=module_path,
        slot_no=int(slot_id),
        cert_id=cid,
        key_id=cid,  # PKCS#15-Karten: Schluessel teilt die Zert-ID (gemessen an der echten Karte)
        user_pin=pin,
        signing_pin=sig_pin or None,
        signing_pin_mode=PKCS11SigningPinEntryMode.SKIP if not sig_pin else PKCS11SigningPinEntryMode.SKIP,
        prompt_pin=None if pin else __import__("pyhanko.config.pkcs11", fromlist=["PKCS11PinEntryMode"]).PKCS11PinEntryMode.PROMPT,
    )
    try:
        with PKCS11SigningContext(cfg, user_pin=pin) as signer:
            trust: Optional[list] = None
            if ca_certs_b64:
                import base64 as _b64

                trust = []
                for cb in ca_certs_b64[:6]:
                    try:
                        trust.append(_b64.b64decode(cb, validate=True))
                    except Exception:
                        continue
                trust = trust or None
            return crypto_ops.sign_with_signer(
                work_path, signer, page=page, rect=rect, reason=reason,
                name=name, location=location, invisible=invisible, appearance=appearance,
                image_b64=image_b64, trust_certs=trust)
    except Pkcs11Error:
        raise
    except Exception as exc:  # noqa: BLE001
        # PIN-Fehler klassifizieren, ohne die PIN selbst zu wiederholen.
        raise _classify_pkcs11_exc(exc) from exc
