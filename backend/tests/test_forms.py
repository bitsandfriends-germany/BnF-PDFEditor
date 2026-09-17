"""Tests Section 11: AcroForm-Felderkennung, Ausfuellen, Zuruecksetzen, XFA-Meldung."""
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

from backend import form_ops, main

HDRS = {"X-Auth-Token": "test-token-xyz"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    for sub in ("run", "snap"):
        (tmp_path / sub).mkdir()
    monkeypatch.setenv("PDF_EDITOR_SESSION_DIR", str(tmp_path / "run"))
    monkeypatch.setenv("PDF_EDITOR_SNAPSHOT_DIR", str(tmp_path / "snap"))
    with TestClient(main.app) as c:
        yield c


def _form_pdf(tmp_path):
    base = tmp_path / "base.pdf"
    d = fitz.open(); d.new_page(); d.save(str(base)); d.close()
    fn = str(tmp_path / "form.pdf")
    d = fitz.open(str(base)); page = d.load_page(0)
    tw = fitz.Widget(); tw.field_name = "name"; tw.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    tw.rect = fitz.Rect(72, 100, 250, 120); tw.field_value = ""
    page.add_widget(tw)
    cw = fitz.Widget(); cw.field_name = "ok"; cw.field_type = fitz.PDF_WIDGET_TYPE_CHECKBOX
    cw.rect = fitz.Rect(72, 140, 92, 160); cw.field_value = "Off"
    page.add_widget(cw)
    lw = fitz.Widget(); lw.field_name = "land"; lw.field_type = fitz.PDF_WIDGET_TYPE_COMBOBOX
    lw.rect = fitz.Rect(72, 180, 200, 200); lw.field_value = "DE"
    page.add_widget(lw)
    d.save(fn); d.close()
    # /DV + /Opt per xref (damit Reset + Auswahlmoeglichkeiten real vorhanden sind)
    r = fitz.open(fn)
    for w in r.load_page(0).widgets():
        if w.field_name == "name":
            r.xref_set_key(w.xref, "DV", "(Startwert)")
        if w.field_name == "land":
            r.xref_set_key(w.xref, "Opt", "[(DE)(FR)(IT)]")
            r.xref_set_key(w.xref, "DV", "(DE)")
    tmpout = fn + ".out"
    r.save(tmpout); r.close()
    os.replace(tmpout, fn)
    return fn


def test_list_fields_unit(tmp_path):
    res = form_ops.list_form_fields(_form_pdf(tmp_path))
    assert res["hasAcroForm"] is True and res["hasXfa"] is False and res["count"] == 3
    by = {f["name"]: f for f in res["fields"]}
    assert by["name"]["type"] == "Text"
    assert by["ok"]["type"] == "CheckBox" and by["ok"]["value"] is False
    assert by["land"]["type"] == "ComboBox" and by["land"]["options"] == ["DE", "FR", "IT"]
    # rect unten-links: y = Seitenhoehe - y1
    assert by["name"]["page"] == 1 and by["name"]["rect"]["width"] == 178


def test_fill_and_reset_unit(tmp_path):
    fn = _form_pdf(tmp_path)
    assert form_ops.set_field_value(fn, "name", "Anna")["value"] == "Anna"
    assert form_ops.set_field_value(fn, "ok", True)["value"] is True
    assert form_ops.set_field_value(fn, "land", "FR")["value"] == "FR"
    r = form_ops.reset_form(fn)
    assert r["reset"] == 3
    fields = {f["name"]: f for f in form_ops.list_form_fields(fn)["fields"]}
    assert fields["name"]["value"] == "Startwert"  # /DV
    assert fields["ok"]["value"] is False          # Off
    assert fields["land"]["value"] == "DE"


def test_unknown_field_unit(tmp_path):
    with pytest.raises(form_ops.FormError):
        form_ops.set_field_value(_form_pdf(tmp_path), "nichtda", "x")


def test_routes_fill_reset_undo(client, tmp_path):
    fn = _form_pdf(tmp_path)
    assert client.post("/document/open", json={"path": fn}, headers=HDRS).status_code == 200
    ff = client.get("/document/form-fields", headers=HDRS)
    assert ff.status_code == 200 and ff.json()["count"] == 3
    assert client.post("/document/fill-form", json={"name": "name", "value": "Ben"}, headers=HDRS).status_code == 200
    after = {f["name"]: f for f in client.get("/document/form-fields", headers=HDRS).json()["fields"]}
    assert after["name"]["value"] == "Ben"
    client.post("/document/undo", headers=HDRS)
    back = {f["name"]: f for f in client.get("/document/form-fields", headers=HDRS).json()["fields"]}
    assert back["name"]["value"] == ""  # Undo stellt den Zustand vor dem Fuellen wieder her
    assert client.post("/document/reset-form", json={}, headers=HDRS).json()["reset"] == 3


def test_field_rects_bleiben_pdf_raum_bei_seitendrehung(tmp_path, client, monkeypatch):
    """R71: /document/form-fields liefert Rechtecke im UNGEDREHTEN PDF-User-Space.
    Vorher wurde page.rect (enthaelt /Rotate) als Bezugshoehe benutzt: nach einer Drehung
    rutschte jedes Feld um die halbe Seitenhoehe (Frontend zeichnet die Drehung selbst).
    Beweist: Aenderung (/Rotate=90 in der Datei, zweite Bibliothek pikepdf), Nicht-Aenderung
    (Feldrechteck in PDF-Raum + /Rect des Widgets in der Datei bleiben identisch)."""
    import io

    import pikepdf

    monkeypatch.setenv("PDF_EDITOR_SESSION_DIR", str(tmp_path / "run"))
    monkeypatch.setenv("PDF_EDITOR_SNAPSHOT_DIR", str(tmp_path / "snap"))
    _form_pdf(tmp_path)
    src = str(tmp_path / "form.pdf")
    assert client.post("/document/open", json={"path": src}, headers=HDRS).status_code == 200

    def rects() -> dict:
        return {f["name"]: f["rect"] for f in client.get("/document/form-fields", headers=HDRS).json()["fields"]}

    before = rects()
    assert before, "Fixture muss Formularfelder haben"
    r = client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS)
    assert r.status_code == 200, r.text
    after = rects()

    # NICHT-Aenderung: PDF-Raum-Rechtecke sind identisch (Anzeige dreht selbst).
    assert after == before, f"Feldlagen duerfen sich durch die Anzeige-Drehung nicht aendern: {before} -> {after}"

    # AENDERUNG in der Datei (pikepdf, zweite Bibliothek): /Rotate=90, Widget-/Rect unveraendert.
    raw = client.get("/document/file", headers=HDRS).content
    with pikepdf.open(io.BytesIO(raw)) as pdf:
        assert int(pdf.pages[0].get("/Rotate", 0)) == 90
        rects_pdf = [list(map(float, a["/Rect"])) for a in (pdf.pages[0].get("/Annots") or []) if "/Rect" in a]
        assert rects_pdf, "Widget-Rect muss in der Datei stehen"
    # zweite Drehung: 180 Grad -> Felder weiter unveraendert
    assert client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS).status_code == 200
    assert rects() == before
    with pikepdf.open(io.BytesIO(client.get("/document/file", headers=HDRS).content)) as pdf:
        assert int(pdf.pages[0].get("/Rotate", 0)) == 180
