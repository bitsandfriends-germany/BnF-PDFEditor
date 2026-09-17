"""PART 3 §3 — VERIFIKATION der Seiten-Operationen über den ECHTEN PFAD + Zweitbibliothek.

Muster (wie test_merge_verify.py / test_reorder_verify.py):
  Fixture mit bekannten Eigenschaften -> HTTP-Endpoint (nicht Helfer) -> `/document/save` ->
  Ergebnis mit pikepdf (Zweitbibliothek) strukturell prüfen + fitz-Reopen für Text -> und
  prüfen, was sich NICHT ändern darf.

Identitäts-Marker je Seite: UNTERSCHIEDLICHE BREITE (und Höhe). pikepdf liest /MediaBox und
/Rotate unabhängig von PyMuPDF; PyMuPDF-Reopen prüft Textmarker.

Run: backend/.venv/bin/python -m pytest backend/tests/test_pages_verify.py -q
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
import pikepdf
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


# ------------------------------------------------------------------- Helfer
def make_widths_pdf(path, widths, height=100):
    """n Seiten, Breite[i]=widths[i], Text 'P<i+1>'. Breite+Text dienen als Seiten-Identität."""
    d = fitz.open()
    for w in widths:
        d.new_page(width=w, height=height)
    for i in range(len(widths)):
        d[i].insert_text((15, 50), "P%d" % (i + 1), fontsize=20)
    d.save(str(path))
    d.close()


def dims(path):
    """pikepdf-Zweitbibliothek: [(width, height), ...] über /MediaBox in Dokumentreihenfolge."""
    pdf = pikepdf.open(str(path))
    try:
        out = []
        for pg in pdf.pages:
            mb = pg.MediaBox
            out.append((round(float(mb[2]) - float(mb[0])), round(float(mb[3]) - float(mb[1]))))
        return out
    finally:
        pdf.close()


def widths(path):
    return [w for (w, _h) in dims(path)]


def rotations(path):
    pdf = pikepdf.open(str(path))
    try:
        # pikepdf 10.x: /Rotate als Rohwert lesen (Page.rotate() ist hier ein Mutator).
        return [int(pg.get("/Rotate", 0)) for pg in pdf.pages]
    finally:
        pdf.close()


def labels(path):
    d = fitz.open(str(path))
    try:
        return [d.load_page(i).get_text().strip() for i in range(d.page_count)]
    finally:
        d.close()


def open_and_save(client, src, out):
    assert client.post("/document/open", json={"path": str(src)}, headers=HDRS).status_code == 200
    return out


# ------------------------------------------------------------------- Rotate
def test_rotate_selection_second_lib_and_invariants(client, tmp_path):
    src = tmp_path / "r.pdf"; make_widths_pdf(src, [100, 200, 300])
    out = tmp_path / "out.pdf"
    open_and_save(client, src, out)
    r = client.post("/pages/rotate-selection", json={"expr": "1,3", "delta": 90}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200

    assert rotations(out) == [90, 0, 90]          # /Rotate via pikepdf (Zweitbibliothek)
    assert widths(out) == [100, 200, 300]         # Invariante: MediaBox/Größe unverändert
    assert len(dims(out)) == 3                     # Invariante: Seitenzahl unverändert


# ------------------------------------------------------------------- Delete
def test_delete_second_lib_keeps_others_in_order(client, tmp_path):
    src = tmp_path / "d.pdf"; make_widths_pdf(src, [100, 200, 300, 400])
    out = tmp_path / "out.pdf"
    open_and_save(client, src, out)
    r = client.post("/pages/delete-selection", json={"expr": "2,3"}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert r.json()["page_count"] == 2
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200

    assert widths(out) == [100, 400]              # genau 2 gelöscht, die Richtigen
    assert labels(out) == ["P1", "P4"]            # behaltener Text da, in Reihenfolge; gelöschter weg


# ------------------------------------------------------------------- Duplicate
def test_duplicate_second_lib_originals_intact(client, tmp_path):
    src = tmp_path / "dup.pdf"; make_widths_pdf(src, [100, 200, 300])
    out = tmp_path / "out.pdf"
    open_and_save(client, src, out)
    r = client.post("/pages/duplicate", json={"expr": "1", "position": "end"}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert r.json()["page_count"] == 4
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200

    assert widths(out) == [100, 200, 300, 100]
    assert labels(out) == ["P1", "P2", "P3", "P1"]
    assert widths(out)[:3] == [100, 200, 300]      # Invariante: Originalseiten unverändert


# ------------------------------------------------------------------- Insert
def test_insert_blank_at_index_second_lib(client, tmp_path):
    src = tmp_path / "i.pdf"; make_widths_pdf(src, [100, 300])
    out = tmp_path / "out.pdf"
    open_and_save(client, src, out)
    r = client.post("/pages/insert", json={"position": "after", "page": 1, "source": {"kind": "blank", "width": 250, "height": 80}}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert r.json()["page_count"] == 3
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200

    assert dims(out) == [(100, 100), (250, 80), (300, 100)]  # eingefügt AN Index 1, nicht am Ende
    assert labels(out) == ["P1", "", "P2"]                   # Nachbarseiten unverändert, Lücke leer


# ------------------------------------------------------------------- Extract
def test_extract_second_lib_source_unchanged(client, tmp_path):
    src = tmp_path / "e.pdf"; make_widths_pdf(src, [100, 200, 300, 400])
    outdir = tmp_path / "ext"; outdir.mkdir()
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/pages/extract", json={"expr": "2-3", "destDir": str(outdir), "each": False}, headers=HDRS)
    assert r.status_code == 200, r.text
    created = r.json()["created"][0]

    assert widths(created) == [200, 300]           # genau die gewünschten Seiten (Zweitbibliothek)
    assert labels(created) == ["P2", "P3"]
    assert widths(src) == [100, 200, 300, 400]     # Invariante: Quelldatei auf Platte unverändert


# ------------------------------------------------------------------- Split
def test_split_second_lib_reproduces_order(client, tmp_path):
    src = tmp_path / "s.pdf"; make_widths_pdf(src, [100, 200, 300, 400, 500])
    outdir = tmp_path / "sp"; outdir.mkdir()
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/pages/split", json={"mode": "everyN", "count": 2, "destDir": str(outdir)}, headers=HDRS)
    assert r.status_code == 200, r.text
    created = r.json()["created"]

    per = [widths(c) for c in created]             # Teilbreiten je Datei (Zweitbibliothek)
    assert sum(len(p) for p in per) == 5           # Summe = Original-Seitenzahl
    flat = [w for p in per for w in p]
    assert flat == [100, 200, 300, 400, 500]       # Aneinanderfügen reproduziert Original-Reihenfolge
    assert [len(p) for p in per] == [2, 2, 1]
