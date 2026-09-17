"""Tests Section 12: Export Bilder/Text, Bilder->PDF, Komprimieren.

Run:
    cd "/home/iambarth/Documents/Projects/B&F PDF Editor" \
      && backend/.venv/bin/python -m pytest backend/tests/test_export.py -q
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

from backend import export_ops, main

HDRS = {"X-Auth-Token": "test-token-xyz"}


@pytest.fixture
def client(tmp_path):
    for sub in ("run", "snap"):
        (tmp_path / sub).mkdir()
    os.environ["PDF_EDITOR_SESSION_DIR"] = str(tmp_path / "run")
    os.environ["PDF_EDITOR_SNAPSHOT_DIR"] = str(tmp_path / "snap")
    os.environ["PDF_EDITOR_UNDO_TO_DISK"] = "1"
    with TestClient(main.app) as c:
        yield c


def make_pdf(path, n=2):
    d = fitz.open()
    for i in range(n):
        p = d.new_page(width=300, height=300)
        p.insert_text((40, 60), f"SEITENTEXT {i + 1}", fontsize=22)
    d.save(str(path)); d.close()


def png(path, w=200, h=100, color=(20, 120, 200)):
    pm = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, w, h)); pm.set_rect(pm.irect, color)
    with open(path, "wb") as fh:
        fh.write(pm.tobytes("png"))


# ---------------------------------------------------------------- export_images
def test_export_images_png_and_dpi(tmp_path):
    p = tmp_path / "d.pdf"; make_pdf(p, 2)
    out = tmp_path / "out"; out.mkdir()
    r = export_ops.export_images(str(p), "all", str(out), "png", 150, "pg")
    assert r["count"] == 2
    assert all(c["path"].endswith(".png") for c in r["created"])
    # 150 dpi auf 300pt Seite = 625px
    assert r["created"][0]["width"] == 625


def test_export_images_jpeg_and_bad_params(tmp_path):
    p = tmp_path / "d.pdf"; make_pdf(p, 1)
    out = tmp_path / "out"; out.mkdir()
    r = export_ops.export_images(str(p), "1", str(out), "jpeg", 72)
    assert r["created"][0]["path"].endswith(".jpg")
    with pytest.raises(export_ops.ExportError):
        export_ops.export_images(str(p), "1", str(out), "tiff", 150)
    with pytest.raises(export_ops.ExportError):
        export_ops.export_images(str(p), "1", str(out), "png", 111)


# ---------------------------------------------------------------- text export
def test_document_text_and_markdown(tmp_path):
    p = tmp_path / "d.pdf"; make_pdf(p, 2)
    txt = export_ops.document_text(str(p), "all", "txt")
    assert "SEITENTEXT 1" in txt and "SEITENTEXT 2" in txt
    md = export_ops.document_text(str(p), "all", "md")
    assert "## Seite 1" in md
    # Bereich nur Seite 1
    one = export_ops.document_text(str(p), "1", "txt")
    assert "SEITENTEXT 1" in one and "SEITENTEXT 2" not in one


def test_export_text_writes_file(tmp_path):
    p = tmp_path / "d.pdf"; make_pdf(p, 1)
    out = tmp_path / "out"; out.mkdir()
    r = export_ops.export_text(str(p), "all", str(out), "txt", "doc")
    assert os.path.isfile(r["path"]) and r["path"].endswith(".txt")
    assert "SEITENTEXT 1" in open(r["path"], encoding="utf-8").read()


# ---------------------------------------------------------------- images -> pdf
def test_images_to_pdf_auto_and_fixed(tmp_path):
    a = tmp_path / "a.png"; png(a, 200, 100)
    b = tmp_path / "b.png"; png(b, 120, 120)
    out = tmp_path / "out"; out.mkdir()
    r = export_ops.images_to_pdf([str(a), str(b)], str(out), "auto", "auto")
    d = fitz.open(r["path"])
    assert d.page_count == 2
    assert (round(d.load_page(0).rect.width), round(d.load_page(0).rect.height)) == (200, 100)
    d.close()
    r2 = export_ops.images_to_pdf([str(a)], str(out), "a4", "auto")
    d = fitz.open(r2["path"])
    assert round(d.load_page(0).rect.width) == 595  # A4 Hochformat
    d.close()


def test_images_to_pdf_missing(tmp_path):
    out = tmp_path / "out"; out.mkdir()
    with pytest.raises(export_ops.ExportError):
        export_ops.images_to_pdf(["/nope/x.png"], str(out))


# ---------------------------------------------------------------- compress
def test_compress_smaller_original_untouched(tmp_path):
    p = tmp_path / "d.pdf"
    d = fitz.open(); pg = d.new_page(width=300, height=300)
    big = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 1400, 1000)); big.set_rect(big.irect, (30, 90, 160))
    pg.insert_image(fitz.Rect(0, 0, 300, 300), pixmap=big)
    d.save(str(p)); d.close()
    before = p.read_bytes()
    out = tmp_path / "out"; out.mkdir()
    r = export_ops.compress(str(p), str(out), target_dpi=72, jpeg_quality=40)
    assert r["smaller"] is True and r["afterBytes"] < r["beforeBytes"]
    assert r["savedPercent"] > 0 and os.path.isfile(r["path"])
    assert p.read_bytes() == before  # Original unveraendert


# ---------------------------------------------------------------- Routen
def test_route_export_images_and_compress(client, tmp_path):
    src = tmp_path / "in.pdf"; make_pdf(src, 2)
    out = tmp_path / "out"; out.mkdir()
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    img = client.post("/export/images", json={"expr": "all", "destDir": str(out), "dpi": 72}, headers=HDRS)
    assert img.status_code == 200 and img.json()["count"] == 2
    prev = client.get("/export/text-preview", params={"expr": "1"}, headers=HDRS)
    assert prev.status_code == 200 and "SEITENTEXT 1" in prev.json()["text"]
    comp = client.post("/export/compress", json={"destDir": str(out), "targetDpi": 72, "jpegQuality": 50}, headers=HDRS)
    assert comp.status_code == 200 and os.path.isfile(comp.json()["path"])


def test_linearise_unit_and_route(client, tmp_path):
    """§12: pikepdf linearize=True erzeugt ein lineares PDF; neue Datei, Original unberuehrt."""
    import pikepdf
    src = tmp_path / "d.pdf"
    out = tmp_path / "o"
    out.mkdir()
    make_pdf(src, n=3)
    # Route
    assert client.post("/document/open", json={"path": str(src)}, headers=HDRS).status_code == 200
    r = client.post("/export/linearise", json={"destDir": str(out)}, headers=HDRS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["linearized"] is True
    assert "beforeBytes" in body and "afterBytes" in body
    produced = [f for f in out.iterdir() if f.suffix == ".pdf"]
    assert produced, "keine lineare Datei erzeugt"
    with pikepdf.open(str(produced[0])) as chk:
        assert chk.is_linearized
    # Original unveraendert (nicht linearisiert)
    with pikepdf.open(str(src)) as o:
        assert not o.is_linearized
    # §2.6 kein ueberschreiben: zweiter Lauf erzeugt _1
    r2 = client.post("/export/linearise", json={"destDir": str(out)}, headers=HDRS)
    assert r2.status_code == 200
    assert len([f for f in out.iterdir() if f.suffix == ".pdf"]) == 2


def test_linearise_refuses_encrypted(client, tmp_path):
    """Section 2.7: Linearisieren + Verschluesselung unvereinbar -> Vorher-Ablehnung (422)."""
    src = tmp_path / "d.pdf"
    out = tmp_path / "o"
    out.mkdir()
    make_pdf(src, n=2)
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    assert client.post("/document/encrypt", json={"password": "pw"}, headers=HDRS).status_code == 200
    r = client.post("/export/linearise", json={"destDir": str(out)}, headers=HDRS)
    assert r.status_code == 422, r.text
    assert "verschluessel" in r.json()["message"].lower() or "verschluessel" in r.text.lower()
    assert not [f for f in out.iterdir() if f.suffix == ".pdf"]  # nichts geschrieben


def test_route_images_to_pdf(client, tmp_path):
    out = tmp_path / "out"; out.mkdir()
    a = tmp_path / "a.png"; png(a, 200, 100)
    # keine offene Datei noetig
    r = client.post("/export/images-to-pdf", json={"paths": [str(a)], "destDir": str(out)}, headers=HDRS)
    assert r.status_code == 200 and r.json()["pages"] == 1
