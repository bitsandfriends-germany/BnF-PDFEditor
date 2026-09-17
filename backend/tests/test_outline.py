"""Tests Section 5: Outline-/Lesezeichen-Panel (Read-only, Klick navigiert)."""
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

from backend import main, outline_ops

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
    for _ in range(3):
        d.new_page()
    # Gliederung mit verschachtelten Ebenen (Seite 1-basiert).
    d.set_toc([
        [1, "Kapitel 1", 1],
        [2, "Abschnitt 1.1", 2],
        [1, "Kapitel 2", 3],
    ])
    d.save(str(fn))
    d.close()
    return str(fn)


def open_doc(client, sample):
    r = client.post("/document/open", json={"path": sample}, headers=HDRS)
    assert r.status_code == 200, r.text


def test_get_outline_unit(sample):
    res = outline_ops.get_outline(sample)
    assert res["count"] == 3
    assert res["outline"][0] == {"level": 1, "title": "Kapitel 1", "page": 1}
    assert res["outline"][1]["level"] == 2  # Verschachtelung bleibt erhalten
    assert res["outline"][2]["page"] == 3   # Seite 1-basiert


def test_empty_outline_empty_list(tmp_path):
    fn = tmp_path / "plain.pdf"
    d = fitz.open()
    d.new_page()
    d.save(str(fn))
    d.close()
    assert outline_ops.get_outline(str(fn)) == {"outline": [], "count": 0}


def test_route_returns_outline(client, sample):
    open_doc(client, sample)
    r = client.get("/document/outline", headers=HDRS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 3
    assert {o["title"] for o in body["outline"]} == {"Kapitel 1", "Abschnitt 1.1", "Kapitel 2"}
