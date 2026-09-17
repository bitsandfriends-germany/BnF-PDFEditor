"""Tests fuer die Seitenverwaltung (Section 6): Auswahl-Rotation/-Loeschung, Duplizieren,
Extrahieren, Splitten. Deckt reine pdflib-Funktionen UND die Command/Undo-Verdrahtung ab.

Run:
    cd "/home/iambarth/Documents/Projects/B&F PDF Editor" \
      && backend/.venv/bin/python -m pytest backend/tests/test_pages_ops.py -q
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

from backend import main
from backend import pdflib

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


def make_labeled_pdf(path, n):
    """n Seiten, je mit unterscheidbarem Text 'P<i>' (i 1-basiert) fuer Reihenfolge-Checks."""
    d = fitz.open()
    for i in range(1, n + 1):
        page = d.new_page()
        page.insert_text((72, 72), "P%d" % i, fontsize=40)
    d.save(str(path))
    d.close()


def labels(path):
    d = fitz.open(str(path))
    try:
        return [d.load_page(i).get_text().strip() for i in range(d.page_count)]
    finally:
        d.close()


def rotations(path):
    d = fitz.open(str(path))
    try:
        return [int(d.load_page(i).rotation) for i in range(d.page_count)]
    finally:
        d.close()


# --------------------------------------------------------------- reine pdflib-Funktionen
def test_rotate_selection_is_order_insensitive(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 4)
    pdflib.rotate_pages(str(p), "1,3", 90)
    assert rotations(p) == [90, 0, 90, 0]


def test_delete_guard_refuses_all(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 3)
    with pytest.raises(pdflib.BadPage):
        pdflib.delete_pages(str(p), "all")
    # Teilloeschung erlaubt
    res = pdflib.delete_pages(str(p), "1,2")
    assert res["page_count"] == 1
    assert labels(p) == ["P3"]


def test_delete_out_of_range_raises(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 3)
    with pytest.raises(pdflib.BadPage):
        pdflib.delete_pages(str(p), "4")


def test_duplicate_at_end_increases_count(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 3)
    res = pdflib.duplicate_pages(str(p), "1", "end", None)
    assert res["added"] == 1 and res["page_count"] == 4
    assert labels(p) == ["P1", "P2", "P3", "P1"]


def test_duplicate_before_position_and_order_preserved(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 5)
    res = pdflib.duplicate_pages(str(p), "4-5", "before", 2)  # Kopie von 4,5 vor Seite 2
    assert res["page_count"] == 7
    assert labels(p) == ["P1", "P4", "P5", "P2", "P3", "P4", "P5"]


def test_duplicate_bad_position(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 3)
    with pytest.raises(pdflib.BadPage):
        pdflib.duplicate_pages(str(p), "1", "before", 99)


def test_extract_single_file_source_unchanged_order(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 5)
    out = tmp_path / "out"; out.mkdir()
    res = pdflib.extract_pages(str(p), "5,1,3", str(out), False, "extract")
    assert res["count"] == 1
    assert labels(res["created"][0]) == ["P5", "P1", "P3"]
    # Quelle unveraendert
    assert labels(p) == ["P1", "P2", "P3", "P4", "P5"]


def test_extract_each_page(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 4)
    out = tmp_path / "out"; out.mkdir()
    res = pdflib.extract_pages(str(p), "odd", str(out), True, "blatt")
    assert res["count"] == 2
    got = sorted(os.path.basename(x) for x in res["created"])
    assert got == ["blatt_p1.pdf", "blatt_p3.pdf"]


def test_extract_never_overwrites(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 3)
    out = tmp_path / "out"; out.mkdir()
    first = pdflib.extract_pages(str(p), "all", str(out), False, "x")["created"][0]
    second = pdflib.extract_pages(str(p), "all", str(out), False, "x")["created"][0]
    assert os.path.basename(first) == "x.pdf"
    assert os.path.basename(second) == "x_1.pdf"


def test_split_everyN(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 5)
    out = tmp_path / "out"; out.mkdir()
    res = pdflib.split_document(str(p), "everyN", None, 2, None, str(out), "teil")
    assert res["parts"] == [2, 2, 1]
    assert labels(res["created"][0]) == ["P1", "P2"]
    assert labels(res["created"][-1]) == ["P5"]


def test_split_points(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 5)
    out = tmp_path / "out"; out.mkdir()
    res = pdflib.split_document(str(p), "points", None, None, [3], str(out), "teil")
    assert res["parts"] == [2, 3]


def test_split_every(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 3)
    out = tmp_path / "out"; out.mkdir()
    res = pdflib.split_document(str(p), "every", None, None, None, str(out), "s")
    assert res["count"] == 3
    assert labels(res["created"][1]) == ["P2"]


def test_split_rejects_single_result(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 3)
    out = tmp_path / "out"; out.mkdir()
    with pytest.raises(pdflib.BadPage):
        pdflib.split_document(str(p), "at", 1, None, None, str(out), "s")  # Schnitt vor S1 => 1 Segment


def test_unique_filename_suffixes(tmp_path):
    out = tmp_path / "out"; out.mkdir()
    a = pdflib.unique_filename(str(out), "n")
    open(a, "w").close()
    b = pdflib.unique_filename(str(out), "n")
    open(b, "w").close()
    c = pdflib.unique_filename(str(out), "n")
    assert [os.path.basename(x) for x in (a, b, c)] == ["n.pdf", "n_1.pdf", "n_2.pdf"]


def test_missing_dest_dir_raises(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 2)
    with pytest.raises(pdflib.WriteDenied):
        pdflib.extract_pages(str(p), "1", str(tmp_path / "nope"), False, "x")


# ---------------------------------------------------------------------- Route + Command/Undo
def test_route_rotate_then_undo(client, tmp_path):
    src = tmp_path / "in.pdf"; make_labeled_pdf(src, 3)
    assert client.post("/document/open", json={"path": str(src)}, headers=HDRS).status_code == 200
    r = client.post("/pages/rotate-selection", json={"expr": "all", "delta": 180}, headers=HDRS)
    assert r.status_code == 200
    assert all(p["rotation"] == 180 for p in client.get("/document/pages", headers=HDRS).json()["pages"])
    assert client.post("/document/undo", headers=HDRS).status_code == 200
    assert all(p["rotation"] == 0 for p in client.get("/document/pages", headers=HDRS).json()["pages"])


def test_route_duplicate_then_undo(client, tmp_path):
    src = tmp_path / "in.pdf"; make_labeled_pdf(src, 3)
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/pages/duplicate", json={"expr": "2", "position": "end"}, headers=HDRS)
    assert r.status_code == 200 and r.json()["page_count"] == 4
    assert len(client.get("/document/pages", headers=HDRS).json()["pages"]) == 4
    client.post("/document/undo", headers=HDRS)
    assert len(client.get("/document/pages", headers=HDRS).json()["pages"]) == 3


def test_route_delete_all_is_422(client, tmp_path):
    src = tmp_path / "in.pdf"; make_labeled_pdf(src, 2)
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/pages/delete-selection", json={"expr": "all"}, headers=HDRS)
    assert r.status_code == 422
    assert "message" in r.json()


def test_route_extract_leaves_source_unchanged(client, tmp_path):
    src = tmp_path / "in.pdf"; make_labeled_pdf(src, 4)
    out = tmp_path / "out"; out.mkdir()
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/pages/extract", json={"expr": "2-3", "destDir": str(out), "each": False}, headers=HDRS)
    assert r.status_code == 200
    assert r.json()["count"] == 1
    assert len(client.get("/document/pages", headers=HDRS).json()["pages"]) == 4


def test_route_extract_on_readonly_allowed(client, tmp_path):
    # user != owner => Session read-only; Extraktion (Quelle unveraendert) muss trotzdem gehen.
    src = tmp_path / "ro.pdf"
    plain = tmp_path / "plain.pdf"; make_labeled_pdf(plain, 3)
    import pikepdf
    pdf = pikepdf.open(str(plain))
    pdf.save(str(src), encryption=pikepdf.Encryption(owner="o", user="u", R=6))
    pdf.close()
    out = tmp_path / "out"; out.mkdir()
    op = client.post("/document/open", json={"path": str(src), "password": "u"}, headers=HDRS)
    assert op.status_code == 200 and op.json()["readOnly"] is True
    r = client.post("/pages/extract", json={"expr": "1", "destDir": str(out), "each": False}, headers=HDRS)
    assert r.status_code == 200 and r.json()["count"] == 1


def test_route_split(client, tmp_path):
    src = tmp_path / "in.pdf"; make_labeled_pdf(src, 4)
    out = tmp_path / "out"; out.mkdir()
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/pages/split", json={"mode": "everyN", "count": 2, "destDir": str(out)}, headers=HDRS)
    assert r.status_code == 200 and r.json()["count"] == 2


# ---------------------------------------------------------------------- Einfuegen (Section 6)
def _make_png(path, w=160, h=90):
    d = fitz.open(); p = d.new_page(width=w, height=h); p.insert_text((10, 40), "IMG", fontsize=24)
    p.get_pixmap().save(str(path)); d.close()


def _make_prefixed_pdf(path, n, prefix="Q"):
    d = fitz.open()
    for i in range(1, n + 1):
        pg = d.new_page(); pg.insert_text((72, 72), "%s%d" % (prefix, i), fontsize=40)
    d.save(str(path)); d.close()


def _make_enc_pdf(path, pw="s"):
    import pikepdf
    tmp = str(path) + ".plain"; d = fitz.open(); d.new_page(); d.save(tmp); d.close()
    pdf = pikepdf.open(tmp); pdf.save(str(path), encryption=pikepdf.Encryption(owner=pw, user=pw, R=6)); pdf.close()
    os.remove(tmp)


def test_insert_blank_position_and_blank(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 3)
    res = pdflib.insert_pages(str(p), "after", 2, {"kind": "blank", "width": 200, "height": 100})
    assert res["page_count"] == 4
    d = fitz.open(str(p))
    assert (round(d.load_page(2).rect.width), round(d.load_page(2).rect.height)) == (200, 100)
    assert d.load_page(2).get_text().strip() == ""
    d.close()


def test_insert_image_size(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 2)
    png = tmp_path / "x.png"; _make_png(png, 160, 90)
    res = pdflib.insert_pages(str(p), "end", None, {"kind": "image", "path": str(png)})
    assert res["page_count"] == 3
    d = fitz.open(str(p)); assert (round(d.load_page(2).rect.width), round(d.load_page(2).rect.height)) == (160, 90); d.close()


def test_insert_pdf_all_at_start(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 3)
    src = tmp_path / "src.pdf"; _make_prefixed_pdf(src, 2, "Q")
    res = pdflib.insert_pages(str(p), "start", None, {"kind": "pdf", "path": str(src)})
    assert res["page_count"] == 5
    assert labels(p) == ["Q1", "Q2", "P1", "P2", "P3"]


def test_insert_pdf_range(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 2)
    src = tmp_path / "src.pdf"; _make_prefixed_pdf(src, 5, "Q")
    res = pdflib.insert_pages(str(p), "end", None, {"kind": "pdf", "path": str(src), "expr": "2-3"})
    assert res["page_count"] == 4
    assert labels(p) == ["P1", "P2", "Q2", "Q3"]


def test_insert_pdf_scale_matches_target_size(tmp_path):
    p = tmp_path / "d.pdf"; d = fitz.open(); d.new_page(width=595, height=842); d.save(str(p)); d.close()
    src = tmp_path / "src.pdf"; sd = fitz.open(); sd.new_page(width=100, height=80); sd.save(str(src)); sd.close()
    res = pdflib.insert_pages(str(p), "before", 1, {"kind": "pdf", "path": str(src), "scale": True})
    assert res["page_count"] == 2
    d = fitz.open(str(p)); r = d.load_page(0).rect
    assert (round(r.width), round(r.height)) == (595, 842)  # skaliert, nicht 100x80
    d.close()


def test_insert_encrypted_source_requires_password(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 1)
    src = tmp_path / "enc.pdf"; _make_enc_pdf(src, "s")
    with pytest.raises(pdflib.PasswordRequired):
        pdflib.insert_pages(str(p), "end", None, {"kind": "pdf", "path": str(src)})
    # mit korrektem Passwort klappt es
    res = pdflib.insert_pages(str(p), "end", None, {"kind": "pdf", "path": str(src), "password": "s"})
    assert res["page_count"] == 2


def test_insert_bad_kind(tmp_path):
    p = tmp_path / "d.pdf"; make_labeled_pdf(p, 2)
    with pytest.raises(pdflib.BadPage):
        pdflib.insert_pages(str(p), "end", None, {"kind": "weird"})


def test_route_insert_then_undo(client, tmp_path):
    src = tmp_path / "in.pdf"; make_labeled_pdf(src, 3)
    blank = tmp_path / "s.pdf"; _make_prefixed_pdf(blank, 2, "Q")
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/pages/insert", json={"position": "end", "source": {"kind": "pdf", "path": str(blank)}}, headers=HDRS)
    assert r.status_code == 200 and r.json()["page_count"] == 5
    client.post("/document/undo", headers=HDRS)
    assert len(client.get("/document/pages", headers=HDRS).json()["pages"]) == 3


def test_undo_restores_snapshot_byte_identical(client, tmp_path):
    """§3: Nach Undo ist das Dokument BYTE-IDENTISCH mit dem Snapshot vor der Operation.
    Gelesen über den echten Endpunkt /document/file (dieselben Bytes, die der Renderer sieht).
    Zusätzlich: die Undo-Kopie öffnet mit der zweiten, unabhängigen Bibliothek (pikepdf)."""
    import hashlib
    import pikepdf

    src = tmp_path / "in.pdf"; make_labeled_pdf(src, 3)
    assert client.post("/document/open", json={"path": str(src)}, headers=HDRS).status_code == 200
    before = client.get("/document/file", headers=HDRS).content

    r = client.post("/pages/rotate-selection", json={"expr": "2", "delta": 90}, headers=HDRS)
    assert r.status_code == 200
    mid = client.get("/document/file", headers=HDRS).content
    assert mid != before, "Rotation muss die Arbeitskopie-Bytes verändern"

    assert client.post("/document/undo", headers=HDRS).status_code == 200
    after = client.get("/document/file", headers=HDRS).content
    assert hashlib.sha256(after).digest() == hashlib.sha256(before).digest()

    out = tmp_path / "after_undo.pdf"; out.write_bytes(after)
    with pikepdf.open(str(out)) as pdf:  # unabhängiger Leser: Datei ist intakt, nichts verloren
        assert len(pdf.pages) == 3


def test_document_state_reports_page_count_after_insert(client, tmp_path):
    """E2E-Fund (Runde 29): /document/state MUSS die aktuelle Seitenzahl melden — der Toolbar
    sonst nach jeder Seiten-Mutation veraltet (echter App-Defekt, auch in Electron)."""
    src = tmp_path / "in.pdf"; make_labeled_pdf(src, 3)
    assert client.post("/document/open", json={"path": str(src)}, headers=HDRS).status_code == 200
    assert client.get("/document/state", headers=HDRS).json()["pageCount"] == 3
    r = client.post("/pages/insert", json={"position": "end", "source": {"kind": "blank", "width": 200, "height": 200}}, headers=HDRS)
    assert r.status_code == 200
    assert client.get("/document/state", headers=HDRS).json()["pageCount"] == 4
