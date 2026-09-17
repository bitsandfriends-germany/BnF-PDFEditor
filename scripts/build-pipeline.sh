#!/usr/bin/env bash
# =====================================================================================
# B&F PDF Editor — Build-Pipeline (R72)
#
# EIN Einstiegspunkt fuer den kompletten Weg: Qualitaetsgates -> Tests -> Build ->
# Installationspaket (RPM) -> Release-Manifest -> optionale Systeminstallation + Smoke-Test.
#
# Aufruf:
#   scripts/build-pipeline.sh                 # Gates + Unit-Tests + Build + RPM
#   scripts/build-pipeline.sh --e2e           # zusaetzlich die Browser-E2E-Suite
#   scripts/build-pipeline.sh --install       # zusaetzlich RPM installieren + starten (sudo)
#   scripts/build-pipeline.sh --e2e --install # voller Durchlauf (Release)
#
# Optionen:
#   --e2e            Browser-E2E-Suite mitlaufen lassen (langsam, ~3 min)
#   --no-tests       Gates/Tests ueberspringen (nur Build + Paket)
#   --install        RPM installieren (reinstall bei gleicher Version) und die App starten/pruefen
#   --install-only   nur installieren/pruefen (kein Neubau; nutzt das vorhandene RPM)
#   --with-docling   Docling-Sidecar mitbauen (WITH_DOCLING=1 an scripts/build.sh)
#   --keep-going     Nach fehlgeschlagenem Test weitermachen (nur fuer Diagnose; Exitcode bleibt 1)
#   -h | --help      Diese Hilfe
#
# Logs:  dist/logs/pipeline-<UTC-Zeit>/<stufe>.log   (jede Stufe separat, plus Summary)
# Paket: dist/rpms/pdf-editor-<version>-<release>.<dist>.rpm  (rpmbuild aus scripts/build.sh)
# Release: dist/release/<version>/  mit RPM-Kopie, SHA256SUMS und manifest.json
#
# Exitcodes: 0 = alles gruen · 1 = Fehler (erste fehlgeschlagene Stufe wird gemeldet)
# =====================================================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"
DIST="$ROOT/dist"
VENV="${VENV:-$ROOT/backend/.venv/bin/python}"
E2E_PORT="${E2E_PORT:-5199}"

RUN_E2E=0
RUN_TESTS=1
DO_INSTALL=0
INSTALL_ONLY=0
KEEP_GOING=0
WITH_DOCLING="${WITH_DOCLING:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --e2e) RUN_E2E=1 ;;
    --no-tests) RUN_TESTS=0 ;;
    --install) DO_INSTALL=1 ;;
    --install-only) DO_INSTALL=1; INSTALL_ONLY=1 ;;
    --with-docling) WITH_DOCLING=1 ;;
    --keep-going) KEEP_GOING=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unbekannte Option: $1 (siehe --help)" >&2; exit 2 ;;
  esac
  shift
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="$DIST/logs/pipeline-$STAMP"
STATE="$LOG_DIR/state.env"
mkdir -p "$LOG_DIR"
: > "$STATE"

# ---------------------------------------------------------------- Hilfsfunktionen
declare -a STAGE_NAMES=() STAGE_STATUS=() STAGE_SECONDS=()
CURRENT_STAGE=""
FAILED_STAGE=""

c_reset=$'\033[0m'; c_bold=$'\033[1m'; c_green=$'\033[32m'; c_red=$'\033[31m'; c_yellow=$'\033[33m'; c_blue=$'\033[36m'

say()  { printf '%s\n' "$*"; }
head1() { printf '\n%s==> %s%s\n' "$c_bold$c_blue" "$*" "$c_reset"; }

run_stage() { # run_stage <name> <funktion>
  local name="$1"; shift
  local start end rc
  CURRENT_STAGE="$name"
  head1 "$name"
  start=$SECONDS
  set +e
  "$@" 2>&1 | tee "$LOG_DIR/$(echo "$name" | tr ' /' '__').log"
  rc=${PIPESTATUS[0]}
  set -e
  end=$SECONDS
  STAGE_NAMES+=("$name"); STAGE_SECONDS+=($((end - start)))
  if [[ -f "$STATE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE"   # Stufen laufen in einer Subshell (Log-Pipe) -> Zustand hier einlesen
  fi
  if [[ $rc -eq 0 ]]; then
    STAGE_STATUS+=("OK")
    printf '%s   OK%s (%ss)\n' "$c_green" "$c_reset" "$((end - start))"
  else
    STAGE_STATUS+=("FEHLER")
    printf '%s   FEHLER%s (%ss) — Log: %s\n' "$c_red" "$c_reset" "$((end - start))" "$LOG_DIR"
    FAILED_STAGE="$name"
    if [[ $KEEP_GOING -eq 0 ]]; then
      summary
      exit 1
    fi
  fi
}

summary() {
  printf '\n%s================ Build-Pipeline Zusammenfassung ================%s\n' "$c_bold" "$c_reset"
  local i
  for i in "${!STAGE_NAMES[@]}"; do
    printf '  %-28s %s (%ss)\n' "${STAGE_NAMES[$i]}" "${STAGE_STATUS[$i]}" "${STAGE_SECONDS[$i]}"
  done
  printf '  Logs:      %s\n' "$LOG_DIR"
  [[ -f "$MANIFEST" ]] && printf '  Manifest:  %s\n' "$MANIFEST"
  [[ -f "$RELEASE_DIR/SHA256SUMS" ]] && printf '  SHA256:    %s\n' "$RELEASE_DIR/SHA256SUMS"
  [[ -n "${RPM_FILE:-}" && -f "${RPM_FILE:-}" ]] && printf '  Installpaket: %s\n' "$RPM_FILE"
  [[ -n "${DEB_FILE:-}" && -f "${DEB_FILE:-}" ]] && printf '  DEB-Paket:    %s\n' "$DEB_FILE"
  if [[ -n "$FAILED_STAGE" ]]; then
    printf '  %sErgebnis: FEHLER in "%s"%s\n' "$c_red" "$FAILED_STAGE" "$c_reset"
  else
    printf '  %sErgebnis: alle Stufen OK%s\n' "$c_green" "$c_reset"
  fi
  printf '%s================================================================%s\n' "$c_bold" "$c_reset"
}

VERSION=""
DEB_FILE=""
RELEASE_DIR=""
MANIFEST=""
RPM_FILE=""
BACKEND_BUNDLE=""
APP_UNPACKED=""
commit=""

# ---------------------------------------------------------------- Stufe 1: Preflight
preflight() {
  say "Projekt:      $ROOT"
  say "Node:         $(node -v) / npm $(npm -v)"
  say "Python-venv:  $VENV"
  say "Logs:         $LOG_DIR"

  local missing=0
  for tool in node npm npx rpmbuild rpm; do
    if ! command -v "$tool" >/dev/null; then
      say "  FEHLT: $tool"
      missing=1
    fi
  done
  [[ -x "$VENV" ]] || { say "  FEHLT: Backend-venv ($VENV)"; missing=1; }
  [[ -f build/linux/pdf-editor.spec ]] || { say "  FEHLT: build/linux/pdf-editor.spec"; missing=1; }
  # DEB ist optional: ohne dpkg-deb wird nur das RPM gebaut. libcrypt.so.1 braucht das von
  # electron-builder mitgelieferte fpm auf Fedora 44+ (Paket libxcrypt-compat).
  if command -v dpkg-deb >/dev/null 2>&1; then
    if ! ls /lib64/libcrypt.so.1 /usr/lib64/libcrypt.so.1 >/dev/null 2>&1; then
      say "  HINWEIS: libcrypt.so.1 fehlt (dnf install libxcrypt-compat) — DEB-Bau wird scheitern."
    fi
    say "DEB-Werkzeuge: dpkg-deb vorhanden"
  else
    say "DEB-Werkzeuge: dpkg-deb fehlt (dnf install dpkg) — es wird nur das RPM gebaut."
  fi
  [[ -f electron-builder.yml ]] || { say "  FEHLT: electron-builder.yml"; missing=1; }
  (( missing == 0 )) || { say "Preflight fehlgeschlagen."; return 1; }

  VERSION="$(node -p "require('./package.json').version")"
  local spec_version
  spec_version="$(awk '/^Version:/ {print $2; exit}' build/linux/pdf-editor.spec)"
  say "Version:      package.json=$VERSION  spec=$spec_version"
  if [[ "$VERSION" != "$spec_version" ]]; then
    say "  FEHLER: RPM-Spec-Version weicht von package.json ab — bitte angleichen."
    return 1
  fi

  commit="$(git rev-parse --short HEAD 2>/dev/null || echo 'kein-git')"
  say "Commit:       $commit"
  # Zustand persistieren: die Stufen laufen durch die Log-Pipe in einer Subshell.
  { printf 'VERSION=%q\n' "$VERSION"; printf 'COMMIT=%q\n' "$commit"; } >> "$STATE"
  if [[ -n "$(git status --porcelain 2>/dev/null | head -1)" ]]; then
    say "  ${c_yellow}Hinweis: Arbeitsverzeichnis ist nicht sauber (Build enthaelt lokale Aenderungen).${c_reset}"
  fi

  local free_gb
  free_gb="$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc '0-9')"
  say "Freier Platz: ${free_gb} GB (Bedarf ~3 GB)"
  if [[ "${free_gb:-0}" -lt 3 ]]; then
    say "  FEHLER: zu wenig Plattenplatz."
    return 1
  fi
  say "Preflight OK."
}

# ---------------------------------------------------------------- Stufe 2: Gates
gates() {
  node scripts/verification-matrix.mjs
  node scripts/ui-registry.mjs
  node scripts/tooltip-coverage.mjs
  if ! git diff --quiet -- docs/ui-registry.md 2>/dev/null; then
    say "Hinweis: docs/ui-registry.md wurde vom Guard aktualisiert (bitte mitcommitten)."
  fi
  npm run typecheck
}

# ---------------------------------------------------------------- Stufe 3: Unit-Tests
unit_tests() {
  say "Backend: pytest"
  "$VENV" -m pytest backend/tests -q
  say "Renderer/Main: vitest"
  npx vitest run --silent
}

# ---------------------------------------------------------------- Stufe 4: E2E
e2e_tests() {
  # Karten-Test bleibt aus: die Echtkarten-Lane laeuft nur mit ausdruecklichem BFTEST_PIN.
  unset BFTEST_PIN
  pkill -9 -f "vite --config scripts/vite.e2e" 2>/dev/null || true
  sleep 1
  npx vite --config scripts/vite.e2e.config.ts --port "$E2E_PORT" --strictPort > "$LOG_DIR/vite-e2e.log" 2>&1 &
  VITE_PID=$!
  trap 'kill -9 "$VITE_PID" 2>/dev/null || true' EXIT
  for _ in $(seq 1 30); do
    grep -q "Local" "$LOG_DIR/vite-e2e.log" 2>/dev/null && break
    sleep 1
  done
  grep -q "Local" "$LOG_DIR/vite-e2e.log" || { say "Vite-Dev-Server nicht gestartet (siehe $LOG_DIR/vite-e2e.log)"; return 1; }
  say "Vite bereit auf Port $E2E_PORT"
  E2E_BROWSER=1 npx playwright test --project=browser --reporter=line
  kill -9 "$VITE_PID" 2>/dev/null || true
  trap - EXIT
}

# ---------------------------------------------------------------- Stufe 5: Build + Paket
build_and_package() {
  say "Aufruf scripts/build.sh (Frontend, Backend, electron-builder --dir, rpmbuild)"
  WITH_DOCLING="$WITH_DOCLING" VENV="$VENV" bash scripts/build.sh
  BACKEND_BUNDLE="$DIST/backend/pdf-editor-backend"
  APP_UNPACKED="$DIST/electron/linux-unpacked"
  [[ -x "$APP_UNPACKED/pdf-editor" ]] || { say "App-Binary fehlt: $APP_UNPACKED/pdf-editor"; return 1; }
  [[ -x "$BACKEND_BUNDLE/pdf-editor-backend" ]] || { say "Backend-Bundle fehlt: $BACKEND_BUNDLE"; return 1; }
  # rpmbuild legt das Ergebnis unter <rpmdir>/<arch>/ ab -> rekursiv suchen.
  RPM_FILE="$(find "$DIST/rpms" -name 'pdf-editor-[0-9]*.rpm' ! -name '*docling*' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)"
  [[ -n "$RPM_FILE" && -f "$RPM_FILE" ]] || { say "rpmbuild hat kein Basis-RPM erzeugt (dist/rpms/…)"; return 1; }
  say "RPM erzeugt: $RPM_FILE ($(du -h "$RPM_FILE" | cut -f1))"
  { printf 'BACKEND_BUNDLE=%q\n' "$BACKEND_BUNDLE"
    printf 'APP_UNPACKED=%q\n' "$APP_UNPACKED"
    printf 'RPM_FILE=%q\n' "$RPM_FILE"; } >> "$STATE"
}

# ---------------------------------------------------------------- Stufe 6: Release-Artefakte
release_artifacts() {
  # Fallback, falls die Stufe allein (z. B. nach --install-only) laeuft.
  VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
  RELEASE_DIR="$DIST/release/$VERSION"
  mkdir -p "$RELEASE_DIR"
  [[ -n "$RPM_FILE" && -f "$RPM_FILE" ]] || {
    RPM_FILE="$(find "$DIST/rpms" -name 'pdf-editor-[0-9]*.rpm' ! -name '*docling*' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)"
  }
  [[ -n "$RPM_FILE" && -f "$RPM_FILE" ]] || { say "Kein Basis-RPM gefunden (dist/rpms/…)"; return 1; }

  local rpm_size app_size backend_size
  rpm_size="$(du -h "$RPM_FILE" | cut -f1)"
  app_size="$(du -sh "$APP_UNPACKED" | cut -f1)"
  backend_size="$(du -sh "$BACKEND_BUNDLE" | cut -f1)"
  say "RPM:          $RPM_FILE ($rpm_size)"
  say "App-Baum:     $app_size · Backend-Bundle: $backend_size"

  cp -f "$RPM_FILE" "$RELEASE_DIR/"
  local docling_rpm
  docling_rpm="$(find "$DIST/rpms" -name 'pdf-editor-docling-*.rpm' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)"
  [[ -n "$docling_rpm" ]] && cp -f "$docling_rpm" "$RELEASE_DIR/" || true

  # R76: DEB (Debian/Ubuntu) mitnehmen, wenn gebaut.
  DEB_FILE="$(find "$DIST/electron" -maxdepth 1 -name 'pdf-editor-*.deb' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)"
  if [[ -n "$DEB_FILE" && -f "$DEB_FILE" ]]; then
    cp -f "$DEB_FILE" "$RELEASE_DIR/"
    say "DEB:          $DEB_FILE ($(du -h "$DEB_FILE" | cut -f1))"
  else
    say "DEB:          nicht gebaut (dpkg-deb fehlt?)"
  fi

  ( cd "$RELEASE_DIR" && sha256sum ./*.rpm ./*.deb > SHA256SUMS )

  MANIFEST="$RELEASE_DIR/manifest.json"
  node -e '
    const fs = require("fs"), path = require("path"), cp = require("child_process");
    const dir = process.argv[1], version = process.argv[2], commit = process.argv[3];
    const arts = fs.readdirSync(dir).filter((f) => f.endsWith(".rpm") || f.endsWith(".deb")).map((f) => {
      const p = path.join(dir, f);
      return { file: f, bytes: fs.statSync(p).size, sha256: cp.execSync(`sha256sum "${p}"`).toString().split(" ")[0] };
    });
    const m = {
      product: "B&F PDF Editor", version, commit,
      builtAtUtc: new Date().toISOString(),
      node: process.version,
      artifacts: arts,
      installRpm: `sudo dnf reinstall -y --nogpgcheck ${path.join(dir, (arts.find((a) => a.file.endsWith(".rpm")) || {}).file || "pdf-editor.rpm")}`,
      installDeb: `sudo apt install ./${(arts.find((a) => a.file.endsWith(".deb")) || {}).file || "pdf-editor.deb"}`
    };
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
  ' "$RELEASE_DIR" "$VERSION" "${commit:-${COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo unbekannt)}}"

  say "Release-Verzeichnis: $RELEASE_DIR"
  cat "$RELEASE_DIR/SHA256SUMS"
  { printf 'VERSION=%q\n' "$VERSION"
    printf 'RELEASE_DIR=%q\n' "$RELEASE_DIR"
    printf 'MANIFEST=%q\n' "$MANIFEST"
    printf 'RPM_FILE=%q\n' "$RPM_FILE"
    printf 'DEB_FILE=%q\n' "$DEB_FILE"; } >> "$STATE"
}

# ---------------------------------------------------------------- Stufe 7: Installation
install_package() {
  [[ -f "$RPM_FILE" ]] || { say "Kein RPM zum Installieren."; return 1; }
  say "Installiere/reinstalliere (ohne GPG-Pruefung — Paket ist lokal gebaut): $RPM_FILE"
  # WICHTIG: bei IDENTISCHER Version+Release ist 'dnf install' ein No-op — die installierte App
  # bliebe der alte Stand. Deshalb 'dnf reinstall' (oder rpm --replacepkgs als Rueckfall).
  if ! sudo dnf reinstall -y --nogpgcheck "$RPM_FILE"; then
    say "dnf reinstall nicht moeglich — erzwinge mit rpm -Uvh --replacepkgs."
    sudo rpm -Uvh --replacepkgs --replacefiles "$RPM_FILE"
  fi

  say "Paketstatus:"
  rpm -q pdf-editor
  say "Dateipruefung (leer = alle Dateien unveraendert):"
  rpm -V pdf-editor || true

  # Beweis, dass die INSTALLIERTE App wirklich der frische Build ist (sonst blieb Alt-Bestand liegen).
  local installed_app="$ROOT/dist/electron/linux-unpacked/pdf-editor"
  local installed_asar="$ROOT/dist/electron/linux-unpacked/resources/app.asar"
  local backend_bin="$BACKEND_BUNDLE/pdf-editor-backend"
  local pairs=(
    "$installed_app:/usr/lib/pdf-editor/pdf-editor:App-Binary"
    "$installed_asar:/usr/lib/pdf-editor/resources/app.asar:app.asar"
    "$backend_bin:/usr/lib/pdf-editor/resources/backend/pdf-editor-backend/pdf-editor-backend:Backend-Binary"
  )
  local entry src dst label h_src h_dst
  for entry in "${pairs[@]}"; do
    src="${entry%%:*}"; dst="$(echo "$entry" | cut -d: -f2)"; label="${entry##*:}"
    [[ -f "$src" && -f "$dst" ]] || { say "  FEHLER: $label fehlt ($src bzw. $dst)"; return 1; }
    h_src="$(sha256sum "$src" | cut -d' ' -f1)"
    h_dst="$(sha256sum "$dst" | cut -d' ' -f1)"
    if [[ "$h_src" == "$h_dst" ]]; then
      say "  ok   $label: installiert == gebaut (${h_src:0:16}…)"
    else
      say "  FEHLER: $label weicht ab — installiert ${h_dst:0:16}… != gebaut ${h_src:0:16}…"
      return 1
    fi
  done

  local ok=1
  for p in /usr/bin/pdf-editor \
           /usr/share/applications/pdf-editor.desktop \
           /usr/share/icons/hicolor/512x512/apps/pdf-editor.png \
           /usr/lib/pdf-editor/pdf-editor \
           /usr/lib/pdf-editor/resources/backend/pdf-editor-backend/pdf-editor-backend; do
    if [[ -e "$p" ]]; then say "  ok   $p"; else say "  FEHLT $p"; ok=0; fi
  done
  (( ok == 1 )) || return 1

  say "Smoke-Test: installierte App starten (Wrapper /usr/bin/pdf-editor)…"
  # Die App haelt eine Single-Instance-Sperre: laufende Instanzen (auch eine Entwicklungsinstanz
  # aus dem Quellbaum) wuerden den frischen Start sofort beenden. Daher vorher beide beenden.
  pkill -9 -f "/usr/lib/pdf-editor/pdf-editor" 2>/dev/null || true
  pkill -9 -f "/usr/lib/pdf-editor/resources/backend" 2>/dev/null || true
  pkill -9 -f "dist/electron/linux-unpacked/pdf-editor" 2>/dev/null || true
  sleep 2
  setsid /usr/bin/pdf-editor >"$LOG_DIR/installed-app.log" 2>&1 </dev/null &
  local app_pid=$!
  local found=0
  for _ in $(seq 1 60); do
    if pgrep -f "/usr/lib/pdf-editor/pdf-editor" >/dev/null && pgrep -f "/usr/lib/pdf-editor/resources/backend" >/dev/null; then found=1; break; fi
    sleep 1
  done
  if [[ $found -eq 1 ]]; then
    say "  ok   Electron-Hauptprozess + Backend laufen aus /usr/lib/pdf-editor"
    say "  Backend-Prozess: $(pgrep -af '/usr/lib/pdf-editor/resources/backend' | head -1 | cut -c1-120)"
  else
    say "  FEHLER: installierte App startete nicht vollstaendig (Log: $LOG_DIR/installed-app.log)"
    tail -20 "$LOG_DIR/installed-app.log" || true
    return 1
  fi
  # Die verifizierte Instanz laeuft weiter: nach einer Installation soll die App offen sein.
  # (Separater Nachweis oben, dass Prozesse aus /usr/lib/pdf-editor stammen.)
  say "Installation verifiziert: RPM installiert, Dateien vollstaendig (installiert == gebaut), App laeuft."
  say "Hinweis: Das Fenster ist offen — bei erneutem Start greift die Single-Instance-Sperre."
  # Frueher beendete die Pipeline die Instanz wieder; das war fuer den Nutzer verwirrend
  # ('Programm laesst sich nicht starten', weil die Sperre still blieb).
}

# ---------------------------------------------------------------- Ablauf
head1 "Build-Pipeline B&F PDF Editor ($STAMP)"
run_stage "1 Preflight" preflight
if [[ $RUN_TESTS -eq 1 ]]; then
  run_stage "2 Qualitaetsgates" gates
  run_stage "3 Unit-Tests" unit_tests
  [[ $RUN_E2E -eq 1 ]] && run_stage "4 Browser-E2E" e2e_tests
else
  say "\n(--no-tests: Gates und Tests uebersprungen)"
fi
if [[ $INSTALL_ONLY -eq 1 ]]; then
  say "\n(--install-only: Build und Paketbau uebersprungen, es wird das vorhandene RPM verwendet)"
  # RPM ermitteln (ohne Neubau) und Zustand setzen
  RPM_FILE="$(find "$DIST/rpms" -name 'pdf-editor-[0-9]*.rpm' ! -name '*docling*' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)"
  BACKEND_BUNDLE="$DIST/backend/pdf-editor-backend"
  APP_UNPACKED="$DIST/electron/linux-unpacked"
  { printf 'BACKEND_BUNDLE=%q\n' "$BACKEND_BUNDLE"
    printf 'APP_UNPACKED=%q\n' "$APP_UNPACKED"
    printf 'RPM_FILE=%q\n' "$RPM_FILE"; } >> "$STATE"
  [[ -n "$RPM_FILE" ]] || { say "Kein RPM gefunden — bitte erst bauen."; exit 1; }
else
  run_stage "5 Build + RPM-Paket" build_and_package
  run_stage "6 Release-Artefakte" release_artifacts
fi
if [[ $DO_INSTALL -eq 1 ]]; then
  run_stage "7 Installation + Smoke-Test" install_package
else
  say "\n(--install nicht gesetzt: Installation uebersprungen)"
fi

summary
[[ -z "$FAILED_STAGE" ]] || exit 1
