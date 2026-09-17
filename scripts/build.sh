#!/usr/bin/env bash
# Packaging-Orchestrator (Step 12). Baut in dieser Reihenfolge:
#   1) Frontend (electron-vite build)            -> out/
#   2) Backend PyInstaller ONEDIR                -> dist/backend/pdf-editor-backend/
#   3) optional Docling-Sidecar ONEDIR           -> dist/docling-worker/  (nur wenn gebaut bar)
#   4) electron-builder --dir (App-Baum)         -> dist/electron/linux-unpacked/
#   5) rpmbuild: Basis-RPM + pdf-editor-docling  -> dist/rpms/
# Meldet am Ende die GROESSEN beider Bundles (Pflicht aus Section 12).
#
# Umgebungssteuerung:
#   WITH_DOCLING=1  versuch den Docling-Sidecar zu bauen (benoetigt requirements-docling.txt
#                   in einer eigenen venv; scheitert der Build, wird die Basis trotzdem fertig).
#   VENV=...        Python-Interpreter fuer Backend-PyInstaller (Default: backend/.venv/bin/python)
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VENV="${VENV:-$ROOT/backend/.venv/bin/python}"
DIST="$ROOT/dist"

echo "[1/5] Frontend-Build (electron-vite)"
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm run build

echo "[2/5] Backend PyInstaller (onedir)"
test -x "$VENV" || { echo "Backend-venv nicht gefunden: $VENV"; exit 1; }
"$VENV" -m PyInstaller --noconfirm --clean --distpath "$DIST/backend" \
  --workpath "$DIST/build-pyi" backend/backend.spec
BACKEND_BUNDLE="$DIST/backend/pdf-editor-backend"

echo "[3/5] Docling-Sidecar (optional)"
DOC_PACKAGED=0
if [[ "${WITH_DOCLING:-0}" == "1" ]]; then
  if "$VENV" -c "import docling" 2>/dev/null; then
    "$VENV" -m PyInstaller --noconfirm --clean --distpath "$DIST" \
      --workpath "$DIST/build-pyi-docling" backend/docling_worker.spec \
      && DOC_PACKAGED=1 || echo "Docling-Build fehlgeschlagen — Basis laeuft ohne Sidecar weiter."
  else
    echo "docling nicht importierbar — Sidecar wird uebersprungen (Basis bleibt lauffaehig)."
  fi
else
  echo "WITH_DOCLING!=1 — Sidecar wird uebersprungen (Basis laeuft ohne Sidecar)."
fi

echo "[4/5] electron-builder --dir (App-Baum)"
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npx electron-builder --linux --dir
APP_UNPACKED="$DIST/electron/linux-unpacked"

# R76: zusaetzlich ein DEB fuer Debian/Ubuntu — aus DEMSELBEN App-Baum (--prepackaged), damit
# RPM und DEB inhaltlich identisch sind. Fehlt dpkg-deb, bleibt es beim RPM (klarer Hinweis).
echo "[4b/5] DEB-Paket (electron-builder --prepackaged)"
if command -v dpkg-deb >/dev/null 2>&1; then
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npx electron-builder --linux deb --prepackaged "$APP_UNPACKED" \
    || echo "DEB-Build fehlgeschlagen — Basis-RPM bleibt gueltig."
else
  echo "dpkg-deb nicht installiert (dnf install dpkg) — DEB uebersprungen."
fi

echo "[5/5] rpmbuild (Basis + pdf-editor-docling)"
TOP="$(mktemp -d "${TMPDIR:-/tmp}/pdf-editor-rpmbuild.XXXXXX")"
trap 'rm -rf "$TOP"' EXIT
mkdir -p "$TOP"/{BUILD,RPMS,SOURCES/SPECS,BUILDROOT,SRPMS}
mkdir -p "$TOP/SOURCES"
cp -a "$APP_UNPACKED" "$TOP/SOURCES/linux-unpacked"
cp -a "$BACKEND_BUNDLE" "$TOP/SOURCES/backend-tmp" ; mkdir -p "$TOP/SOURCES/backend"
mv "$TOP/SOURCES/backend-tmp" "$TOP/SOURCES/backend/pdf-editor-backend"
mkdir -p "$TOP/SOURCES/wrapper" "$TOP/SOURCES/desktop" "$TOP/SOURCES/icon"
install -m 0755 build/linux/pdf-editor "$TOP/SOURCES/wrapper/pdf-editor"
install -m 0644 build/linux/pdf-editor.desktop "$TOP/SOURCES/desktop/pdf-editor.desktop"
install -m 0644 build/icon.png "$TOP/SOURCES/icon/icon.png"
if [[ "$DOC_PACKAGED" == "1" ]]; then
  mkdir -p "$TOP/SOURCES/docling"
  cp -a "$DIST/docling-worker" "$TOP/SOURCES/docling/docling-worker"
fi
mkdir -p "$DIST/rpms"
rpmbuild -bb --define "_topdir $TOP" --define "_sourcedir $TOP/SOURCES" \
  --define "_rpmdir $DIST/rpms" build/linux/pdf-editor.spec

echo
echo "================= Bundle-Groessen ================="
du -sh "$BACKEND_BUNDLE" 2>/dev/null | awk '{print "Backend-Bundle (onedir):   "$1}'
if [[ -d "$DIST/docling-worker" ]]; then
  du -sh "$DIST/docling-worker" 2>/dev/null | awk '{print "Docling-Bundle (onedir):   "$1}'
else
  echo "Docling-Bundle (onedir):   nicht gebaut (WITH_DOCLING!=1)"
fi
du -sh "$APP_UNPACKED" 2>/dev/null | awk '{print "Electron-App (unpacked):   "$1}'
find "$DIST/rpms" -name '*.rpm' -printf '%k KB\t%p\n' 2>/dev/null | sort -n || true
echo "==================================================="
echo "Fertig. RPMs unter $DIST/rpms"
