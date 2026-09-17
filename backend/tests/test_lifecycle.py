"""Tests Section 4: Save / Save As / Save a Copy / Close (Bindungs-Semantik)."""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

os.environ.setdefault("PDF_EDITOR_BACKEND_TOKEN", "test-token-xyz")

import pytest
import pymupdf as fitz
from fastapi.testclient import TestClient

from backend import main

HDRS = {"X-Auth-Token": "test-token-xyz"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    for sub in ("run", "snap"):
        (tmp_path / sub).mkdir()
    monkeypatch.setenv("PDF_EDITOR_SESSION_DIR", str(tmp_path / "run"))
    monkeypatch.setenv("PDF_EDITOR_SNAPSHOT_DIR", str(tmp_path / "snap"))
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def sample(tmp_path):
    fn = tmp_path / "orig.pdf"
    d = fitz.open(); d.new_page().insert_text((72, 100), "hi"); d.save(str(fn)); d.close()
    return str(fn)


def state(client):
    return client.get("/document/state", headers=HDRS).json()


def test_save_a_copy_does_not_rebind(client, sample, tmp_path):
    assert client.post("/document/open", json={"path": sample}, headers=HDRS).status_code == 200
    assert client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS).status_code == 200
    assert state(client)["dirty"] is True
    copy = str(tmp_path / "copy.pdf")
    r = client.post("/document/save", json={"path": copy, "rebind": False}, headers=HDRS)
    assert r.status_code == 200 and os.path.isfile(copy)
    st = state(client)
    # Session bleibt ans Original gebunden, Aenderungen gelten weiter als ungespeichert.
    assert st["originalPath"] == sample
    assert st["dirty"] is True


def test_save_as_rebinds(client, sample, tmp_path):
    client.post("/document/open", json={"path": sample}, headers=HDRS)
    client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS)
    target = str(tmp_path / "as.pdf")
    assert client.post("/document/save", json={"path": target, "rebind": True}, headers=HDRS).status_code == 200
    st = state(client)
    assert st["originalPath"] == target and st["dirty"] is False


def test_normal_save_keeps_binding_and_clears_dirty(client, sample):
    client.post("/document/open", json={"path": sample}, headers=HDRS)
    client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS)
    assert client.post("/document/save", json={}, headers=HDRS).status_code == 200
    st = state(client)
    assert st["originalPath"] == sample and st["dirty"] is False


def test_close_resets_session(client, sample):
    client.post("/document/open", json={"path": sample}, headers=HDRS)
    assert state(client)["open"] is True
    assert client.post("/document/close", json={}, headers=HDRS).status_code == 200
    st = state(client)
    assert st["open"] is False and st["originalPath"] is None
