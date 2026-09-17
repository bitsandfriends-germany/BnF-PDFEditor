"""Tests Section 4: Dokument-Eigenschaften-Panel (Read-only-Fakten)."""
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
    fn = tmp_path / "doc.pdf"
    d = fitz.open()
    for _ in range(2):
        p = d.new_page()
        p.insert_text((72, 100), "Hallo Welt")
    d.set_metadata({"producer": "unit", "creator": "creator-x", "title": "T", "creationDate": "D:20200101120000Z", "modDate": "D:20200202120000Z"})
    d.save(str(fn))
    d.close()
    return str(fn)


def props(client):
    return client.post("/document/properties", json={"page": 2}, headers=HDRS)


def test_open_then_properties(client, sample):
    assert client.post("/document/open", json={"path": sample}, headers=HDRS).status_code == 200
    r = props(client)
    assert r.status_code == 200
    d = r.json()
    assert d["pageCount"] == 2
    assert d["currentPage"] == 2
    assert d["pdfVersion"] == "1.7"
    assert d["producer"] == "unit"
    assert d["creator"] == "creator-x"
    assert d["creationDate"] == "20200101120000Z"
    assert d["pageWidth"] == 595.0 and d["pageHeight"] == 842.0
    assert d["encrypted"] is False and d["pendingEncryption"] is False
    assert d["hasForms"] is False and d["hasJavaScript"] is False and d["attachmentCount"] == 0
    assert d["tagged"] is False
    assert d["linearized"] is None or isinstance(d["linearized"], bool)
    assert d["fileSizeBytes"] and d["fileSizeBytes"] > 0


def test_fonts_listed_with_embedded_flag(client, sample):
    client.post("/document/open", json={"path": sample}, headers=HDRS)
    fonts = props(client).json()["fonts"]
    assert isinstance(fonts, list) and len(fonts) >= 1
    assert all({"name", "type", "embedded"} <= set(f) for f in fonts)
    assert any(f["name"] == "Helvetica" for f in fonts)


def test_no_document_409(client):
    # ohne geoeffnetes Dokument -> 409 (NoDocument)
    assert client.post("/document/properties", json={"page": 1}, headers=HDRS).status_code == 409
