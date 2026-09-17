"""Pytest fuer Step-4-Krypto: Signieren, Verifizieren, Stamping, irreversible Historie.

Ausfuehrung (Repo-Root, Backend-venv):
    pytest backend/tests/test_crypto.py -q
"""
from __future__ import annotations

import base64
import datetime
import os
import struct
import sys
import zlib

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

os.environ["PDF_EDITOR_BACKEND_TOKEN"] = "test-token-xyz"

import pytest  # noqa: E402
import pymupdf as fitz  # noqa: E402
from cryptography import x509  # noqa: E402
from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from cryptography.x509.oid import NameOID  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend import main  # noqa: E402

HDRS = {"X-Auth-Token": "test-token-xyz"}


@pytest.fixture
def client(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    snap = tmp_path / "snap"
    snap.mkdir()
    os.environ["PDF_EDITOR_SESSION_DIR"] = str(run)
    os.environ["PDF_EDITOR_SNAPSHOT_DIR"] = str(snap)
    with TestClient(main.app) as c:
        yield c


def make_pdf(path, pages=2):
    d = fitz.open()
    for _ in range(pages):
        d.new_page()
    d.save(str(path))
    d.close()


def make_p12(path, password="pw123"):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Test Signer")])
    now = datetime.datetime.utcnow()
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .sign(key, hashes.SHA256())
    )
    data = serialization.pkcs12.serialize_key_and_certificates(
        b"n", key, cert, None, serialization.BestAvailableEncryption(password.encode())
    )
    with open(str(path), "wb") as fh:
        fh.write(data)


def tiny_png_b64():
    w, h = 8, 8
    raw = b"".join(b"\x00" + bytes((0, 120, 255)) * w for _ in range(h))

    def chunk(t, x):
        c = t + x
        return struct.pack(">I", len(x)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    return base64.b64encode(png).decode()


def test_sign_then_verify_intact_and_valid(client, tmp_path):
    pdf = tmp_path / "d.pdf"
    p12 = tmp_path / "s.p12"
    make_pdf(pdf)
    make_p12(p12)
    assert client.post("/document/open", json={"path": str(pdf)}, headers=HDRS).status_code == 200

    r = client.post(
        "/document/sign",
        json={"p12Path": str(p12), "password": "pw123", "page": 0, "x": 72, "y": 700, "width": 150, "height": 60},
        headers=HDRS,
    )
    assert r.status_code == 200, r.text
    assert r.json()["signed"] is True

    sigs = client.get("/document/signatures", headers=HDRS).json()["signatures"]
    assert len(sigs) == 1
    s = sigs[0]
    assert s["field"] == "Signature1"
    assert s["intact"] is True
    assert s["valid"] is True
    assert s["mdAlgorithm"] == "sha256"


def test_sign_graphic_appearance(client, tmp_path):
    """Section 9: Bibliotheksgrafik als Signatur-Erscheinungsbild + krypto gueltig."""
    import pikepdf
    pdf = tmp_path / "d.pdf"
    p12 = tmp_path / "s.p12"
    make_pdf(pdf)
    make_p12(p12)
    assert client.post("/document/open", json={"path": str(pdf)}, headers=HDRS).status_code == 200
    r = client.post(
        "/document/sign",
        json={"p12Path": str(p12), "password": "pw123", "page": 0, "x": 72, "y": 700, "width": 160, "height": 60,
              "reason": "MitGrafik", "name": "Max Muster", "image": tiny_png_b64()},
        headers=HDRS,
    )
    assert r.status_code == 200, r.text
    sigs = client.get("/document/signatures", headers=HDRS).json()["signatures"]
    assert sigs[0]["valid"] is True and sigs[0]["intact"] is True
    assert sigs[0]["reason"] == "MitGrafik" and sigs[0]["name"] == "Max Muster"
    out = tmp_path / "out.pdf"
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200
    doc = pikepdf.open(str(out))
    sig_w = None
    for page in doc.pages:
        for a in (page.get("/Annots") or []):
            ft = a.get("/FT") or (a["/Parent"].get("/FT") if a.get("/Parent") else None)
            if ft == pikepdf.Name("/Sig"):
                sig_w = a
    # Grafik-Erscheinungsbild (/AP) UND Signaturwert (/V) am selben Widget
    assert sig_w is not None and "/AP" in sig_w and "/V" in sig_w



def test_sign_invisible_is_hidden_and_valid(client, tmp_path):
    """Section 9: unsichtbare Signatur = kryptografisch gueltig, Widget versteckt, kein Appearance."""
    import pikepdf
    pdf = tmp_path / "d.pdf"
    p12 = tmp_path / "s.p12"
    make_pdf(pdf)
    make_p12(p12)
    assert client.post("/document/open", json={"path": str(pdf)}, headers=HDRS).status_code == 200
    r = client.post(
        "/document/sign",
        json={"p12Path": str(p12), "password": "pw123", "page": 0, "x": 72, "y": 700, "width": 160, "height": 60,
              "reason": "NurCrypto", "invisible": True},
        headers=HDRS,
    )
    assert r.status_code == 200, r.text
    assert r.json()["visible"] is False
    s = client.get("/document/signatures", headers=HDRS).json()["signatures"][0]
    assert s["valid"] is True and s["intact"] is True and s["reason"] == "NurCrypto"
    # Arbeitskopie als Kopie sichern und dort das Widget pruefen: Hidden-Bit gesetzt, kein /AP.
    out = tmp_path / "out.pdf"
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200
    doc = pikepdf.open(str(out))
    sig_w = None
    for page in doc.pages:
        for a in (page.get("/Annots") or []):
            ft = a.get("/FT") or (a["/Parent"].get("/FT") if a.get("/Parent") else None)
            if ft == pikepdf.Name("/Sig"):
                sig_w = a
    assert sig_w is not None and (int(sig_w.get("/F", 0)) & 2) and "/AP" not in sig_w



def test_sign_visible_appearance_text_fields(client, tmp_path):
    """Section 9: sichtbare Signatur traegt Name/Grund/Ort + Zeitstempel im Signatur-Dictionary."""
    pdf = tmp_path / "d.pdf"
    p12 = tmp_path / "s.p12"
    make_pdf(pdf)
    make_p12(p12)
    assert client.post("/document/open", json={"path": str(pdf)}, headers=HDRS).status_code == 200
    r = client.post(
        "/document/sign",
        json={"p12Path": str(p12), "password": "pw123", "page": 0, "x": 72, "y": 700, "width": 160, "height": 60,
              "reason": "Abgenommen", "name": "Max Muster", "location": "Berlin"},
        headers=HDRS,
    )
    assert r.status_code == 200, r.text
    s = client.get("/document/signatures", headers=HDRS).json()["signatures"][0]
    assert s["reason"] == "Abgenommen" and s["name"] == "Max Muster" and s["location"] == "Berlin"
    assert s["signTime"]  # Zeitstempel vorhanden
    assert s["valid"] is True  # Wortlaut aendert die kryptografische Gueltigkeit nicht
    # Sichtbar: Widget traegt ein Erscheinungsbild (/AP).
    out = tmp_path / "vis.pdf"
    client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS)
    import pikepdf
    doc = pikepdf.open(str(out))
    vis_w = None
    for page in doc.pages:
        for a in (page.get("/Annots") or []):
            ft = a.get("/FT") or (a["/Parent"].get("/FT") if a.get("/Parent") else None)
            if ft == pikepdf.Name("/Sig"):
                vis_w = a
    assert vis_w is not None and "/AP" in vis_w



    pdf = tmp_path / "d.pdf"
    p12 = tmp_path / "s.p12"
    make_pdf(pdf)
    make_p12(p12)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS)
    assert client.get("/document/state", headers=HDRS).json()["undoDepth"] == 1

    client.post(
        "/document/sign",
        json={"p12Path": str(p12), "password": "pw123", "page": 0, "x": 72, "y": 700, "width": 150, "height": 60},
        headers=HDRS,
    )
    st = client.get("/document/state", headers=HDRS).json()
    assert st["canUndo"] is False
    assert st["undoDepth"] == 0


def test_sign_wrong_password_is_signature_error(client, tmp_path):
    pdf = tmp_path / "d.pdf"
    p12 = tmp_path / "s.p12"
    make_pdf(pdf)
    make_p12(p12, password="rightpw")
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    r = client.post(
        "/document/sign",
        json={"p12Path": str(p12), "password": "wrongpw", "page": 0, "x": 72, "y": 700, "width": 150, "height": 60},
        headers=HDRS,
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"] == "signature_error"


def test_sign_missing_certificate(client, tmp_path):
    pdf = tmp_path / "d.pdf"
    make_pdf(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    r = client.post(
        "/document/sign",
        json={"p12Path": str(tmp_path / "nope.p12"), "password": "x", "page": 0, "x": 72, "y": 700, "width": 150, "height": 60},
        headers=HDRS,
    )
    assert r.status_code == 422
    assert r.json()["error"] == "missing_certificate"


def test_sign_bad_page(client, tmp_path):
    pdf = tmp_path / "d.pdf"
    p12 = tmp_path / "s.p12"
    make_pdf(pdf)
    make_p12(p12)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    r = client.post(
        "/document/sign",
        json={"p12Path": str(p12), "password": "pw123", "page": 99, "x": 72, "y": 700, "width": 150, "height": 60},
        headers=HDRS,
    )
    assert r.status_code == 422
    assert r.json()["error"] == "bad_page"


def test_stamp_image_is_undoable(client, tmp_path):
    pdf = tmp_path / "d.pdf"
    make_pdf(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    r = client.post(
        "/document/stamp",
        json={"page": 0, "x": 72, "y": 600, "width": 68, "height": 40, "image": tiny_png_b64()},
        headers=HDRS,
    )
    assert r.status_code == 200, r.text
    assert r.json()["addedImages"] >= 1
    assert client.get("/document/state", headers=HDRS).json()["undoDepth"] == 1
    assert client.post("/document/undo", headers=HDRS).status_code == 200
    assert client.get("/document/state", headers=HDRS).json()["undoDepth"] == 0


def test_stamp_rejects_bad_base64_and_bad_page(client, tmp_path):
    pdf = tmp_path / "d.pdf"
    make_pdf(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    bad = client.post(
        "/document/stamp",
        json={"page": 0, "x": 72, "y": 600, "width": 68, "height": 40, "image": "!!!not base64!!!"},
        headers=HDRS,
    )
    assert bad.json()["error"] == "bad_image"
    badpage = client.post(
        "/document/stamp",
        json={"page": 42, "x": 72, "y": 600, "width": 68, "height": 40, "image": tiny_png_b64()},
        headers=HDRS,
    )
    assert badpage.json()["error"] == "bad_page"


def test_signatures_empty_when_unsigned(client, tmp_path):
    pdf = tmp_path / "d.pdf"
    make_pdf(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    assert client.get("/document/signatures", headers=HDRS).json()["signatures"] == []
