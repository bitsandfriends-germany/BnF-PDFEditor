"""Tests Section 10c: Verschlüsseln (getrennte User-/Owner-PW + Berechtigungen), Entschluesseln als Kopie.

Run:
    cd "/home/iambarth/Documents/Projects/B&F PDF Editor" \
      && backend/.venv/bin/python -m pytest backend/tests/test_encrypt.py -q
"""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

os.environ["PDF_EDITOR_BACKEND_TOKEN"] = "test-token-xyz"

import pytest
import pymupdf as fitz
from fastapi.testclient import TestClient

from backend import main, security_ops

HDRS = {"X-Auth-Token": "test-token-xyz"}


@pytest.fixture
def client(tmp_path):
    for sub in ("run", "snap"):
        (tmp_path / sub).mkdir()
    os.environ["PDF_EDITOR_SESSION_DIR"] = str(tmp_path / "run")
    os.environ["PDF_EDITOR_SNAPSHOT_DIR"] = str(tmp_path / "snap")
    os.environ["PDF_EDITOR_UNDO_TO_DISK"] = "1"
    with TestClient(main.app) as c:
        yield c


def base_pdf(path, secret="GEHJEM"):
    d = fitz.open(); p = d.new_page(width=300, height=300)
    p.insert_text((50, 60), secret, fontsize=20)
    d.save(str(path)); d.close()


# ---------------------------------------------------------------- perm_bits mapping
def test_perm_bits_printing_levels():
    assert security_ops.perm_bits({"printing": "none"}) & fitz.PDF_PERM_PRINT == 0
    low = security_ops.perm_bits({"printing": "low"})
    assert low & fitz.PDF_PERM_PRINT and not (low & fitz.PDF_PERM_PRINT_HQ)
    full = security_ops.perm_bits({"printing": "full"})
    assert full & fitz.PDF_PERM_PRINT and full & fitz.PDF_PERM_PRINT_HQ


def test_perm_bits_flags_and_default():
    bits = security_ops.perm_bits({"copy": True, "annotate": True, "printing": "none"})
    assert bits & fitz.PDF_PERM_COPY and bits & fitz.PDF_PERM_ANNOTATE
    assert not (bits & fitz.PDF_PERM_FORM)
    assert security_ops.perm_bits(None) == security_ops._ALL_PERMS


# ---------------------------------------------------------------- encrypt_work
def test_encrypt_then_open(tmp_path):
    p = tmp_path / "d.pdf"; base_pdf(p)
    res = security_ops.encrypt_work(str(p), "USER", "OWNER", {"printing": "none"})
    assert res["encrypted"] is True
    d = fitz.open(str(p)); assert d.needs_pass == 1
    assert d.authenticate("USER") != 0
    assert "GEHJEM" in d.load_page(0).get_text()
    # user-PW sieht kein Drucken (Berechtigung wirklich gesetzt)
    assert not (d.permissions & fitz.PDF_PERM_PRINT)
    d.close()


def test_owner_defaults_to_user(tmp_path):
    p = tmp_path / "d.pdf"; base_pdf(p)
    res = security_ops.encrypt_work(str(p), "GLEICH")
    assert res["ownerDefaultsToUser"] is True


# ---------------------------------------------------------------- remove_encryption_copy
def test_decrypt_needs_owner_not_user(tmp_path):
    p = tmp_path / "d.pdf"; base_pdf(p)
    security_ops.encrypt_work(str(p), "USER", "OWNER", {"printing": "print"})
    out = tmp_path / "out"; out.mkdir()
    # User-Passwort reicht ausdruecklich NICHT
    with pytest.raises(Exception):
        security_ops.remove_encryption_copy(str(p), "USER", str(out))
    assert list(out.iterdir()) == []  # nichts geschrieben
    # Owner-Passwort funktioniert -> neue, entsperre Datei
    r = security_ops.remove_encryption_copy(str(p), "OWNER", str(out))
    assert r["decrypted"] is True and os.path.isfile(r["path"])
    d = fitz.open(r["path"]); assert d.needs_pass == 0
    assert "GEHJEM" in d.load_page(0).get_text()
    d.close()


def test_decrypt_original_untouched_and_suffix(tmp_path):
    p = tmp_path / "d.pdf"; base_pdf(p)
    security_ops.encrypt_work(str(p), "USER", "OWNER")
    out = tmp_path / "out"; out.mkdir()
    before = p.read_bytes()
    security_ops.remove_encryption_copy(str(p), "OWNER", str(out), "x")
    r2 = security_ops.remove_encryption_copy(str(p), "OWNER", str(out), "x")
    assert p.read_bytes() == before                     # Original unveraendert
    assert r2["path"].endswith("x_1.pdf")               # §2.6 Suffix statt Ueberschreiben


def test_decrypt_unencrypted_raises(tmp_path):
    p = tmp_path / "d.pdf"; base_pdf(p)
    out = tmp_path / "out"; out.mkdir()
    with pytest.raises(security_ops.SecurityError):
        security_ops.remove_encryption_copy(str(p), "whatever", str(out))


# ---------------------------------------------------------------- Routen
def test_route_encrypt_permissions_then_state(client, tmp_path):
    src = tmp_path / "in.pdf"; base_pdf(src)
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/document/encrypt", json={
        "password": "USER", "ownerPw": "OWNER",
        "permissions": {"printing": "none", "copy": False, "modify": True},
    }, headers=HDRS)
    assert r.status_code == 200, r.text
    assert r.json()["encrypted"] is True
    st = client.get("/document/state", headers=HDRS).json()
    assert st["encrypted"] is True and st["canUndo"] is False


def test_route_decrypt_copy(client, tmp_path):
    src = tmp_path / "in.pdf"; base_pdf(src)
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    enc = tmp_path / "enc.pdf"; base_pdf(enc)
    security_ops.encrypt_work(str(enc), "USER", "OWNER", {"printing": "none"})
    out = tmp_path / "out"; out.mkdir()
    r = client.post("/document/decrypt", json={
        "path": str(enc), "ownerPassword": "OWNER", "destDir": str(out)}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert os.path.isfile(r.json()["path"])
    # falsches Owner-PW -> Fehler
    bad = client.post("/document/decrypt", json={
        "path": str(enc), "ownerPassword": "USER", "destDir": str(out)}, headers=HDRS)
    assert bad.status_code >= 400


def test_route_encrypt_then_save_applies_permissions(client, tmp_path):
    """Architektur 4A: Encrypt setzt nur die Save-time-Property; Save wendet AES-256 + Rechte an."""
    src = tmp_path / "in.pdf"; base_pdf(src)
    out = tmp_path / "out.pdf"
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    # Arbeitskopie bleibt unverschluesselt -> nach Encrypt weiter editierbar
    client.post("/document/encrypt", json={
        "password": "USER", "ownerPw": "OWNER",
        "permissions": {"printing": "none", "copy": False, "modify": True, "form": False},
    }, headers=HDRS)
    assert client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS).status_code == 200
    s = client.post("/document/save", json={"path": str(out)}, headers=HDRS)
    assert s.status_code == 200 and s.json()["encrypted"] is True
    d = fitz.open(str(out)); assert d.needs_pass == 1
    assert d.authenticate("USER") != 0
    assert "GEHJEM" in d.load_page(0).get_text()
    # gesetzte Rechte gelten: kein Drucken/Kopieren fuer Oeffnungs-PW
    assert not (d.permissions & fitz.PDF_PERM_PRINT)
    assert not (d.permissions & fitz.PDF_PERM_COPY)
    assert d.load_page(0).rotation == 90  # vor dem Speichern rotiert -> gespeichert
    d.close()
