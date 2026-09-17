#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# B&F PDF Editor — Starter (Entwicklungs-Modus)
#
# Startet das komplette Programm mit einem Befehl:
#   ./start.sh
#
# Der Starter ist idempotent und richtet bei Bedarf alles ein, was fehlt:
#   1. Node-Abhaengigkeiten   (npm install,  falls node_modules fehlt)
#   2. Backend-Python-Umgebung(venv + pip,   falls backend/.venv fehlt)
# Danach startet "npm run dev" (electron-vite), das Electron-Fenster UND den
# Python-Backend-Prozess automatisch hochfaehrt.
#
# Umgebungsvariablen (optional):
#   PDF_EDITOR_BACKEND_TOKEN  Authentifizierungs-Token fuer das Backend.
#                             Voreinstellung: ein lokales Zufallstoken.
#   SKIP_SETUP=1              Einrichtungs-Check ueberspringen (schneller Start).
# ---------------------------------------------------------------------------
set -euo pipefail

# Immer im Projektordner arbeiten, egal von wo das Skript aufgerufen wird.
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

say() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

if [[ "${SKIP_SETUP:-0}" != "1" ]]; then
  # 1) Node-Abhaengigkeiten --------------------------------------------------
  if [[ ! -d node_modules ]]; then
    say "Installiere Node-Abhaengigkeiten (npm install) — einmalig, kann dauern ..."
    npm install
  fi

  # 2) Backend-Python-Umgebung ----------------------------------------------
  if [[ ! -x backend/.venv/bin/python ]]; then
    say "Erstelle Python-Umgebung backend/.venv und installiere requirements.txt ..."
    python3 -m venv backend/.venv
    backend/.venv/bin/python -m pip install --upgrade pip >/dev/null
    backend/.venv/bin/python -m pip install -r requirements.txt
  fi
fi

# Token fuer die Renderer<->Backend-Authentifizierung.
export PDF_EDITOR_BACKEND_TOKEN="${PDF_EDITOR_BACKEND_TOKEN:-local-dev-$(head -c 12 /dev/urandom | base64 | tr -d '/+=')}"

say "Starte B&F PDF Editor (electron-vite dev) — Fenster und Backend starten automatisch."
say "Beenden mit Strg+C im Terminal."
exec npm run dev
