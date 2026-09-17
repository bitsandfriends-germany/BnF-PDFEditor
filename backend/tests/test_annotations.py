"""Tests Section 8: Annotationen-Liste + Entfernen über Bereich."""
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

from backend import annotation_ops, main

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
    base = tmp_path / "base.pdf"
    b = fitz.open()
    b.new_page()
    b.new_page()
    b.save(str(base))
    b.close()
    fn = tmp_path / "doc.pdf"
    d = fitz.open(str(base))  # frische In-Memory-Seiten nehmen keine Annots -> erst speichern, dann oeffnen
    p0 = d[0]
    p1 = d[1]
    n1 = p0.add_text_annot((72, 72), "Erster Kommentar")
    n1.set_info(title="Anna", content="Erster Kommentar")
    n1.update()
    p1.insert_text((72, 100), "zu markieren")
    n2 = p1.add_highlight_annot(fitz.Rect(72, 90, 200, 110))
    n2.set_info(title="Ben", content="wichtig")
    n2.update()
    d.save(str(fn))
    d.close()
    return str(fn)


def open_doc(client, sample):
    r = client.post("/document/open", json={"path": sample}, headers=HDRS)
    assert r.status_code == 200, r.text


def test_list_annotations_unit(sample):
    res = annotation_ops.list_annotations(sample)
    assert res["count"] == 2
    by_page = {a["page"]: a for a in res["annotations"]}
    assert by_page[1]["type"] == "Text"          # Sticky-Note
    assert by_page[1]["author"] == "Anna"
    assert by_page[1]["text"] == "Erster Kommentar"
    assert by_page[2]["type"] == "Highlight"
    assert by_page[2]["author"] == "Ben"


def test_remove_over_range_unit(sample):
    res = annotation_ops.remove_annotations(sample, "2")  # nur Seite 2
    assert res["removed"] == 1
    assert annotation_ops.list_annotations(sample)["count"] == 1


def test_remove_all_default(sample):
    assert annotation_ops.remove_annotations(sample, None)["removed"] == 2
    assert annotation_ops.list_annotations(sample)["count"] == 0


def test_route_list_and_remove_with_undo(client, sample):
    open_doc(client, sample)
    r = client.get("/document/annotations", headers=HDRS)
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 2
    rm = client.post("/document/remove-annotations", json={"expr": "1-2"}, headers=HDRS)
    assert rm.status_code == 200, rm.text
    assert rm.json()["removed"] == 2
    assert client.get("/document/annotations", headers=HDRS).json()["count"] == 0
    # Rueckgaengig (Command): Undo stellt beide wieder her.
    u = client.post("/document/undo", headers=HDRS)
    assert u.status_code == 200, u.text
    assert client.get("/document/annotations", headers=HDRS).json()["count"] == 2


def _empty_pdf(tmp_path):
    fn = tmp_path / "plain2.pdf"
    d = fitz.open()
    d.new_page(); d.new_page()
    d.save(str(fn)); d.close()
    return str(fn)


def test_add_sticky_and_highlight_unit(tmp_path):
    fn = str(tmp_path / "add.pdf")
    d = fitz.open(); d.new_page(); d.new_page(); d.save(fn); d.close()
    a1 = annotation_ops.add_annotation(fn, page=0, annot_type="Text", rect={"x": 72, "y": 72, "width": 0, "height": 0}, text="Notiz", author="Karla")
    assert a1["type"] == "Text" and a1["page"] == 1 and a1["author"] == "Karla" and a1["text"] == "Notiz"
    a2 = annotation_ops.add_annotation(fn, page=1, annot_type="Highlight", rect={"x": 72, "y": 90, "width": 100, "height": 15}, color="#ff0000", author="Karla")
    assert a2["page"] == 2
    res = annotation_ops.list_annotations(fn)
    assert res["count"] == 2
    assert {x["type"] for x in res["annotations"]} == {"Text", "Highlight"}


def test_add_invalid_type_and_range_unit(tmp_path):
    fn = _empty_pdf(tmp_path)
    with pytest.raises(annotation_ops.AnnotationError):
        annotation_ops.add_annotation(fn, page=0, annot_type="Ink", rect={"x": 1, "y": 1})
    with pytest.raises(annotation_ops.AnnotationError):
        annotation_ops.add_annotation(fn, page=99, annot_type="Text", rect={"x": 1, "y": 1})


def test_route_add_and_undo(client, sample):
    open_doc(client, sample)
    before = client.get("/document/annotations", headers=HDRS).json()["count"]
    r = client.post("/document/add-annotations", json={"page": 0, "type": "Text", "x": 100, "y": 100, "text": "neu", "author": "Zoe"}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert client.get("/document/annotations", headers=HDRS).json()["count"] == before + 1
    client.post("/document/undo", headers=HDRS)
    assert client.get("/document/annotations", headers=HDRS).json()["count"] == before


def test_get_edit_delete_single_unit(sample):
    # two annots: 1:0 (sticky), 2:0 (highlight)
    det = annotation_ops.get_annotation(sample, "1:0")
    assert det["type"] == "Text" and det["author"] == "Anna" and det["rect"]["width"] >= 0
    # edit: Text/Autor/Deckkraft am Klebezettel (Icon-Farbe ist kein einfacher Strichwert)
    upd = annotation_ops.edit_annotation(sample, "1:0", text="geaendert", author="Zoe", opacity=0.5)
    assert upd["text"] == "geaendert" and upd["author"] == "Zoe"
    assert abs(upd["opacity"] - 0.5) < 1e-6
    # restyle (Strichfarbe) am Highlight
    rs = annotation_ops.edit_annotation(sample, "2:0", color="#ff0000")
    assert rs["color"] == "#ff0000"
    # move via absolute rect (bottom-left) -> new rect reflects it
    moved = annotation_ops.edit_annotation(sample, "1:0", rect={"x": 40, "y": 40, "width": 10, "height": 10})
    assert moved["rect"]["x"] == 40
    # delete single
    assert annotation_ops.delete_annotation(sample, "2:0")["deleted"] == 1
    assert annotation_ops.list_annotations(sample)["count"] == 1


def test_edit_unknown_id_unit(sample):
    with pytest.raises(annotation_ops.AnnotationError):
        annotation_ops.get_annotation(sample, "99:0")
    with pytest.raises(annotation_ops.AnnotationError):
        annotation_ops.edit_annotation(sample, "1:5", text="x")


def test_routes_edit_delete_undo(client, sample):
    open_doc(client, sample)
    e = client.post("/document/edit-annotations", json={"id": "1:0", "text": "neu"}, headers=HDRS)
    assert e.status_code == 200 and e.json()["text"] == "neu"
    d = client.post("/document/delete-annotation", json={"id": "2:0"}, headers=HDRS)
    assert d.status_code == 200 and d.json()["deleted"] == 1
    assert client.get("/document/annotations", headers=HDRS).json()["count"] == 1
    # Undo der Loeschung stellt beide wieder her (Snapshot vor DELETE)
    client.post("/document/undo", headers=HDRS)
    assert client.get("/document/annotations", headers=HDRS).json()["count"] == 2
