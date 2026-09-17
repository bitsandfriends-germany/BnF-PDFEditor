"""PART 3 §3 — VERIFIKATION Stempel/Wasserzeichen/Seitenzahlen/Flatten (echter Pfad).

Cross-Library wo möglich: Bild-Stempel und Flatten werden mit PIKEPDF (Zweitbibliothek) geprüft
(Bild-XObject je Seite bzw. /Annots entfernt). Textbasierte Ausgaben (Textstempel/Wasserzeichen/
Seitenzahlen) haben kein unabhängiges Struktur-Objekt -> geprüft durch erneutes Öffnen der
GESPEICHERTEN Datei (PyMuPDF, nicht der In-Memory-Mutations-Doc) + Bereichs-Invariante
(präsent im Bereich, abwesend außerhalb).
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


def make_blank(path, n=3, w=300, h=300):
    d = fitz.open()
    for _ in range(n):
        d.new_page(width=w, height=h)
    d.save(str(path)); d.close()


def make_with_annots(path, n=2):
    d = fitz.open()
    for _ in range(n):
        p = d.new_page(width=300, height=300)
        p.add_text_annot((50, 50), "notiz")
    d.save(str(path)); d.close()


def opaque_png(size=(60, 40)):
    pm = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, *size))
    pm.set_rect(pm.irect, (255, 0, 0))
    return pm.tobytes("png")


def page_text(path, i):
    d = fitz.open(str(path))
    try:
        return d.load_page(i).get_text()
    finally:
        d.close()


def image_drawn_pages(path):
    """Zweitbibliothek (pikepdf): Seiten, die ein /Image-XObject im CONTENT-STREAM per Do zeichnen.
    (Der /document/save erbt Resourcen auf alle Seiten -> reine Ressourcen-Zählung wäre ein
    Fehlsignal; der Do-Operator im Stream ist der wahre je-Seiten-Nachweis.)"""
    pdf = pikepdf.open(str(path))
    try:
        drawn = []
        for i, pg in enumerate(pdf.pages):
            names = set()
            res = pg.get("/Resources")
            if res is not None:
                xo = res.get("/XObject")
                if xo is not None:
                    for key in xo.keys():
                        o = xo[key]
                        if o.get("/Subtype") is not None and str(o.get("/Subtype")) == "/Image":
                            names.add(str(key))
            if not names:
                continue
            for operands, op in pikepdf.parse_content_stream(pg):
                if str(op) == "Do" and operands and str(operands[0]) in names:
                    drawn.append(i + 1)
                    break
        return drawn
    finally:
        pdf.close()


def annots_per_page(path):
    pdf = pikepdf.open(str(path))
    try:
        out = []
        for pg in pdf.pages:
            a = pg.get("/Annots")
            out.append(0 if a is None else len(a))
        return out
    finally:
        pdf.close()


# ---------------------------------------------------------------- Bild-Stempel (§3: genau gewählte Seiten, Größe ±1 pt)
def test_image_stamp_second_lib_exact_pages_and_size(client, tmp_path):
    src = tmp_path / "in.pdf"; make_blank(src, 3)
    out = tmp_path / "out.pdf"
    b64 = base64.b64encode(opaque_png()).decode()
    assert client.post("/document/open", json={"path": str(src)}, headers=HDRS).status_code == 200
    r = client.post("/stamps/image", json={"expr": "2", "x": 10, "y": 10, "width": 100, "height": 60, "image": b64, "keepProportion": False}, headers=HDRS)
    assert r.status_code == 200 and r.json()["applied"] == 1
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200

    assert image_drawn_pages(out) == [2]  # pikepdf: NUR Seite 2 zeichnet das Bild (Zweitbibliothek)
    d = fitz.open(str(out))
    rects = d.load_page(1).get_image_rects(d.load_page(1).get_images(full=True)[0][0])
    d.close()
    assert rects, "kein Bild-Rechteck gefunden"
    rc = rects[0]
    assert abs((rc.x1 - rc.x0) - 100) <= 1 and abs((rc.y1 - rc.y0) - 60) <= 1  # Größe ±1 pt


# ---------------------------------------------------------------- Flatten (§3: Annotationen entfernt, Inhalt bleibt)
def test_flatten_removes_annots_second_lib(client, tmp_path):
    src = tmp_path / "in.pdf"; make_with_annots(src, 2)
    out = tmp_path / "out.pdf"
    assert client.post("/document/open", json={"path": str(src)}, headers=HDRS).status_code == 200
    # Vorher existieren Annotationen (auf der Arbeitskopie = Save des Opens).
    assert client.post("/document/save", json={"path": str(src) + ".pre", "rebind": False}, headers=HDRS).status_code == 200
    assert sum(annots_per_page(str(src) + ".pre")) >= 2
    r = client.post("/document/flatten", json={"categories": ["annotations"]}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200

    assert sum(annots_per_page(out)) == 0  # pikepdf: keine /Annots mehr (Zweitbibliothek)
    assert len(list(pikepdf.open(str(out)).pages)) == 2  # Invariante: Seitenzahl gleich


# ---------------------------------------------------------------- Textstempel (§3: nur gewählte Seiten)
def test_text_stamp_present_in_range_absent_outside(client, tmp_path):
    src = tmp_path / "in.pdf"; make_blank(src, 3)
    out = tmp_path / "out.pdf"
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/stamps/text", json={"expr": "2", "x": 40, "y": 200, "text": "STRENG"}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200
    assert "STRENG" in page_text(out, 1)
    assert "STRENG" not in page_text(out, 0) and "STRENG" not in page_text(out, 2)  # außerhalb abwesend


# ---------------------------------------------------------------- Wasserzeichen (§3: Bereich, winkel 0 -> extrahierbar)
def test_watermark_present_in_range_absent_outside(client, tmp_path):
    src = tmp_path / "in.pdf"; make_blank(src, 3)
    out = tmp_path / "out.pdf"
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/stamps/watermark", json={"kind": "text", "expr": "1,3", "text": "KONF", "angle": 0, "opacity": 0.2, "fontsize": 24}, headers=HDRS)
    assert r.status_code == 200 and r.json()["applied"] == 2, r.text
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200
    assert "KONF" in page_text(out, 0) and "KONF" in page_text(out, 2)
    assert "KONF" not in page_text(out, 1)  # Seite 2 war nicht im Bereich


# ---------------------------------------------------------------- Seitenzahlen (§3: Bereich, Startwert)
def test_page_numbers_present_in_range_absent_outside(client, tmp_path):
    src = tmp_path / "in.pdf"; make_blank(src, 3)
    out = tmp_path / "out.pdf"
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)
    r = client.post("/stamps/page-numbers", json={"expr": "1-2", "position": "bottom-center", "format": "SEITE-{n}", "start": 7}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200
    t0, t1, t2 = page_text(out, 0), page_text(out, 1), page_text(out, 2)
    assert "SEITE-7" in t0 and "SEITE-8" in t1  # Startwert 7, fortlaufend
    assert "SEITE-" not in t2                    # Seite 3 außerhalb -> keine Nummer


def test_svg_and_webp_images_are_normalized_into_pdf(client, tmp_path):
    """Nutzerbefund: SVG-Grafik -> 'unknown image file format'. Backend normalisiert jetzt
    vor dem Einfuegen. Beweis auf der Ausgabedatei mit zweiter Bibliothek (pikepdf)."""
    import struct
    import zlib

    import pikepdf

    src = tmp_path / "in.pdf"
    d = fitz.open()
    d.new_page()
    d.new_page()
    pg = d[1]
    pg.insert_text((72, 120), "SEITE2-MARK", fontsize=20)
    d.save(str(src))
    d.close()
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)

    svg = (b'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30">'
           b'<rect width="40" height="30" fill="#e33"/></svg>')
    import base64
    b64 = base64.b64encode(svg).decode()
    r = client.post("/stamps/image", json={
        "expr": "1", "x": 50, "y": 50, "width": 120, "height": 90, "image": b64}, headers=HDRS)
    assert r.status_code == 200, r.text

    # WEBP als zweites Web-Format (Pillow-Pfad): 1x1-WebP erzeugen.
    import io as _io
    from PIL import Image
    buf = _io.BytesIO()
    Image.new("RGB", (6, 6), (0, 128, 255)).save(buf, "WEBP")
    wb64 = base64.b64encode(buf.getvalue()).decode()
    r2 = client.post("/stamps/image", json={
        "expr": "1", "x": 10, "y": 10, "width": 40, "height": 40, "image": wb64}, headers=HDRS)
    assert r2.status_code == 200, r2.text

    out = tmp_path / "out.pdf"
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200

    with pikepdf.open(str(out)) as pdf:
        p1 = pdf.pages[0]
        xobjs = p1.get("/Resources", pikepdf.Dictionary()).get("/XObject", pikepdf.Dictionary())
        assert len(xobjs) >= 2                                   # SVG + WEBP sind eingebettet
        for name in xobjs.keys():
            img = xobjs[name]
            assert img.get("/Subtype") == "/Image"
            assert int(img.get("/Width", 0)) > 0 and int(img.get("/Height", 0)) > 0
        # Seite 2 darf keine Bilder bekommen haben und muss ihren Text tragen.
        p2 = pdf.pages[1]
        r2res = p2.get("/Resources", pikepdf.Dictionary()).get("/XObject", pikepdf.Dictionary())
        assert len(r2res) == 0
    chk = fitz.open(str(out))
    assert "SEITE2-MARK" in chk[1].get_text()
    assert len(chk[0].get_images(full=True)) >= 2
    chk.close()


def test_image_object_edit_move_scale_rotate_delete(client, tmp_path):
    """Objektbearbeitung nach Einbetten (Runde 51) ueber echte HTTP-Pfade; Gegenpruefung
    der Ausgabedatei mit pikepdf + Textunversehrtheit."""
    import base64
    import struct
    import zlib

    import pikepdf

    src = tmp_path / "in.pdf"
    d = fitz.open()
    p = d.new_page()
    p.insert_text((72, 700), "SEITENTEXT", fontsize=18)
    d.save(str(src))
    d.close()
    client.post("/document/open", json={"path": str(src)}, headers=HDRS)

    def png(w, h, col):
        raw = b"".join(b"\x00" + bytes(col) * w for _ in range(h))
        def ch(t, x):
            c = t + x
            return struct.pack(">I", len(x)) + c + struct.pack(">I", zlib.crc32(c))
        return b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b"")

    b64 = base64.b64encode(png(16, 16, (10, 160, 60))).decode()
    r = client.post("/stamps/image", json={"expr": "1", "x": 40, "y": 100, "width": 80, "height": 60, "image": b64}, headers=HDRS)
    assert r.status_code == 200, r.text

    objs = client.get("/document/image-objects", params={"expr": "1"}, headers=HDRS).json()["objects"]
    assert len(objs) == 1
    o = objs[0]
    assert abs(o["rect"]["x"] - 40) < 1 and abs(o["rect"]["y"] - 100) < 1
    assert o["rotation"] == 0

    # Verschieben + Skalieren.
    newr = {"x": 200, "y": 300, "width": 120, "height": 90}
    r = client.post("/images/object/update", json={"page": 1, "bbox": o["rect"], "rect": newr}, headers=HDRS)
    assert r.status_code == 200, r.text

    objs = client.get("/document/image-objects", params={"expr": "1"}, headers=HDRS).json()["objects"]
    assert len(objs) == 1
    n = objs[0]["rect"]
    assert abs(n["x"] - 200) < 1.5 and abs(n["y"] - 300) < 1.5 and abs(n["width"] - 120) < 1.5 and abs(n["height"] - 90) < 1.5

    # Drehen +90 (auf gleicher Stelle).
    # Drehung: Aufrufer tauscht w/h bei gleichem Mittelpunkt (Vertrag, s. image_ops).
    cx, cy = n["x"] + n["width"] / 2, n["y"] + n["height"] / 2
    rot_rect = {"x": cx - n["height"] / 2, "y": cy - n["width"] / 2, "width": n["height"], "height": n["width"]}
    r = client.post("/images/object/update", json={"page": 1, "bbox": n, "rect": rot_rect, "rotateDelta": 90}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert r.json()["rotation"] == 270  # atan2-Konvention: +90 visuell == Feld 270
    objs = client.get("/document/image-objects", params={"expr": "1"}, headers=HDRS).json()["objects"]
    assert objs[0]["rotation"] == r.json()["rotation"]
    t = objs[0]["rect"]
    assert abs(t["width"] - n["height"]) < 2 and abs(t["height"] - n["width"]) < 2
    assert abs((t["x"] + t["width"] / 2) - cx) < 2 and abs((t["y"] + t["height"] / 2) - cy) < 2

    out = tmp_path / "out.pdf"
    assert client.post("/document/save", json={"path": str(out), "rebind": False}, headers=HDRS).status_code == 200
    with pikepdf.open(str(out)) as pdf:
        xo = pdf.pages[0].get("/Resources", pikepdf.Dictionary()).get("/XObject", pikepdf.Dictionary())
        assert len(xo) == 1
    chk = fitz.open(str(out))
    assert "SEITENTEXT" in chk[0].get_text()
    ii = chk[0].get_image_info()
    assert len(ii) == 1
    import math
    tr = ii[0]["transform"]
    assert int(round(math.degrees(math.atan2(tr[1], tr[0])) / 90) * 90) % 360 == 270
    chk.close()

    # Loeschen: Instanz weg, Text bleibt.
    r = client.post("/images/object/delete", json={"page": 1, "bbox": objs[0]["rect"]}, headers=HDRS)
    assert r.status_code == 200, r.text
    objs = client.get("/document/image-objects", params={"expr": "all"}, headers=HDRS).json()["objects"]
    assert objs == []
    chk = fitz.open(client.post("/document/save", json={"path": str(tmp_path / "out2.pdf"), "rebind": False}, headers=HDRS) and str(tmp_path / "out2.pdf"))
    assert "SEITENTEXT" in chk[0].get_text()
    assert len(chk[0].get_image_info()) == 0
    chk.close()
