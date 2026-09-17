"""Tests Section 10b: Sanitise, Metadaten-Scrub, Flatten.

Run:
    cd "/home/iambarth/Documents/Projects/B&F PDF Editor" \
      && backend/.venv/bin/python -m pytest backend/tests/test_security.py -q
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
from pikepdf import Array, Dictionary, Name, Pdf, Stream, String

from backend import main, security_ops

HDRS = {"X-Auth-Token": "test-token-xyz"}


@pytest.fixture
def client(tmp_path):
    sd = tmp_path / "run"; sd.mkdir()
    snap = tmp_path / "snap"; snap.mkdir()
    os.environ["PDF_EDITOR_SESSION_DIR"] = str(sd)
    os.environ["PDF_EDITOR_SNAPSHOT_DIR"] = str(snap)
    os.environ["PDF_EDITOR_UNDO_TO_DISK"] = "1"
    with TestClient(main.app) as c:
        yield c


def base_pdf(path):
    d = fitz.open(); p = d.new_page(width=300, height=300)
    p.insert_text((50, 60), "HELLO", fontsize=20)
    d.save(str(path)); d.close()


def inject_js_and_files(path):
    """Fuegt Root/OpenAction(JS), Names/EmbeddedFiles + EmbeddedFile-Stream hinzu."""
    pdf = Pdf.open(str(path), allow_overwriting_input=True)
    pdf.Root.OpenAction = Dictionary(S=Name("/JavaScript"), JS=String("app.alert('x')"))
    raw = Stream(pdf, b"secret", d=Dictionary(Type=Name("/EmbeddedFile")))
    pdf.Root.Names = Dictionary(
        JavaScript=Dictionary(Names=Array([String("s"), String("app.alert('y')")])),
        EmbeddedFiles=Dictionary(Names=Array([String("a.bin"), raw])),
    )
    pdf.save(str(path)); pdf.close()


# ---------------------------------------------------------------- Sanitise
def test_sanitize_removes_js_and_embedded(tmp_path):
    p = tmp_path / "d.pdf"; base_pdf(p); inject_js_and_files(p)
    res = security_ops.sanitize(str(p))
    assert res["clean"] is False
    assert res["removed"]["javascript"] >= 1
    assert res["removed"]["embeddedFiles"] >= 1
    # PDF ist danach noch gueltig, Inhalt (Text) erhalten
    d = fitz.open(str(p)); assert "HELLO" in d.load_page(0).get_text(); d.close()
    # idempotent: zweiter Lauf findet nichts mehr
    assert security_ops.sanitize(str(p))["clean"] is True


def test_sanitize_clean_doc(tmp_path):
    p = tmp_path / "d.pdf"; base_pdf(p)
    assert security_ops.sanitize(str(p))["clean"] is True


# ---------------------------------------------------------------- Metadaten-Scrub
def test_scrub_metadata(tmp_path):
    p = tmp_path / "d.pdf"; base_pdf(p)
    d = fitz.open(str(p))
    d.set_metadata({"author": "Max", "producer": "GeheimTool", "creationDate": "D:20200101"})
    d.set_xml_metadata("<x:xmpmeta>GEHEIM</x:xmpmeta>")
    d.save(str(p), incremental=True, encryption=fitz.PDF_ENCRYPT_KEEP); d.close()
    res = security_ops.scrub_metadata(str(p))
    assert res["scrubbed"] is True and res["hadXmp"] is True
    d = fitz.open(str(p))
    md = d.metadata
    assert not md.get("author") and not md.get("producer")
    assert not d.get_xml_metadata()  # XMP-Stream entfernt
    d.close()


# ---------------------------------------------------------------- Flatten
def test_flatten_annotations(tmp_path):
    p = tmp_path / "d.pdf"; base_pdf(p)
    d = fitz.open(str(p)); p0 = d.load_page(0)
    p0.add_highlight_annot(fitz.Rect(40, 45, 200, 70))
    assert len(list(p0.annots())) == 1
    d.save(str(p), incremental=True, encryption=fitz.PDF_ENCRYPT_KEEP); d.close()
    res = security_ops.flatten(str(p), ["annotations"])
    assert res["annotationsBurned"] == 1
    d = fitz.open(str(p)); assert len(list(d.load_page(0).annots())) == 0; d.close()


def test_flatten_bad_category(tmp_path):
    p = tmp_path / "d.pdf"; base_pdf(p)
    with pytest.raises(security_ops.SecurityError):
        security_ops.flatten(str(p), ["stamps"])


# ---------------------------------------------------------------- Routen + Undo
def test_route_scrub_then_undo(client, tmp_path):
    src = tmp_path / "in.pdf"; base_pdf(src)
    d = fitz.open(str(src)); d.set_metadata({"author": "Max", "producer": "GeheimTool"}); d.save(str(src), incremental=True, encryption=fitz.PDF_ENCRYPT_KEEP); d.close()
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/document/scrub-metadata", headers=HDRS)
    assert r.status_code == 200
    client.post("/document/undo", headers=HDRS)
    data = client.get("/document/file", headers=HDRS).content
    d = fitz.open(stream=data, filetype="pdf")
    assert d.metadata.get("producer") == "GeheimTool"  # Undo stellt Metadaten wieder her
    d.close()


def test_route_sanitize_and_flatten(client, tmp_path):
    src = tmp_path / "in.pdf"; base_pdf(src); inject_js_and_files(src)
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    s = client.post("/security/sanitize", headers=HDRS)
    assert s.status_code == 200 and s.json()["removed"]["javascript"] >= 1
    f = client.post("/document/flatten", json={"categories": ["annotations"]}, headers=HDRS)
    assert f.status_code == 200 and f.json()["flattened"] == ["annotations"]
