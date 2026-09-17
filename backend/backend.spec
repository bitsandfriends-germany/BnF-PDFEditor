# -*- mode: python ; coding: utf-8 -*-
# PyInstaller-Spec für das PDF-Editor-Backend (Step 12).
#
# Bewusst ONEDIR, nicht ONEFILE: onefile packt 100+ MB bei jedem Start nach /tmp aus
# (spuerbare Verzögerung) und scheitert auf gehaerteten Systemen mit noexec-/tmp.
# onedir landet unter /usr/lib/pdf-editor/backend/pdf-editor-backend/.
#
# console=True ist Pflicht: der Stdout-Handshake (erste Zeile {"event":"listening",...}) und der
# JSONL-Log-Bridge laufen ueber stdout. Ein windowed-Binary wuerde den Handshake abschneiden.
#
# Docling ist NICHT Teil dieses Bundles (Section 5.3): es lebt im separaten Sidecar-Bundle
# (docling_worker.spec). Das Backend importiert docling nirgends, nur find_spec zur Erkennung.

import os
from PyInstaller.utils.hooks import collect_all, collect_submodules

# Repo-Wurzel = ein Verzeichnis ueber dem Ordner dieser Spec (backend/).
ROOT = os.path.abspath(os.path.join(SPECPATH, os.pardir))

datas, binaries, hiddenimports = [], [], []
hiddenimports += collect_submodules("backend")

# Pakete mit nativen Bibliotheken / dynamischen Imports / Datendateien vollstaendig einsammeln.
for pkg in (
    "uvicorn",
    "pydantic",
    "pydantic_core",
    "fastapi",
    "fitz",          # PyMuPDF (native MuPDF-Bibliothek)
    "pikepdf",       # native QPDF
    "pyhanko",
    "pyhanko_certvalidator",
    "cryptography",
    "argon2",
    "openai",
    "httpx",
    "httpcore",
    "keyring",
    "sse_starlette",
    "rank_bm25",
    "PIL",            # Bildnormalisierung (SVG/WEBP/HEIC -> PNG) für Stempel & Signaturen
):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:  # noqa: BLE001 - optionale/fehlende Pakete duerfen den Build nicht brechen
        pass

a = Analysis(
    [os.path.join(ROOT, "backend", "main.py")],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "PyQt5", "PySide2", "pytest", "respx"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="pdf-editor-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="pdf-editor-backend",
)
