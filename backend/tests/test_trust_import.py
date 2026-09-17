"""R67: Vertrauensanker-Import — der Nutzer kann fehlende Wurzeln (z.B.
ESTEID2018, Adobe bringt sie mit) selbst beisteuern:
  GET/POST/DELETE /trust/anchors  (echter HTTP-Pfad, PDF_EDITOR-* +
  BF_TRUST_ANCHORS_DIR isoliert ins Temp-Verzeichnis)
Bewiesen wird hier: Import eines CA-Zertifikats macht eine sonst untrusted
Signatur trusted (Zustandsaenderung), Geschwister-Signaturen/Gueltigkeit
bleiben unveraendert (Nicht-Aenderung), Nicht-CA-Dateien werden abgelehnt,
Entfernen stellt den Ausgangszustand wieder her, und die Plattendatei wird
durch den Import NICHT veraendert (Hashvergleich pikepdf-Zweitbibliothek).
"""
import base64
import datetime
import hashlib
import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("PDF_EDITOR_BACKEND_TOKEN", "test-token-xyz")
HDRS = {"X-Auth-Token": "test-token-xyz"}


import functools


@functools.lru_cache(maxsize=1)
def _fixture_ca_and_leaf():
    """Eine feste Kette fuer alle Tests: das importierte CA MUSS dasselbe sein,
    das die Signatur Blattzertifikat pflanzte (sonst kein Pfad -> kein trusted)."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import NameOID

    ca_k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_n = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "R67 Import CA")])
    now = datetime.datetime.now(datetime.UTC)
    ca_c = (x509.CertificateBuilder().subject_name(ca_n).issuer_name(ca_n)
            .public_key(ca_k.public_key()).serial_number(67001)
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(ca_k, hashes.SHA256()))
    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    n = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "R67 Karten-Inhaber")])
    leaf = (x509.CertificateBuilder().subject_name(n).issuer_name(ca_n)
            .public_key(k.public_key()).serial_number(67002)
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=365))
            .sign(ca_k, hashes.SHA256()))
    p12 = pkcs12.serialize_key_and_certificates(b"", k, leaf, None,
                                                serialization.BestAvailableEncryption(b"pw"))
    ca_pem = ca_c.public_bytes(serialization.Encoding.PEM)
    return p12, ca_pem, ca_c.public_bytes(serialization.Encoding.DER)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PDF_EDITOR_SESSION_DIR", str(tmp_path / "s"))
    monkeypatch.setenv("PDF_EDITOR_SNAPSHOT_DIR", str(tmp_path / "sn"))
    monkeypatch.setenv("BF_TRUST_ANCHORS_DIR", str(tmp_path / "trust"))
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    import importlib

    import backend.main as m
    importlib.reload(m)
    import pymupdf

    src = tmp_path / "doc.pdf"
    d = pymupdf.open()
    p = d.new_page()
    p.insert_text((72, 120), "R67 Anker-Import")
    d.save(str(src))
    d.close()
    with TestClient(m.app, raise_server_exceptions=False) as c:
        assert c.post("/document/open", json={"path": str(src)}, headers=HDRS).status_code == 200
        yield c, str(tmp_path)


def _sign_leaf(client):
    p12, _, _ = _fixture_ca_and_leaf()
    import tempfile

    p12f = tempfile.mktemp(suffix=".p12")
    with open(p12f, "wb") as fh:
        fh.write(p12)
    r = client.post("/document/sign", json={
        "p12Path": p12f, "password": "pw", "page": 0,
        "x": 60, "y": 60, "width": 220, "height": 70, "name": "R67 Karten-Inhaber",
    }, headers=HDRS)
    os.unlink(p12f)
    assert r.status_code == 200, r.text


def test_anchor_import_flips_trusted_and_delete_restores(client):
    """Behauptete Zustandsaenderung: ohne Anker trusted=False + Ketten-Note;
    nach Import der CA trusted=True (Intaktheit/Gueltigkeit unveraendert!);
    nach Entfernen wieder trusted=False."""
    c, tmp = client
    _sign_leaf(c)
    v = c.get("/document/signatures", headers=HDRS).json()["signatures"][0]
    assert v["intact"] is True and v["valid"] is True
    assert v["trusted"] is False, v
    assert v.get("trustNote") and "R67 Import CA" in " ".join(v.get("trustChain") or [])

    _, ca_pem, ca_der = _fixture_ca_and_leaf()
    r = c.post("/trust/anchors", json={"cert": base64.b64encode(ca_der).decode(),
                                       "filename": "r67.der"}, headers=HDRS)
    assert r.status_code == 200, r.text
    aid = r.json()["id"]
    # Anker liegt auf der Platte im getrennten Store-Verzeichnis
    assert os.path.exists(os.path.join(tmp, "trust", aid))
    lst = c.get("/trust/anchors", headers=HDRS).json()["anchors"]
    assert any(a["id"] == aid and a["isCa"] for a in lst)

    v2 = c.get("/document/signatures", headers=HDRS).json()["signatures"][0]
    assert v2["trusted"] is True, f"importierter Anker muss trusted=True machen: {v2}"
    assert v2["intact"] is True and v2["valid"] is True  # NICHT-Aenderung

    d = c.delete(f"/trust/anchors/{aid}", headers=HDRS)
    assert d.status_code == 200
    v3 = c.get("/document/signatures", headers=HDRS).json()["signatures"][0]
    assert v3["trusted"] is False  # Ausgangszustand wiederhergestellt


def test_import_rejects_non_ca_and_garbage(client):
    c, _ = client
    _, _, ca_der = _fixture_ca_and_leaf()
    # Blattzertifikat (kein BasicConstraints-CA) wird abgelehnt — 422, klare Meldung
    from cryptography import x509 as _x
    from cryptography.hazmat.primitives import serialization as _s
    p12, _, _ = _fixture_ca_and_leaf()
    from cryptography.hazmat.primitives.serialization import pkcs12 as _p12

    (_k, leaf, _cas) = _p12.load_key_and_certificates(p12, b"pw")
    leaf_b64 = base64.b64encode(leaf.public_bytes(_s.Encoding.DER)).decode()
    r = c.post("/trust/anchors", json={"cert": leaf_b64}, headers=HDRS)
    assert r.status_code == 422
    assert "CA" in r.json()["message"]
    # Muell
    r = c.post("/trust/anchors", json={"cert": base64.b64encode(b"hallo").decode()}, headers=HDRS)
    assert r.status_code == 422
    assert c.get("/trust/anchors", headers=HDRS).json()["anchors"] == []


def test_import_does_not_modify_document(client):
    """Nicht-Aenderung: der Anker-Import darf die Dokumentdatei auf der Platte
    nicht anfassen — Byte-Hash vorher/nachher (Zweitbibliothek pikepdf liest
    zusaetzlich, Dateityp bleibt gueltiges PDF mit 1 Signatur)."""
    import pymupdf

    c, tmp = client
    _sign_leaf(c)
    work = os.path.join(tmp, "s", "work.pdf")
    h1 = hashlib.sha256(open(work, "rb").read()).hexdigest()
    _, _, ca_der = _fixture_ca_and_leaf()
    assert c.post("/trust/anchors", json={"cert": base64.b64encode(ca_der).decode()},
                  headers=HDRS).status_code == 200
    h2 = hashlib.sha256(open(work, "rb").read()).hexdigest()
    assert h1 == h2, "Import darf die Dokumentdatei nicht veraendern"
    import pikepdf

    with pikepdf.open(work) as pdf:
        sigs = [a for pg in pdf.pages for a in (pg.get("/Annots") or [])
                if (a.get("/FT") or (a.get("/Parent") and a["/Parent"].get("/FT"))) == pikepdf.Name("/Sig")]
        assert len(sigs) == 1
