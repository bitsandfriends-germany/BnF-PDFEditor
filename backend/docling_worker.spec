# -*- mode: python ; coding: utf-8 -*-
# PyInstaller-Spec fuer den Docling-Sidecar (Step 12) — SEPARATES onedir-Bundle.
#
# Docling ist NICHT im Backend-Bundle (Section 5.3): eigener Interpreter, eigenes PyTorch, eigene
# ABI. Dieses Bundle wird aus requirements-docling.txt gebaut und als eigenes RPM-Unterpaket
# `pdf-editor-docling` nach /usr/lib/pdf-editor/docling-worker/ installiert. Die Basis-App haengt
# nicht davon ab; fehlend => Docling-Provider deaktiviert (klare Meldung), alles laeuft weiter.
#
# console=True: der Sidecar spricht das JSON-Zeilen-Protokoll auf stdout (progress/manifest) und
# antwortet auf `--version` mit einer JSON-Zeile {protocolVersion, docling, available}.
#
# Baut nur, wenn docling importierbar ist (requirements-docling.txt in der dafuer gedachten venv).

import os
from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata

ROOT = os.path.abspath(os.path.join(SPECPATH, os.pardir))

datas, binaries, hiddenimports = [], [], []
# docling bringt Model-Dateien/Configs mit; copy_metadata haelt Versions-Inventar (docling self).
try:
    datas += copy_metadata("docling")
except Exception:  # noqa: BLE001
    pass
for pkg in ("docling", "docling_core", "docling_parse", "torch", "torchvision", "transformers", "PIL"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:  # noqa: BLE001 - fehlend heisst: Sidecar kann nicht gebaut werden
        pass

a = Analysis(
    [os.path.join(ROOT, "backend", "docling_worker.py")],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "pytest"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="docling-worker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, upx_exclude=[], name="docling-worker")
