"""PART 3 §3 — VERIFIKATION Anhängen/Merge DURCH DEN ECHTEN PFAD (POST /pages/merge).

Grundsatz aus PART 3: "Ein Feature ist fertig, wenn sich das PDF auf der Platte wie
spezifiziert geändert hat." Dieser Test führt Merge über die API aus (nicht gegen einen
internen Helfer), speichert das Ergebnis als Datei und prüft es mit einer ZWEITEN,
unabhängigen Bibliothek (pikepdf) plus erneutem Öffnen (PyMuPDF auf der Geschriebenen Datei,
nicht dem In-Memory-Doc der Mutation). Er prüft auch, was sich NICHT ändern darf.

Fixture (mit PyMuPDF gebaut, da merge_pdf PyMuPDF nutzt):
  Ziel   : 2 Seiten Text "Z1"/"Z2", TOC ["Ziel-Kapitel"->1], Link S1->S2, Textfeld "ziel_field".
  Quelle : 2 Seiten Text "Q1"/"Q2", TOC ["Quelle-Kapitel"->1], Link S1->S2, Textfeld "quelle_field".

Erwartung nach Merge+Save: 4 Seiten [Z1,Z2,Q1,Q2]; Ziel unverändert; beide TOC-Einträge
vorhanden; Beide Feldnamen unverändert (kein stilles Umbenennen); interne Links zeigen auf
die richtige Seite (Ziel-Links S1->S2, Quelle-Links S3->S4).
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


def _build_doc(path, tag, field_name):
    """2 Seiten (Text "<tag>1"/"<tag>2"), TOC 1 Eintrag auf Seite 1, Link S1->S2, 1 Textfeld."""
    d = fitz.open()
    d.new_page()
    d.new_page()
    # Seiten erst NACH der Struktur-Aenderung neu holen (neue Handles -> kein veralteter Parent).
    p1 = d[0]
    p2 = d[1]
    p1.insert_text((72, 72), "%s1" % tag, fontsize=40)
    p2.insert_text((72, 72), "%s2" % tag, fontsize=40)
    # TOC (1-basierte Seitenzahl, wie fitz sie erwartet)
    d.set_toc([[1, "%s-Kapitel" % tag, 1]])
    # interner Link S1 -> S2 (fitz: 'page' 0-basiert)
    d[0].insert_link({"kind": fitz.LINK_GOTO, "from": fitz.Rect(60, 40, 140, 60), "page": 1, "to": fitz.Point(0, 0), "zoom": 0})
    # ein Textformularfeld
    w = fitz.Widget()
    w.field_name = field_name
    w.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    w.rect = fitz.Rect(72, 200, 200, 224)
    d[0].add_widget(w)
    d.save(str(path))
    d.close()


def _labels(path):
    d = fitz.open(str(path))
    try:
        return [d.load_page(i).get_text().strip() for i in range(d.page_count)]
    finally:
        d.close()


def _field_names(path):
    pdf = pikepdf.open(str(path))
    try:
        acro = pdf.Root.get("/AcroForm")
        if acro is None:
            return set()
        names = set()
        fields = list(acro.get("/Fields", []))
        for f in fields:
            t = f.get("/T")
            if t is not None:
                names.add(str(t))
        return names
    finally:
        pdf.close()


def _toc_titles(path):
    d = fitz.open(str(path))
    try:
        return [(lvl, title, pg) for (lvl, title, pg) in d.get_toc()]
    finally:
        d.close()


def _links(path):
    """Alle internen GOTO-Links als (quellseite_0basiert, zielseite_0basiert)."""
    d = fitz.open(str(path))
    try:
        out = []
        for i in range(d.page_count):
            for ln in d.load_page(i).get_links():
                if ln.get("kind") == fitz.LINK_GOTO and ln.get("page", -1) >= 0:
                    out.append((i, ln["page"]))
        return out
    finally:
        d.close()


def test_merge_appends_pages_target_unchanged_source_on_disk(client, tmp_path):
    target = tmp_path / "target.pdf"; _build_doc(target, "Z", "ziel_field")
    source = tmp_path / "source.pdf"; _build_doc(source, "Q", "quelle_field")
    out = tmp_path / "merged.pdf"

    op = client.post("/document/open", json={"path": str(target)}, headers=HDRS)
    assert op.status_code == 200, op.text
    m = client.post("/pages/merge", json={"path": str(source)}, headers=HDRS)
    assert m.status_code == 200, m.text
    body = m.json()
    assert body["pageCount"] == 4, body
    assert body["added"] == 2, body

    sv = client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS)
    assert sv.status_code == 200, sv.text
    assert out.exists()

    # --- ZWEITE Bibliothek: Seiteanzahl + Struktur via pikepdf (unabhaengig von fitz) ---
    pdf = pikepdf.open(str(out))
    try:
        assert len(pdf.pages) == 4
        # Gliederung vorhanden (/Outlines mit Eintraegen)
        assert pdf.Root.get("/Outlines") is not None
        assert pdf.Root.Outlines.get("/First") is not None, "Outline hat keine Eintraege"
    finally:
        pdf.close()

    # --- erneut oeffnen (PyMuPDF auf der Datei, NICHT dem Mutations-Doc): Text + Reihenfolge ---
    assert _labels(out) == ["Z1", "Z2", "Q1", "Q2"]


def test_merge_keeps_both_outlines(client, tmp_path):
    target = tmp_path / "target.pdf"; _build_doc(target, "Z", "ziel_field")
    source = tmp_path / "source.pdf"; _build_doc(source, "Q", "quelle_field")
    out = tmp_path / "merged.pdf"
    client.post("/document/open", json={"path": str(target)}, headers=HDRS)
    assert client.post("/pages/merge", json={"path": str(source)}, headers=HDRS).status_code == 200
    client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS)

    toc = _toc_titles(out)
    titles = {t for (_l, t, _p) in toc}
    assert "Z-Kapitel" in titles, toc
    assert "Q-Kapitel" in titles, toc
    # Der Quellen-Eintrag muss auf die Seite zeigen, auf der jetzt "Q1" steht (Seite 3, 1-basiert).
    qpages = [p for (_l, t, p) in toc if t == "Q-Kapitel"]
    assert qpages == [3], "Quellen-Outline zeigt auf falsche Seite: %r" % (toc,)


def test_merge_keeps_form_field_names_no_rename(client, tmp_path):
    target = tmp_path / "target.pdf"; _build_doc(target, "Z", "ziel_field")
    source = tmp_path / "source.pdf"; _build_doc(source, "Q", "quelle_field")
    out = tmp_path / "merged.pdf"
    client.post("/document/open", json={"path": str(target)}, headers=HDRS)
    assert client.post("/pages/merge", json={"path": str(source)}, headers=HDRS).status_code == 200
    client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS)

    names = _field_names(out)
    assert "ziel_field" in names, names
    assert "quelle_field" in names, names


def test_merge_internal_links_resolve_to_correct_pages(client, tmp_path):
    target = tmp_path / "target.pdf"; _build_doc(target, "Z", "ziel_field")
    source = tmp_path / "source.pdf"; _build_doc(source, "Q", "quelle_field")
    out = tmp_path / "merged.pdf"
    client.post("/document/open", json={"path": str(target)}, headers=HDRS)
    assert client.post("/pages/merge", json={"path": str(source)}, headers=HDRS).status_code == 200
    client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS)

    links = _links(out)
    # Ziel S1->S2 (0-basiert: 0->1) und Quelle S3->S4 (2->3)
    assert (0, 1) in links, links
    assert (2, 3) in links, links
