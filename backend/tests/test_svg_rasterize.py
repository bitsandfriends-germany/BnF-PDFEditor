"""R68: SVG-Rasterierung mit ImageMagick-Fallback (Nutzer: 'im Zweifel muss
per ImageMagick umgewandelt werden'). Beweist: echtes Inkscape-SVG rendert mit
Pixelinhalt; wenn MuPDF nichts liefert, uebernimmt ImageMagick (fake, ohne
Systemabhaengigkeit); ist beides leer/fehlt, kommt eine klare 422-Meldung."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.image_ops import _rasterize_svg, _svg_has_content  # noqa: E402
from backend.pdflib import PdfError  # noqa: E402

SIMPLE = b'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect x="4" y="4" width="112" height="52" fill="#0a58ef"/></svg>'
EMPTY = b'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>'


def test_svg_has_content_true_and_false():
    import pymupdf as fitz

    d = fitz.Document("svg", SIMPLE)
    pm = d[0].get_pixmap(matrix=fitz.Matrix(4, 4), alpha=True)
    assert _svg_has_content(pm.tobytes("png")) is True
    d2 = fitz.Document("svg", EMPTY)
    pm2 = d2[0].get_pixmap(matrix=fitz.Matrix(4, 4), alpha=True)
    assert _svg_has_content(pm2.tobytes("png")) is False


def test_real_svg_rasterizes_with_pixels():
    out = _rasterize_svg(SIMPLE)
    assert out[:8] == b"\x89PNG\r\n\x1a\n"
    assert _svg_has_content(out)


def test_imagemagick_fallback_when_primary_empty(monkeypatch):
    # Primary (MuPDF) zum Leerergebnis zwingen: Document("svg") liefert leere Seite
    import pymupdf as fitz

    real_doc = fitz.Document

    class EmptyDoc:
        def __init__(self, *a, **k):
            self._d = real_doc("svg", EMPTY)

        def __getitem__(self, i):
            return self._d[i]

        def close(self):
            self._d.close()

    import backend.image_ops as io_

    monkeypatch.setattr(fitz, "Document", lambda *a, **k: EmptyDoc() if a and a[0] == "svg" else real_doc(*a, **k))

    # Fake-ImageMagick: 'magick' existiert, schreibt ein gefuelltes PNG an dst
    # (Referenzbild ueber real_doc — fitz.Document ist gerade patcht!)
    d = real_doc("svg", SIMPLE)
    good = d[0].get_pixmap(matrix=fitz.Matrix(4, 4), alpha=True).tobytes("png")
    d.close()

    def fake_run(cmd, **kw):
        assert cmd[0].endswith(("magick", "convert"))
        with open(cmd[-1], "wb") as fh:
            fh.write(good)

        class R:
            returncode = 0
        return R()

    import shutil as _sh, subprocess

    monkeypatch.setattr(_sh, "which", lambda name: "/usr/bin/magick")
    monkeypatch.setattr(subprocess, "run", fake_run)
    out = io_._rasterize_svg(b'<svg xmlns="http://www.w3.org/2000/svg"><circle r="9"/></svg>')
    assert _svg_has_content(out), "ImageMagick-Fallback musste das Bild uebernehmen"


def test_clear_error_when_both_rasterizers_empty(monkeypatch):
    import backend.image_ops as io_
    import shutil as _sh

    monkeypatch.setattr(_sh, "which", lambda name: None)  # kein ImageMagick
    try:
        io_._rasterize_svg(b'<svg xmlns="http://www.w3.org/2000/svg"><broken')
        raise AssertionError("PdfError erwartet")
    except PdfError as exc:
        assert "ImageMagick" in str(exc) or "umgewandelt" in str(exc)
