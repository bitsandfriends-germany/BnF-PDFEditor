"""Zentrale stdout-Log-Bridge (Spec Section 6).

Das Backend schreibt ausschliesslich JSON-Einzeiler auf stdout; Electron uebernimmt sie
zeilenweise in den zentralen Logger. Bewusst eigen Modul, damit main.py, session.py und
pdflib.py ohne Zirkularitaet darauf zugreifen koennen.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone


def emit(entry: dict) -> None:
    """Ein strukturierter JSON-Einzeiler auf stdout, sofort geflusht."""
    entry.setdefault(
        "ts",
        datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    )
    entry.setdefault("source", "backend")
    sys.stdout.write(json.dumps(entry, separators=(",", ":"), ensure_ascii=False) + "\n")
    sys.stdout.flush()
