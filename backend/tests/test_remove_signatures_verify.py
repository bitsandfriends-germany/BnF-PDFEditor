"""PART 3 §3 — VERIFIKATION 'Digitale Signaturen entfernen' DURCH DEN ECHTEN PFAD.

Echter HTTP-Pfad (POST /document/remove-signatures), Pruefung mit ZWEITER Bibliothek
(pikepdf sieht /Sig-Felder, PyMuPDF sieht Signatur-Annots), plus NICHT-Aenderung:
Seiten und Text bleiben identisch, Undo stellt die Signatur exakt wieder her.
"""
from __future__ import annotations

import datetime as dt
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

os.environ["PDF_EDITOR_BACKEND_TOKEN"] = "test-token-xyz"

import pytest
import pymupdf as fitz
import pikepdf
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient

from backend import main

HDRS = {"X-Auth-Token": "test-token-xyz"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    for sub in ("run", "snap"):
        (tmp_path / sub).mkdir()
    monkeypatch.setenv("PDF_EDITOR_SESSION_DIR", str(tmp_path / "run"))
    monkeypatch.setenv("PDF_EDITOR_SNAPSHOT_DIR", str(tmp_path / "snap"))
    monkeypatch.delenv("PDF_EDITOR_UNDO_TO_DISK", raising=False)
    with TestClient(main.app) as c:
        yield c


def _p12(tmp_path) -> tuple[str, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Entfern-Test")])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(7)
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=30))
        .sign(key, hashes.SHA256())
    )
    p = tmp_path / "s.p12"
    p.write_bytes(pkcs12.serialize_key_and_certificates(b"", key, cert, None, serialization.BestAvailableEncryption(b"pw")))
    return str(p), "pw"


def _signed_doc(client, tmp_path):
    src = tmp_path / "in.pdf"
    d = fitz.open()
    pg = d.new_page()
    pg.insert_text((72, 120), "DOKUMENT-TEXT")
    d.save(str(src))
    d.close()
    r = client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    assert r.status_code == 200, r.text
    p12, pw = _p12(tmp_path)
    r = client.post("/document/sign", headers=HDRS, json={
        "p12Path": p12, "password": pw, "page": 0,
        "x": 80, "y": 60, "width": 240, "height": 70, "name": "T",
    })
    assert r.status_code == 200, r.text
    return os.path.join(os.environ["PDF_EDITOR_SESSION_DIR"], "work.pdf")


def _sig_widgets(path):
    """PyMuPDF als Zweitleser: Sig-Widgets direkt ueber die API."""
    d = fitz.open(path)
    try:
        return [w for p in d for w in (p.widgets() or [])]
    finally:
        d.close()


def _sig_fields_pikepdf(path):
    pdf = pikepdf.open(path)
    try:
        acro = pdf.Root.get("/AcroForm")
        fields = list(acro.get("/Fields") or []) if acro is not None else []
        return fields
    finally:
        pdf.close()


def test_remove_signatures_http_second_library(client, tmp_path):
    work = _signed_doc(client, tmp_path)

    # VORHER: Signaturen in beiden Bibliotheken sichtbar.
    assert client.get("/document/signatures", headers=HDRS).json()["signatures"], "erwartete 1 Signatur"
    assert len(_sig_fields_pikepdf(work)) == 1
    assert any((w.field_type_string or "").lower().startswith("sig") for w in _sig_widgets(work)), "PyMuPDF sieht kein Sig-Widget"

    r = client.post("/document/remove-signatures", headers=HDRS)
    assert r.status_code == 200, r.text
    assert r.json()["removed"] >= 1

    # NACHHER: keine Signatur mehr — echter Pfad (State) + zweite Bibliothek (pikepdf).
    assert client.get("/document/signatures", headers=HDRS).json()["signatures"] == []
    assert _sig_fields_pikepdf(work) == []
    d = fitz.open(work)
    try:
        widgets = _sig_widgets(work)
        assert widgets == [], f"Sig-Widgets uebrig: {[w.field_name for w in widgets]}"
        # NICHT-Aenderung: Seitenzahl und Text bleiben erhalten.
        assert d.page_count == 1
        assert "DOKUMENT-TEXT" in d.load_page(0).get_text()
        # PyMuPDF: keine Signatur mehr ueber die Formular-API.
        assert not any((w.field_type_string or '').lower().startswith('sig') for pgx in d for w in (pgx.widgets() or []))
    finally:
        d.close()


def test_remove_signatures_undo_restores_signature(client, tmp_path):
    _signed_doc(client, tmp_path)
    assert client.post("/document/remove-signatures", headers=HDRS).status_code == 200
    assert client.get("/document/signatures", headers=HDRS).json()["signatures"] == []
    r = client.post("/document/undo", headers=HDRS)
    assert r.status_code == 200, r.text
    sigs = client.get("/document/signatures", headers=HDRS).json()["signatures"]
    assert len(sigs) == 1, "Undo muss die Signatur exakt wiederherstellen"
