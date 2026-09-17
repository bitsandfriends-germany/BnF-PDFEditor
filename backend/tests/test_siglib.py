"""Tests Section 9 (conflict-frei): Signatur-Bibliothek, PKCS#12-Zert-Uebersicht, Verdict.

Run:
    cd "/home/iambarth/Documents/Projects/B&F PDF Editor" \
      && backend/.venv/bin/python -m pytest backend/tests/test_siglib.py -q
"""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

os.environ["PDF_EDITOR_BACKEND_TOKEN"] = "test-token-xyz"

import base64
import datetime as dt

import pytest
import pymupdf as fitz
from fastapi.testclient import TestClient

from backend import crypto_ops, main, sig_lib

HDRS = {"X-Auth-Token": "test-token-xyz"}


@pytest.fixture
def sigd(tmp_path, monkeypatch):
    d = tmp_path / "sig"; d.mkdir()
    monkeypatch.setenv("PDF_EDITOR_SIG_DIR", str(d))
    return d


@pytest.fixture
def client(tmp_path, monkeypatch):
    for sub in ("run", "snap"):
        (tmp_path / sub).mkdir()
    monkeypatch.setenv("PDF_EDITOR_SESSION_DIR", str(tmp_path / "run"))
    monkeypatch.setenv("PDF_EDITOR_SNAPSHOT_DIR", str(tmp_path / "snap"))
    d = tmp_path / "sig"; d.mkdir()
    monkeypatch.setenv("PDF_EDITOR_SIG_DIR", str(d))
    with TestClient(main.app) as c:
        yield c


def png_bytes(w=80, h=40):
    pm = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, w, h)); pm.set_rect(pm.irect, (0, 0, 200))
    return pm.tobytes("png")


# ---------------------------------------------------------------- text_to_png
def test_text_to_png_is_transparent():
    png = sig_lib.text_to_png("Max Muster")
    pm = fitz.Pixmap(png)
    assert pm.alpha > 0                                   # Alphakanal vorhanden
    assert pm.pixel(0, 0)[3] == 0                         # Ecke transparent
    opaque = sum(1 for y in range(pm.height) for x in range(pm.width) if pm.pixel(x, y)[3] == 255)
    assert opaque > 50                                    # Text vorhanden


# ---------------------------------------------------------------- Bibliothek
def test_import_list_read_delete(sigd):
    r = sig_lib.import_signature_bytes("Meine Signatur", png_bytes(), ".png", 200, 0.8)
    sid = r["id"]
    assert os.path.isfile(sigd / f"{sid}.png") and os.path.isfile(sigd / f"{sid}.json")
    lst = sig_lib.list_signatures()["signatures"]
    assert len(lst) == 1 and lst[0]["name"] == "Meine Signatur"
    assert lst[0]["defaultOpacity"] == 0.8
    data, mime = sig_lib.read_signature_image(sid)
    assert data and mime == "image/png"
    sig_lib.delete_signature(sid)
    assert sig_lib.list_signatures()["signatures"] == []


def test_import_file_copies_not_references(sigd, tmp_path):
    src = tmp_path / "out.png"; src.write_bytes(png_bytes())
    r = sig_lib.import_signature_file("Hochgeladen", str(src))
    assert os.path.isfile(sigd / f"{r['id']}.png")   # in die Bibliothek KOPIERT
    src.unlink()                                     # Original weg -> Signatur bleibt gueltig
    data, _ = sig_lib.read_signature_image(r["id"])
    assert data


def test_directory_is_the_index(sigd):
    # Nutzer legt Dateien von Hand an -> die Anwendung pickt sie hoch (kein Index noetig)
    (sigd / "hand.png").write_bytes(png_bytes())
    (sigd / "hand.json").write_text('{"name":"Von Hand","defaultSizePt":100,"defaultOpacity":1.0,"createdAt":"2024-01-01T00:00:00Z"}')
    lst = sig_lib.list_signatures()["signatures"]
    assert any(s["id"] == "hand" and s["name"] == "Von Hand" for s in lst)


# ---------------------------------------------------------------- Zert-Uebersicht
def _make_p12(path, pw, days_before=1, days_after=365):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Test Signer")])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(k.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(days=days_before))
            .not_valid_after(now + dt.timedelta(days=days_after))
            .add_extension(x509.KeyUsage(True, True, False, False, False, False, False, False, False), critical=True)
            .sign(k, hashes.SHA256()))
    blob = serialization.pkcs12.serialize_key_and_certificates(b"f", k, cert, None,
                                                               serialization.BestAvailableEncryption(pw.encode()))
    path.write_bytes(blob)


def test_describe_pkcs12_expired_selfsigned(tmp_path):
    p = tmp_path / "exp.p12"; _make_p12(p, "pw", days_before=60, days_after=-30)  # abgelaufen
    d = crypto_ops.describe_pkcs12(str(p), "pw")
    assert d["selfSigned"] is True and d["expired"] is True
    assert d["canSignWith"] is False  # nie still mit abgelaufenem Zert signieren
    assert any("abgelaufen" in w for w in d["warnings"])
    assert d["keyUsage"]["digitalSignature"] is True


def test_describe_pkcs12_valid(tmp_path):
    p = tmp_path / "ok.p12"; _make_p12(p, "pw", days_after=365)
    d = crypto_ops.describe_pkcs12(str(p), "pw")
    assert d["expired"] is False and d["notYetValid"] is False and d["canSignWith"] is True


def test_describe_wrong_password(tmp_path):
    p = tmp_path / "ok.p12"; _make_p12(p, "pw")
    with pytest.raises(crypto_ops.SignatureError):
        crypto_ops.describe_pkcs12(str(p), "falsch")


# ---------------------------------------------------------------- Routen
def test_route_signature_library(client):
    b64 = base64.b64encode(png_bytes()).decode()
    imp = client.post("/signatures/import", json={"name": "S1", "image": b64, "ext": ".png"}, headers=HDRS)
    assert imp.status_code == 200 and "id" in imp.json()
    sid = imp.json()["id"]
    assert client.get("/signatures", headers=HDRS).json()["signatures"][0]["name"] == "S1"
    img = client.get(f"/signatures/{sid}/image", headers=HDRS)
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    txt = client.post("/signatures/text", json={"name": "Getippt", "text": "Anna"}, headers=HDRS)
    assert txt.status_code == 200
    assert len(client.get("/signatures", headers=HDRS).json()["signatures"]) == 2
    assert client.delete(f"/signatures/{sid}", headers=HDRS).json()["deleted"] == sid


def test_route_cert_describe(client, tmp_path):
    p = tmp_path / "ok.p12"; _make_p12(p, "pw", days_after=365)
    r = client.post("/certificates/describe", json={"path": str(p), "password": "pw"}, headers=HDRS)
    assert r.status_code == 200 and r.json()["canSignWith"] is True
