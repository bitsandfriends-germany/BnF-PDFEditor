"""PART 3 §3 — VERIFIKATION Umsortieren DURCH DEN ECHTEN PFAD (POST /pages/reorder).

Die bestehende test_core.py-Prüfung liest die NEUE REIHENFOLGE nie von der Platte. Dieser Test
schliesst die Lücke nach §3: echter Pfad, Speichern, Zweitbibliothek, und Prüfung was sich nicht
ändern darf.

Identitäts-Marker je Seite: UNTERSCHIEDLICHE BREITE (100/200/300) + Text "P1/P2/P3". Die Breite
liest pikepdf unabhängig über /MediaBox; der Text kommt aus erneutem fitz-Öffnen der Datei.
Reihenfolge [2,0,1] (0-basiert) muss ergeben: Breiten [300,100,200], Texte [P3,P1,P2].
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


def _build_widths(path, widths):
    d = fitz.open()
    for w in widths:
        d.new_page(width=w, height=100)
    for i, w in enumerate(widths):
        d[i].insert_text((20, 50), "P%d" % (i + 1), fontsize=24)
    d.save(str(path))
    d.close()


def _mediabox_widths(path):
    """Zweitbibliothek: Seitenbreiten über /MediaBox in Dokumentreihenfolge."""
    pdf = pikepdf.open(str(path))
    try:
        out = []
        for pg in pdf.pages:
            mb = pg.MediaBox
            out.append(round(float(mb[2]) - float(mb[0])))
        return out
    finally:
        pdf.close()


def _labels(path):
    d = fitz.open(str(path))
    try:
        return [d.load_page(i).get_text().strip() for i in range(d.page_count)]
    finally:
        d.close()


def test_reorder_changes_order_on_disk_verified_second_lib(client, tmp_path):
    src = tmp_path / "in.pdf"; _build_widths(src, [100, 200, 300])
    out = tmp_path / "out.pdf"

    assert client.post("/document/open", json={"path": str(src)}, headers=HDRS).status_code == 200
    r = client.post("/pages/reorder", json={"order": [2, 0, 1]}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert r.json()["pageCount"] == 3  # Invariante: Seitenzahl unverändert
    sv = client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS)
    assert sv.status_code == 200, sv.text
    assert out.exists()

    # ZWEITE Bibliothek (pikepdf): Reihenfolge der Breiten = neue Reihenfolge, keine Seite verloren.
    widths = _mediabox_widths(out)
    assert widths == [300, 100, 200], widths
    assert sorted(widths) == [100, 200, 300]  # alle drei Seiten vorhanden (keine dupliziert/verloren)

    # erneut öffen (fitz auf der Datei): Textmarker in neuer Reihenfolge.
    assert _labels(out) == ["P3", "P1", "P2"]


def test_reorder_roundtrip_restores_original(client, tmp_path):
    src = tmp_path / "in.pdf"; _build_widths(src, [100, 200, 300])
    out = tmp_path / "out.pdf"
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    # [2,0,1] dann die Umkehrung [1,2,0] muss Original [0,1,2] ergeben.
    client.post("/pages/reorder", json={"order": [2, 0, 1]}, headers=HDRS)
    client.post("/pages/reorder", json={"order": [1, 2, 0]}, headers=HDRS)
    client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS)
    assert _mediabox_widths(out) == [100, 200, 300]
    assert _labels(out) == ["P1", "P2", "P3"]
