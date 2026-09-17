"""Pytest fuer Step 5: Document-Understanding (BasicProvider, Cache, Range, SSE, Abbruch,
Docling-Protokoll gegen Stub-Sidecar). Docling-spezifische Faelle laufen gegen einen Stub, damit
die Suite ohne installiertes docling und mit Stub gruen ist (Spec: beide Konfigurationen).

Ausfuehrung (Repo-Root, Backend-venv):
    pytest backend/tests/test_context.py -q
"""
from __future__ import annotations

import json
import os
import sys
import time

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

os.environ["PDF_EDITOR_BACKEND_TOKEN"] = "test-token-xyz"

import pytest  # noqa: E402
import pymupdf as fitz  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend import main  # noqa: E402
from backend.context.basic import BasicProvider  # noqa: E402
from backend.context.base import context_dir_for, make_context_dir, read_manifest  # noqa: E402

HDRS = {"X-Auth-Token": "test-token-xyz"}


@pytest.fixture
def client(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    snap = tmp_path / "snap"
    snap.mkdir()
    os.environ["PDF_EDITOR_SESSION_DIR"] = str(run)
    os.environ["PDF_EDITOR_SNAPSHOT_DIR"] = str(snap)
    # sicherheitshalber: Docling-Env nicht erben
    os.environ.pop("PDF_EDITOR_DOCLING_WORKER", None)
    os.environ.pop("PDF_EDITOR_DOCLING_PYTHON", None)
    with TestClient(main.app) as c:
        yield c


def _single(path):
    d = fitz.open()
    pg = d.new_page()
    pg.insert_text((72, 90), "Titel des Dokuments", fontsize=20, fontname="hebo")
    pg.insert_text((72, 120), "Erster Absatz mit Text.", fontsize=11)
    pg.insert_text((72, 140), "Zweiter Absatz.", fontsize=11)
    d.new_page()
    d[1].insert_text((72, 120), "Seite zwei Inhalt", fontsize=11)
    d.save(str(path))
    d.close()


def _multicol(path):
    d = fitz.open()
    pg = d.new_page()
    for y in (120, 140, 160):
        pg.insert_text((60, y), f"LinkeSpalte{y}", fontsize=11)
        pg.insert_text((320, y), f"RechteSpalte{y}", fontsize=11)
    d.save(str(path))
    d.close()


def _scanned(path):
    d = fitz.open()
    pg = d.new_page()
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 20, 20))
    pix.clear_with(255)
    pg.insert_image(fitz.Rect(50, 50, 250, 300), pixmap=pix)
    d.save(str(path))
    d.close()


def _wait_done(client, cid, timeout=15.0):
    deadline = time.monotonic() + timeout
    m = {}
    while time.monotonic() < deadline:
        m = client.get(f"/context/{cid}/manifest", headers=HDRS).json()
        if m.get("status") == "done":
            return m
        time.sleep(0.05)
    return m


def test_providers_reports_basic_available_docling_absent(client):
    j = client.get("/context/providers", headers=HDRS).json()
    assert j["docling"] is False
    basic = next(p for p in j["providers"] if p["name"] == "basic")
    assert basic["available"] is True


def test_analyze_basic_manifest_and_ranges(client, tmp_path):
    pdf = tmp_path / "s.pdf"
    _single(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    a = client.post("/context/analyze", json={}, headers=HDRS).json()
    assert a["pageCount"] == 2
    cid = a["contextId"]
    man = _wait_done(client, cid)
    assert man["status"] == "done"
    assert man["provider"] == "basic"
    assert man["pageCount"] == 2

    page0 = client.get(f"/context/{cid}/pages?from=0&to=1", headers=HDRS).json()["elements"]
    texts = " ".join(e["text"] for e in page0)
    assert "Titel" in texts
    assert "Seite zwei" not in texts  # Range endet vor Seite 1

    allp = client.get(f"/context/{cid}/pages?from=0", headers=HDRS).json()["elements"]
    assert any("Seite zwei" in e["text"] for e in allp)

    regions = client.get(f"/context/{cid}/regions?page=0", headers=HDRS).json()["regions"]
    assert regions and "bbox" in regions[0]


def test_heading_heuristic_flags_large_font(client, tmp_path):
    pdf = tmp_path / "s.pdf"
    _single(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    cid = client.post("/context/analyze", json={}, headers=HDRS).json()["contextId"]
    _wait_done(client, cid)
    els = client.get(f"/context/{cid}/pages?from=0&to=1", headers=HDRS).json()["elements"]
    title = next((e for e in els if "Titel" in e["text"]), None)
    assert title is not None and title["heading"] is True and title["level"] >= 1


def test_cache_reuse_by_sha_and_provider(client, tmp_path):
    pdf = tmp_path / "s.pdf"
    _single(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    a1 = client.post("/context/analyze", json={}, headers=HDRS).json()
    _wait_done(client, a1["contextId"])
    a2 = client.post("/context/analyze", json={}, headers=HDRS).json()
    assert a2["fromCache"] is True and a2["contextId"] == a1["contextId"]


def test_cache_invalidates_when_document_changes(client, tmp_path):
    pdf = tmp_path / "s.pdf"
    _single(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    cid1 = client.post("/context/analyze", json={}, headers=HDRS).json()["contextId"]
    _wait_done(client, cid1)
    # Mutation aendert die Arbeitskopie -> anderer SHA -> anderer Kontexteintrag.
    client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS)
    cid2 = client.post("/context/analyze", json={}, headers=HDRS).json()["contextId"]
    assert cid2 != cid1


def test_multicolumn_reading_order(client, tmp_path):
    pdf = tmp_path / "m.pdf"
    _multicol(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    cid = client.post("/context/analyze", json={}, headers=HDRS).json()["contextId"]
    _wait_done(client, cid)
    els = client.get(f"/context/{cid}/pages?from=0", headers=HDRS).json()["elements"]
    assert els and "Linke" in els[0]["text"]


def test_scanned_page_yields_image_region(client, tmp_path):
    pdf = tmp_path / "sc.pdf"
    _scanned(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    cid = client.post("/context/analyze", json={}, headers=HDRS).json()["contextId"]
    _wait_done(client, cid)
    els = client.get(f"/context/{cid}/pages?from=0", headers=HDRS).json()["elements"]
    assert any(e["type"] == "image" for e in els)


def test_sse_stream_reports_progress(client, tmp_path):
    pdf = tmp_path / "s.pdf"
    _single(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    cid = client.post("/context/analyze", json={"provider": "basic"}, headers=HDRS).json()["contextId"]
    _wait_done(client, cid)
    with client.stream("GET", f"/context/{cid}/stream", headers=HDRS) as rr:
        assert "text/event-stream" in rr.headers.get("content-type", "")
        body = b"".join(rr.iter_bytes())
    assert b"data:" in body and b"event: end" in body


def test_cancel_reaches_terminal_state(client, tmp_path):
    pdf = tmp_path / "big.pdf"
    d = fitz.open()
    for i in range(80):
        pg = d.new_page()
        pg.insert_text((72, 120), f"page {i} " * 80, fontsize=11)
    d.save(str(pdf))
    d.close()
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    cid = client.post("/context/analyze", json={}, headers=HDRS).json()["contextId"]
    client.post(f"/context/{cid}/cancel", headers=HDRS)
    deadline = time.monotonic() + 15
    st = None
    while time.monotonic() < deadline:
        st = client.get(f"/context/{cid}/manifest", headers=HDRS).json().get("status")
        if st in ("cancelled", "done", "error"):
            break
        time.sleep(0.05)
    assert st in ("cancelled", "done", "error")


def test_request_docling_when_absent_errors(client, tmp_path):
    pdf = tmp_path / "s.pdf"
    _single(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    r = client.post("/context/analyze", json={"provider": "docling"}, headers=HDRS)
    assert r.status_code == 422
    assert r.json()["error"] == "docling_unavailable"


# ------------------------------------------------------------------ BasicProvider direkt (deterministisch)
def test_basic_provider_extract_direct(tmp_path):
    pdf = tmp_path / "s.pdf"
    _single(pdf)
    import hashlib

    sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    ctx = make_context_dir(str(tmp_path), sha, "basic")
    seen = []
    man = BasicProvider().convert(str(pdf), ctx, sha, lambda d, t: seen.append((d, t)), lambda: False)
    assert man["status"] == "done" and man["pageCount"] == 2
    assert seen == [(1, 2), (2, 2)]  # Fortschritt je Seite
    assert read_manifest(ctx)["provider"] == "basic"
    assert os.path.isfile(os.path.join(ctx, "page-000000.jsonl"))


def test_basic_provider_cancel_stops_early(tmp_path):
    pdf = tmp_path / "s.pdf"
    _single(pdf)
    import hashlib

    sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    ctx = make_context_dir(str(tmp_path), sha, "basic")
    # bricht vor der ersten Seite ab
    man = BasicProvider().convert(str(pdf), ctx, sha, lambda d, t: None, lambda: True)
    assert man["status"] == "cancelled"
    assert read_manifest(ctx) is None  # abgebrochen -> nicht gecacht


# ------------------------------------------------------------------ Docling-Protokoll gegen Stub-Sidecar
_STUB = '''
import sys, os
sys.path.insert(0, __ROOT__)
from backend.context.base import write_page_jsonl, write_manifest
args = sys.argv[1:]
if "--version" in args:
    print(__import__("json").dumps({"event":"version","protocolVersion":__PROT__,"available":True}))
    sys.exit(0)
inp, out = args[0], args[1]
write_page_jsonl(out, 0, [{"page":0,"type":"text","bbox":[0,0,10,10],"text":"Stub-Inhalt"}])
write_manifest(out, {"status":"done","provider":"docling","sourceSha256":"","protocolVersion":__PROT__,"pageCount":1,
    "pages":[{"page":0,"file":"page-000000.jsonl","bytes":1,"elements":1}]})
print(__import__("json").dumps({"event":"done","pageCount":1}))
'''


def _write_stub(tmp_path, protocol="1.0"):
    src = _STUB.replace("__ROOT__", repr(_ROOT)).replace("__PROT__", json.dumps(protocol))
    p = tmp_path / "docling_stub.py"
    p.write_text(src, encoding="utf-8")
    return str(p)


def test_docling_provider_detects_stub(client, tmp_path, monkeypatch):
    stub = _write_stub(tmp_path)
    monkeypatch.setenv("PDF_EDITOR_DOCLING_WORKER", stub)
    monkeypatch.setenv("PDF_EDITOR_DOCLING_PYTHON", sys.executable)
    info = client.get("/context/providers", headers=HDRS).json()
    assert info["docling"] is True


def test_docling_provider_analyze_via_stub(client, tmp_path, monkeypatch):
    stub = _write_stub(tmp_path)
    monkeypatch.setenv("PDF_EDITOR_DOCLING_WORKER", stub)
    monkeypatch.setenv("PDF_EDITOR_DOCLING_PYTHON", sys.executable)
    pdf = tmp_path / "s.pdf"
    _single(pdf)
    client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    a = client.post("/context/analyze", json={"provider": "docling"}, headers=HDRS).json()
    assert a["provider"] == "docling"
    man = _wait_done(client, a["contextId"])
    assert man["status"] == "done" and man["provider"] == "docling"
    els = client.get(f"/context/{a['contextId']}/pages?from=0", headers=HDRS).json()["elements"]
    assert any("Stub-Inhalt" in e["text"] for e in els)


def test_docling_protocol_mismatch_disables(client, tmp_path, monkeypatch):
    stub = _write_stub(tmp_path, protocol="9.9")
    monkeypatch.setenv("PDF_EDITOR_DOCLING_WORKER", stub)
    monkeypatch.setenv("PDF_EDITOR_DOCLING_PYTHON", sys.executable)
    info = client.get("/context/providers", headers=HDRS).json()
    assert info["docling"] is False
