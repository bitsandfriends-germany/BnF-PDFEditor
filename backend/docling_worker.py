"""Docling-Sidecar-Einstiegspunkt (Step 5, Spec 5.3) — EIN separater Prozess.

Nur diese Datei importiert `docling`. Das Backend importiert sie nie. Sie laeuft als eigene
Ausfuehrbare (im RPM: eigener PyInstaller-onedir-Bundle in /usr/lib/pdf-editor/docling-worker/,
gebaut aus requirements-docling.txt) oder — ausserhalb von RPM — aus einem User-venv.

Protokoll (versioniert):
  docling_worker.py --version           ->  eine JSON-Zeile {protocolVersion, docling, available}
  docling_worker.py IN OUTDIR           ->  schreibt OUTDIR/page-*.jsonl + manifest.json,
                                            Fortschritt als JSON-Zeilen auf stdout:
                                            {"event":"progress","done":n,"total":t}
                                            {"event":"done", ...} / {"event":"error", ...}

Lifecycle-Sicherheitsnetz: prctl(PR_SET_PDEATHSIG, SIGKILL) — wenn das Backend selbst SIGKILLed
wird und nichts weitergeben kann, erntet der Kernel den Sidecar. SIGTERM behandelt der Handler.
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import signal
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from backend.context.base import (  # noqa: E402
    CONTEXT_PROTOCOL_VERSION,
    write_manifest,
    write_page_jsonl,
)

PR_SET_PDEATHSIG = 1


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _set_pdeathsig() -> None:
    try:
        libc = ctypes.CDLL(None)
        libc.prctl(PR_SET_PDEATHSIG, signal.SIGKILL, 0, 0, 0)
    except Exception:
        pass


def _install_sigterm() -> None:
    def _handler(signum, frame):  # noqa: ARG001
        _emit({"event": "cancelled"})
        sys.exit(143)

    signal.signal(signal.SIGTERM, _handler)


def _docling_available() -> bool:
    try:
        import docling  # noqa: F401
    except Exception:
        return False
    return True


def _version() -> int:
    _emit({"event": "version", "protocolVersion": CONTEXT_PROTOCOL_VERSION, "available": _docling_available()})
    return 0


def _convert(in_path: str, out_dir: str) -> int:
    _set_pdeathsig()
    _install_sigterm()
    try:
        from docling.document_converter import DocumentConverter
    except Exception as exc:  # docling nicht installiert
        _emit({"event": "error", "error": f"docling nicht verfuegbar: {type(exc).__name__}"})
        return 2

    try:
        conv = DocumentConverter()
        result = conv.convert(in_path)
        doc = result.document
    except Exception as exc:
        _emit({"event": "error", "error": f"Konvertierung fehlgeschlagen: {type(exc).__name__}: {exc}"})
        return 1

    pages = getattr(doc, "pages", None) or {}
    total = len(pages) if hasattr(pages, "__len__") else (max(getattr(doc, "num_pages", lambda: 1)(), 1))
    try:
        # DoclingDocument-Struktur kann je Version variieren; bewusst defensiv — Detailtiefe ist
        # bewusst block-/textbasiert (5.3.1), nicht glyph-level.
        texts = doc.texts if hasattr(doc, "texts") else []
        by_page: dict[int, list] = {}
        for item in texts:
            pg = 0
            prov = getattr(item, "prov", None)
            if prov:
                p0 = getattr(prov[0], "page_no", None)
                if isinstance(p0, int):
                    pg = p0
            bbox = None
            if prov:
                b = getattr(prov[0], "bbox", None)
                if b is not None:
                    bbox = [round(float(b.l), 2), round(float(b.t), 2), round(float(b.r), 2), round(float(b.b), 2)]
            by_page.setdefault(pg, []).append(
                {"page": pg, "type": "text", "bbox": bbox, "text": getattr(item, "text", "") or "",
                 "heading": False, "level": 0, "fontSize": 0.0, "bold": False}
            )
        page_index = []
        max_page = max(by_page.keys()) if by_page else 0
        for pg in range(max_page + 1):
            els = by_page.get(pg, [])
            nbytes = write_page_jsonl(out_dir, pg, els)
            page_index.append({"page": pg, "file": f"page-{pg:06d}.jsonl", "bytes": nbytes, "elements": len(els)})
            _emit({"event": "progress", "done": pg + 1, "total": max_page + 1})
        manifest = {
            "status": "done",
            "provider": "docling",
            "sourceSha256": "",
            "protocolVersion": CONTEXT_PROTOCOL_VERSION,
            "pageCount": max_page + 1,
            "pages": page_index,
        }
        write_manifest(out_dir, manifest)
        _emit({"event": "done", "pageCount": max_page + 1})
        return 0
    except Exception as exc:
        _emit({"event": "error", "error": f"Ausgabe fehlgeschlagen: {type(exc).__name__}: {exc}"})
        return 1


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="docling_worker")
    parser.add_argument("input", nargs="?")
    parser.add_argument("outdir", nargs="?")
    parser.add_argument("--version", action="store_true", dest="version_mode")
    ns = parser.parse_args(argv[1:])
    if ns.version_mode:
        return _version()
    if not ns.input or not ns.outdir:
        _emit({"event": "error", "error": "input und outdir sind erforderlich"})
        return 2
    os.makedirs(ns.outdir, exist_ok=True)
    return _convert(ns.input, ns.outdir)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
