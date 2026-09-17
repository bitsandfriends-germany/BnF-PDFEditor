"""Tests Section 7a: Bildstempel (Deckkraft/Underlay), Textstempel (Platzhalter), Seitenzahlen.

Run:
    cd "/home/iambarth/Documents/Projects/B&F PDF Editor" \
      && backend/.venv/bin/python -m pytest backend/tests/test_stamps.py -q
"""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

os.environ["PDF_EDITOR_BACKEND_TOKEN"] = "test-token-xyz"

import base64

import pytest
import pymupdf as fitz
from fastapi.testclient import TestClient

from backend import main, stamp_ops

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


def make_blank_pdf(path, n=3, w=300, h=300):
    d = fitz.open()
    for _ in range(n):
        d.new_page(width=w, height=h)
    d.save(str(path)); d.close()


def opaque_png(color=(255, 0, 0), size=(60, 40)):
    pm = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, *size))
    pm.set_rect(pm.irect, color)
    return pm.tobytes("png")


def soft_alpha_png(size=(40, 40)):
    pm = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, *size))
    pm.set_rect(pm.irect, (0, 0, 255))
    pm = fitz.Pixmap(pm, 1)
    pm.set_rect(fitz.IRect(size[0] // 2, 0, size[0], size[1]), (0, 0, 255, 0))  # rechte Haelfte transparent
    return pm.tobytes("png")


# --------------------------------------------------------------------- Bildstempel
def test_image_stamp_applies_to_selection(tmp_path):
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 3)
    res = stamp_ops.stamp_image_selection(str(p), "1,3", {"x": 10, "y": 10, "width": 100, "height": 60}, opaque_png())
    assert res["applied"] == 2
    d = fitz.open(str(p))
    assert len(d.load_page(0).get_images(full=True)) == 1
    assert len(d.load_page(1).get_images(full=True)) == 0
    assert len(d.load_page(2).get_images(full=True)) == 1
    d.close()


def test_image_stamp_opacity_lightens(tmp_path):
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 1)
    # Deckkraft 0.5: roter Fleck ueber weiss aufgehellt
    stamp_ops.stamp_image_selection(str(p), "1", {"x": 20, "y": 20, "width": 160, "height": 80}, opaque_png(), opacity=0.5)
    d = fitz.open(str(p)); pm = d.load_page(0).get_pixmap(dpi=72)
    # fitz top-down: rect unten-links y20..100 -> im Bild y=H-100..H-20; mittig bei H=300 -> y~250
    px = pm.pixel(90, 250)
    assert px[0] > 200 and px[1] > 60 and px[2] > 60  # rot, aber aufgehellt (nicht satt 255,0,0)
    d.close()


def test_image_stamp_transparency_preserved_at_full_opacity(tmp_path):
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 1)
    stamp_ops.stamp_image_selection(str(p), "1", {"x": 20, "y": 130, "width": 160, "height": 160}, soft_alpha_png(), opacity=1.0)
    d = fitz.open(str(p)); pm = d.load_page(0).get_pixmap(dpi=72)
    # rechte (transparente) Bildhaelfte: weisser Hintergrund bleibt durch
    px_right = pm.pixel(150, 100)
    assert px_right[0] > 240 and px_right[1] > 240 and px_right[2] > 240
    d.close()


def test_image_stamp_bad_rect(tmp_path):
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 1)
    with pytest.raises(stamp_ops.StampError):
        stamp_ops.stamp_image_selection(str(p), "1", {"x": 0, "y": 0, "width": 0, "height": 10}, opaque_png())


# --------------------------------------------------------------------- Textstempel
def test_text_stamp_with_placeholders(tmp_path):
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 3)
    res = stamp_ops.stamp_text(str(p), "all", 40, 250, "Seite {page}/{pages}", filename="bericht")
    assert res["applied"] == 3
    d = fitz.open(str(p))
    assert "Seite 1/3" in d.load_page(0).get_text()
    assert "Seite 3/3" in d.load_page(2).get_text()
    d.close()


def test_text_stamp_selection_only(tmp_path):
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 3)
    stamp_ops.stamp_text(str(p), "2", 40, 250, "MARK")
    d = fitz.open(str(p))
    assert "MARK" not in d.load_page(0).get_text()
    assert "MARK" in d.load_page(1).get_text()
    d.close()


def test_text_stamp_bad_color(tmp_path):
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 1)
    with pytest.raises(stamp_ops.StampError):
        stamp_ops.stamp_text(str(p), "1", 40, 250, "x", color="#gg0000")


# --------------------------------------------------------------------- Seitenzahlen
def test_page_numbers_start_offset(tmp_path):
    # 'Seite 3 = 1': expr 3-5, start=1 -> erste ausgewaehlte (Seite 3) bekommt 1
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 5)
    stamp_ops.add_page_numbers(str(p), "3-5", position="bottom-center", format_str="Seite {n} von {total}", start=1)
    d = fitz.open(str(p))
    assert "Seite 1 von 5" in d.load_page(2).get_text()
    assert "Seite 3 von 5" in d.load_page(4).get_text()
    assert "Seite" not in d.load_page(0).get_text()  # Seiten 1,2 unbearbeitet
    d.close()


def test_page_numbers_bad_position(tmp_path):
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 2)
    with pytest.raises(stamp_ops.StampError):
        stamp_ops.add_page_numbers(str(p), "1", position="middle")


# --------------------------------------------------------------------- Route + Undo
def test_route_pagenumbers_then_undo(client, tmp_path):
    src = tmp_path / "in.pdf"; make_blank_pdf(src, 3)
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/stamps/page-numbers", json={"expr": "all", "position": "bottom-center", "format": "{n}"}, headers=HDRS)
    assert r.status_code == 200 and r.json()["applied"] == 3
    client.post("/document/undo", headers=HDRS)
    data = client.get("/document/file", headers=HDRS).content
    d = fitz.open(stream=data, filetype="pdf")
    assert d.load_page(0).get_text().strip() == ""  # Undo entfernt die Zahlen wieder
    d.close()


def test_route_text_stamp_placeholder_filename(client, tmp_path):
    src = tmp_path / "Vertrag.pdf"; make_blank_pdf(src, 2)
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/stamps/text", json={"expr": "1", "x": 40, "y": 250, "text": "Datei:{filename}"}, headers=HDRS)
    assert r.status_code == 200
    data = client.get("/document/file", headers=HDRS).content
    d = fitz.open(stream=data, filetype="pdf")
    assert "Datei:Vertrag" in d.load_page(0).get_text()
    d.close()


def test_route_image_stamp(client, tmp_path):
    src = tmp_path / "in.pdf"; make_blank_pdf(src, 2)
    b64 = base64.b64encode(opaque_png()).decode()
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/stamps/image", json={"expr": "2", "x": 10, "y": 10, "width": 100, "height": 60, "image": b64}, headers=HDRS)
    assert r.status_code == 200 and r.json()["applied"] == 1


# --------------------------------------------------------------- Wasserzeichen (Section 7b)
def make_pdf_with_images(path, pages=2, per_page=2):
    d = fitz.open()
    for pg in range(pages):
        p = d.new_page(width=300, height=300)
        for i in range(per_page):
            pm = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40 + 10 * i, 24))
            pm.set_rect(pm.irect, (i * 40 % 255, 60, 120))
            p.insert_image(fitz.Rect(10, 10 + i * 60, 90, 90 + i * 60), pixmap=pm)
    d.save(str(path)); d.close()


def test_watermark_text_behind_and_present(tmp_path):
    # winkel 0: PyMuPDF extrahiert unrotierten Text sauber (Rotation wird nicht ueber
    # Textextraktion geprueft, da gedrehter Text beim Extrahieren zerlegt werden kann).
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 3)
    res = stamp_ops.add_watermark_text(str(p), "all", "VERTRAULICH", angle=0, opacity=0.2, fontsize=24)
    assert res["applied"] == 3 and res["overlay"] is False
    d = fitz.open(str(p))
    assert "VERTRAULICH" in d.load_page(0).get_text()
    d.close()


def test_watermark_text_tiled_multiple(tmp_path):
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 1)
    stamp_ops.add_watermark_text(str(p), "1", "WATER", tiled=True, fontsize=20)
    d = fitz.open(str(p))
    assert d.load_page(0).get_text().count("WATER") > 3  # Raster -> mehrfach
    d.close()


def test_watermark_selection_only(tmp_path):
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 3)
    stamp_ops.add_watermark_text(str(p), "2", "NUR2")
    d = fitz.open(str(p))
    assert "NUR2" not in d.load_page(0).get_text()
    assert "NUR2" in d.load_page(1).get_text()
    d.close()


def test_watermark_image_and_bad_kind(tmp_path):
    p = tmp_path / "d.pdf"; make_blank_pdf(p, 2)
    res = stamp_ops.add_watermark_image(str(p), "all", {"x": 0, "y": 0, "width": 120, "height": 60}, opaque_png(), opacity=0.3)
    assert res["applied"] == 2
    d = fitz.open(str(p)); assert len(d.load_page(0).get_images(full=True)) >= 1; d.close()


# --------------------------------------------------------------- Bilder extrahieren (Section 7b)
def test_list_images_reports_resolutions(tmp_path):
    p = tmp_path / "d.pdf"; make_pdf_with_images(p, pages=2, per_page=2)
    res = stamp_ops.list_images(str(p), "all")
    assert res["count"] == 4
    dims = {(im["width"], im["height"]) for im in res["images"]}
    assert (40, 24) in dims and (50, 24) in dims  # echte Aufloesungen


def test_extract_images_source_unchanged_and_suffix(tmp_path):
    p = tmp_path / "d.pdf"; make_pdf_with_images(p, pages=1, per_page=2)
    out = tmp_path / "out"; out.mkdir()
    r1 = stamp_ops.extract_images(str(p), "all", str(out), "img")
    assert r1["count"] == 2
    assert all(os.path.isfile(c["path"]) for c in r1["create" + "d"])
    # Quelle unveraendert
    assert stamp_ops.list_images(str(p), "all")["count"] == 2
    # erneut -> Suffix statt Ueberschreiben
    r2 = stamp_ops.extract_images(str(p), "all", str(out), "img")
    names = sorted(os.path.basename(c["path"]) for c in r2["created"])
    assert any("_1." in nm for nm in names)


# --------------------------------------------------------------- Route + Undo
def test_route_watermark_then_undo(client, tmp_path):
    src = tmp_path / "in.pdf"; make_blank_pdf(src, 2)
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/stamps/watermark", json={"kind": "text", "expr": "all", "text": "KONF", "angle": 45}, headers=HDRS)
    assert r.status_code == 200 and r.json()["applied"] == 2
    client.post("/document/undo", headers=HDRS)
    data = client.get("/document/file", headers=HDRS).content
    d = fitz.open(stream=data, filetype="pdf")
    assert "KONF" not in d.load_page(0).get_text()
    d.close()


def test_route_watermark_bad_kind(client, tmp_path):
    src = tmp_path / "in.pdf"; make_blank_pdf(src, 1)
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/stamps/watermark", json={"kind": "weird", "expr": "1"}, headers=HDRS)
    assert r.status_code == 422


def test_route_extract_images(client, tmp_path):
    src = tmp_path / "in.pdf"; make_pdf_with_images(src, pages=1, per_page=2)
    out = tmp_path / "out"; out.mkdir()
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    lst = client.get("/document/images", params={"expr": "all"}, headers=HDRS)
    assert lst.status_code == 200 and lst.json()["count"] == 2
    ex = client.post("/document/extract-images", json={"expr": "all", "destDir": str(out)}, headers=HDRS)
    assert ex.status_code == 200 and ex.json()["count"] == 2
