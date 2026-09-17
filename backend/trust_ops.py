"""Vertrauensanker-Store (R67): Nutzer koennen CA-Zertifikate importieren,
deren Wurzel unsere Pruefung sonst nicht kennt (z.B. ESTEID2018 — Adobe bringt
sie mit, wir holen sie vom Nutzer). Speicher: ~/.local/share/pdf-editor/trust/
(ueberbar via BF_TRUST_ANCHORS_DIR). Die Pruefung (crypto_ops) liest genau
dieses Verzeichnis als zusaetzliche Vertrauensanker."""
from __future__ import annotations

import hashlib
import os
import re
from typing import Optional

_SAFE = re.compile(r"^[A-Za-z0-9._-]{1,120}\.(pem|der|crt|cer)$")


class TrustError(__import__("backend.pdflib", fromlist=["PdfError"]).PdfError):
    code = "trust_error"
    status = 422


def trust_dir() -> str:
    d = os.environ.get("BF_TRUST_ANCHORS_DIR")
    if not d:
        d = os.path.join(os.path.expanduser("~"), ".local", "share", "pdf-editor", "trust")
    return d


def _parse(raw: bytes):
    """bytes -> cryptography-x509-Zertifikat (PEM oder DER)."""
    from cryptography import x509

    if b"BEGIN CERTIFICATE" in raw:
        return x509.load_pem_x509_certificate(raw)
    return x509.load_der_x509_certificate(raw)


def list_anchors() -> dict:
    import glob as _glob

    from cryptography.x509.oid import ExtensionOID

    out = []
    for f in sorted(_glob.glob(os.path.join(trust_dir(), "*"))):
        base = os.path.basename(f)
        if not _SAFE.match(base):
            continue
        try:
            cert = _parse(open(f, "rb").read())
            cn = cert.subject.get_attributes_for_oid(NameOID_CN())
            try:
                bc = cert.extensions.get_extension_for_oid(ExtensionOID.BASIC_CONSTRAINTS).value
                ca = bool(bc.ca)
            except Exception:
                ca = False
            out.append({
                "id": base,
                "subject": str(cn[0].value) if cn else cert.subject.rfc4514_string()[:80],
                "issuer": _cn_of(cert.issuer),
                "serial": str(cert.serial_number),
                "isCa": ca,
                "notAfter": cert.not_valid_after_utc.isoformat(timespec="seconds"),
            })
        except Exception:
            continue
    return {"anchors": out}


def NameOID_CN():
    from cryptography.x509.oid import NameOID

    return NameOID.COMMON_NAME


def _cn_of(name) -> str:
    cn = name.get_attributes_for_oid(NameOID_CN())
    return str(cn[0].value) if cn else name.rfc4514_string()[:80]


def import_anchor(b64: str, filename: Optional[str] = None) -> dict:
    """Ein PEM/DER-Zertifikat (base64) als Anker speichern. Nur CA-Zertifikate
    werden angenommen — ein Blatt-Zertifikat als 'vertrauenswuerdig' zu storen
    waere ein Missbrauch des Begriffs (und wuerde Adobe-Verhalten nicht
    abbilden)."""
    try:
        raw = __import__("base64").b64decode(b64, validate=True)
    except Exception:
        raise TrustError("Datei ist kein gueltiges base64") from None
    if len(raw) > 64 * 1024:
        raise TrustError("Zertifikat zu gross")
    try:
        cert = _parse(raw)
    except Exception:
        raise TrustError("Datei ist kein gueltiges X.509-Zertifikat (PEM/DER)") from None
    from cryptography.x509.oid import ExtensionOID

    try:
        bc = cert.extensions.get_extension_for_oid(ExtensionOID.BASIC_CONSTRAINTS).value
        if not bc.ca:
            raise TrustError("Nur CA-Zertifikate koennen Vertrauensanker sein — diese Datei ist kein CA-Zertifikat.")
    except TrustError:
        raise
    except Exception:
        raise TrustError("Zertifikat traegt keine CA-Kennung (BasicConstraints) — nicht importiert.") from None

    d = trust_dir()
    os.makedirs(d, exist_ok=True)
    fp = cert.fingerprint(__import__("cryptography.hazmat.primitives.hashes", fromlist=["SHA256"]).SHA256())
    digest = hashlib.sha256(fp).hexdigest()[:16]
    cn = cert.subject.get_attributes_for_oid(NameOID_CN())
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", (str(cn[0].value) if cn else "anchor"))[:48]
    is_pem = b"BEGIN CERTIFICATE" in raw
    base = f"{slug}-{digest}.{'pem' if is_pem else 'der'}"
    if not _SAFE.match(base):
        base = f"anchor-{digest}.{'pem' if is_pem else 'der'}"
    path = os.path.join(d, base)
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(raw)
    os.replace(tmp, path)
    return {"imported": True, "id": base, "subject": _cn_of(cert.subject), "isCa": True}


def delete_anchor(anchor_id: str) -> dict:
    base = os.path.basename(anchor_id or "")
    if not _SAFE.match(base):
        raise TrustError("Ungueltige Anker-ID")
    path = os.path.join(trust_dir(), base)
    if not os.path.exists(path):
        raise TrustError("Anker nicht gefunden")
    os.remove(path)
    return {"deleted": True, "id": base}
