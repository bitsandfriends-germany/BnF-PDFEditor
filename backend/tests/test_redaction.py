"""Tests Section 10a: echte zweistufige Roteierung + Verifikation + Irreversibilitaet.

Run:
    cd "/home/iambarth/Documents/Projects/B&F PDF Editor" \
      && backend/.venv/bin/python -m pytest backend/tests/test_redaction.py -q
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

from backend import main, redact_ops

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


def make_secret_pdf(path):
    """Seite 300x300; 'TOPSECRET 4242' oben (fitz y~80), 'PUBLIC' unten (fitz y~200)."""
    d = fitz.open(); p = d.new_page(width=300, height=300)
    p.insert_text((50, 80), "TOPSECRET 4242", fontsize=20)
    p.insert_text((50, 200), "PUBLIC", fontsize=20)
    d.save(str(path)); d.close()


# PDF-unten-links Region, die die obere Zeile (fitz y~66..84) abdeckt:
SECRET_REGION = {"page": 1, "x": 40, "y": 214, "width": 240, "height": 20}


def test_apply_removes_text_and_verifies(tmp_path):
    p = tmp_path / "d.pdf"; make_secret_pdf(p)
    res = redact_ops.apply_redaction(str(p), [SECRET_REGION])
    assert res["appliedPages"] == [1]
    assert res["verified"] is True
    assert set(res["removed"]) >= {"TOPSECRET", "4242"}
    assert res["remaining"] == []
    d = fitz.open(str(p)); txt = d.load_page(0).get_text()
    assert "TOPSECRET" not in txt and "4242" not in txt
    assert "PUBLIC" in txt  # ausserhalb der Region bleibt erhalten
    d.close()


def test_apply_leaves_black_box_not_live_text(tmp_path):
    p = tmp_path / "d.pdf"; make_secret_pdf(p)
    redact_ops.apply_redaction(str(p), [SECRET_REGION])
    # Zeichnungs-Check: Roteierungsbox existiert, aber kein extrahierbarer Text mehr dort
    d = fitz.open(str(p)); p0 = d.load_page(0)
    assert p0.get_text().strip() == "PUBLIC"
    drawings = p0.get_drawings()
    assert any(dr.get("fill") == (0.0, 0.0, 0.0) for dr in drawings)  # schwarze Box gezeichnet
    d.close()


def test_image_mode_remove_vs_pixels(tmp_path):
    # Bild passt NICHT ganz in die Region: linker Teil wird ueberdeckt, rechter bleibt.
    # 'pixels' schwaerzt nur den ueberdeckten Teil (Bild bleibt, rechts blau);
    # 'remove' entfernt das ganze Bildobjekt.
    def with_img(p):
        d = fitz.open(); pg = d.new_page(width=300, height=300)
        pm = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 100, 60)); pm.set_rect(pm.irect, (0, 0, 255))
        pg.insert_image(fitz.Rect(10, 10, 120, 70), pixmap=pm)
        d.save(str(p)); d.close()
    # Region deckt nur fitz x~5..65 (linke Haelfte), Bild reicht bis x=120.
    reg = {"page": 1, "x": 5, "y": 230, "width": 60, "height": 60}
    p1 = tmp_path / "rm.pdf"; with_img(p1)
    redact_ops.apply_redaction(str(p1), [reg], images="remove")
    d = fitz.open(str(p1)); assert len(d.load_page(0).get_images(full=True)) == 0; d.close()
    p2 = tmp_path / "px.pdf"; with_img(p2)
    redact_ops.apply_redaction(str(p2), [reg], images="pixels")
    d = fitz.open(str(p2))
    assert len(d.load_page(0).get_images(full=True)) >= 1  # Bild bleibt (rechts sichtbar)
    px = d.load_page(0).get_pixmap(dpi=72).pixel(95, 40)   # rechter, ueberdeckter Teil -> blau
    assert px[2] > 150 and px[0] < 120
    d.close()


def test_preview_does_not_mutate(tmp_path):
    p = tmp_path / "d.pdf"; make_secret_pdf(p)
    pv = redact_ops.preview_redaction(str(p), [SECRET_REGION])
    assert any("TOPSECRET" in item["strings"] for item in pv["willRedact"])
    # unveraendert: Text noch da
    d = fitz.open(str(p)); assert "TOPSECRET" in d.load_page(0).get_text(); d.close()


def test_bad_region_page(tmp_path):
    p = tmp_path / "d.pdf"; make_secret_pdf(p)
    with pytest.raises(Exception):
        redact_ops.apply_redaction(str(p), [{"page": 9, "x": 0, "y": 0, "width": 10, "height": 10}])


# --------------------------------------------------------------- Route + Irreversibilitaet
def test_route_preview_then_apply_clears_undo(client, tmp_path):
    src = tmp_path / "in.pdf"; make_secret_pdf(src)
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    # erst ein undo-faehiger Schritt -> canUndo True
    client.post("/stamps/page-numbers", json={"expr": "1", "position": "bottom-center", "format": "{n}"}, headers=HDRS)
    assert client.get("/document/state", headers=HDRS).json()["canUndo"] is True
    # Preview
    pv = client.post("/redaction/preview", json={"regions": [SECRET_REGION]}, headers=HDRS)
    assert pv.status_code == 200
    # Apply
    ap = client.post("/redaction/apply", json={"regions": [SECRET_REGION]}, headers=HDRS)
    assert ap.status_code == 200 and ap.json()["verified"] is True
    # Undo-Stack ist geleert (irreversibel) -> canUndo False
    assert client.get("/document/state", headers=HDRS).json()["canUndo"] is False
    data = client.get("/document/file", headers=HDRS).content
    d = fitz.open(stream=data, filetype="pdf")
    txt = d.load_page(0).get_text()
    assert "TOPSECRET" not in txt and "PUBLIC" in txt
    d.close()


def test_route_apply_bad_page(client, tmp_path):
    src = tmp_path / "in.pdf"; make_secret_pdf(src)
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/redaction/apply", json={"regions": [{"page": 99, "x": 0, "y": 0, "width": 10, "height": 10}]}, headers=HDRS)
    assert r.status_code == 422
