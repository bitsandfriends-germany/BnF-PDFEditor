#!/usr/bin/env bash
# =====================================================================================
# B&F PDF Editor — Veroeffentlichung auf GitHub (R77)
#
# Legt unter dem Zielkonto ein OEFFENTLICHES Repository an (falls noetig) und pusht einen
# SAUBEREN SCHNAPPSCHUSS des aktuellen Stands: genau EIN Commit mit dem Inhalt des Arbeitsbaums.
#
# Warum Schnappschuss statt Historie: im Verlauf aelterer Staende stehen Testzugangsdaten
# (u. a. eine echte Karten-PIN in frueheren E2E-Fixtures). Der oeffentliche Verlauf startet
# deshalb ohne diese Altlasten; das interne Repository (git.nc4.io) behaelt seine Historie.
#
# Voraussetzungen:
# Zwei Wege:
#   --ssh          Push ueber SSH (Schluessel ~/.ssh/id_ed25519_github). Das Repository muss im
#                  Zielkonto bereits angelegt sein (SSH kann keine Repositories erstellen).
#   (Default)      Push ueber HTTPS mit GITHUB_TOKEN; legt das oeffentliche Repository bei Bedarf an.
#
#   GITHUB_TOKEN   Token mit Recht, im Zielkonto Repositories anzulegen (Classic: 'repo';
#                  Fine-grained: Administration: Read and write fuer das Konto/die Organisation).
#   git, curl, python3
#
# Aufruf:
#   scripts/publish-github.sh --ssh                            # Ziel: bitsandfriends-germany/BnF-PDFEditor
#                                                              # (Deploy-Key: GITHUB_SSH_KEY/GITHUB_SSH_ALIAS setzen)
#   GITHUB_TOKEN=... scripts/publish-github.sh                 # inkl. Anlegen des Repositories
#   scripts/publish-github.sh --dry-run                        # nur Schnappschuss + Pruefungen
#   GITHUB_OWNER=... GITHUB_REPO=... scripts/publish-github.sh --ssh
#
# Sicherheit: das Token wird nie ausgegeben, nicht in Dateien geschrieben und nicht geloggt.
# =====================================================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

OWNER="${GITHUB_OWNER:-bitsandfriends-germany}"
# SSH-Identitaet ist waehlbar: Standard ist der Hauptschluessel; mit GITHUB_SSH_KEY und
# GITHUB_SSH_ALIAS laesst sich der zweite, unabhaengige Schluessel verwenden.
SSH_KEY="${GITHUB_SSH_KEY:-$HOME/.ssh/id_ed25519_github}"
# Zielhost fuer die Remote-URL. Der Schluessel wird IMMER explizit mit -i uebergeben und die
# Konfiguration mit -F /dev/null ignoriert; ein Alias aus ~/.ssh/config wuerde dort nicht aufgeloest.
SSH_HOST="${GITHUB_SSH_ALIAS:-github.com}"
REPO="${GITHUB_REPO:-BnF-PDFEditor}"
TOKEN="${GITHUB_TOKEN:-}"
DRY_RUN=0
USE_SSH=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --ssh) USE_SSH=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unbekannte Option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
fail() { printf 'FEHLER: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 1) Arbeitsbaum sauber?
[[ -z "$(git status --porcelain)" ]] || fail "Arbeitsbaum ist nicht sauber — bitte erst committen."
VERSION="$(node -p "require('./package.json').version")"
COMMIT="$(git rev-parse --short HEAD)"
say "Projekt:   $REPO $VERSION (Quellcommit $COMMIT)"
say "Ziel:      github.com/$OWNER/$REPO (public)"

# ---------------------------------------------------------------- 2) Geheimnisse ausschliessen
# Der Schnappschuss darf keine Zugangsdaten enthalten. Geprueft wird der INHALT der committeten
# Dateien (nicht die Historie — die wird bewusst nicht uebertragen).
say "Pruefe Schnappschuss auf Zugangsdaten…"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/bf-publish.XXXXXX")"
trap 'rm -rf "$SNAP"' EXIT
git archive HEAD | tar -x -C "$SNAP"

# Muster statt konkreter Werte: so kann das Skript selbst keinen Wert verraten und findet
# trotzdem harte Zugangsdaten im Schnappschuss.
SECRET_PATTERNS=(
  "\?\?[[:space:]]*'[0-9]{6,12}'"            # fest eingebaute Ziffern-PIN als Default
  "BFTEST_PIN=[\"']?[0-9]{6,12}"             # PIN direkt zugewiesen
  'ghp_[A-Za-z0-9]{20,}'                     # GitHub-Token (classic)
  'github_pat_[A-Za-z0-9_]{20,}'             # GitHub-Token (fine-grained)
  'BEGIN [A-Z ]*PRIVATE KEY'                 # private Schluessel
)
FOUND=0
for pat in "${SECRET_PATTERNS[@]}"; do
  if grep -rIlE "$pat" "$SNAP" \
       --exclude-dir=node_modules --exclude-dir=.git --exclude=publish-github.sh >/dev/null 2>&1; then
    say "  VERDAECHTIG: Muster '$pat' gefunden in:"
    grep -rIlE "$pat" "$SNAP" --exclude-dir=node_modules --exclude-dir=.git --exclude=publish-github.sh | sed 's#^#    #' | head -5
    FOUND=1
  fi
done
[[ $FOUND -eq 0 ]] || fail "Schnappschuss enthaelt Zugangsdaten — Veroeffentlichung abgebrochen."
say "  keine Zugangsdaten gefunden (${#SECRET_PATTERNS[@]} Muster geprueft)"

# ---------------------------------------------------------------- 3) Schnappschuss-Repository
( cd "$SNAP"
  git init -q -b main
  git config user.name "B&F Release Bot"
  git config user.email "release@example.org"
  git add -A
  git commit -q -m "B&F PDF Editor $VERSION (Quellstand $COMMIT)"
)
SNAP_COMMIT="$(cd "$SNAP" && git rev-parse HEAD)"
SNAP_FILES="$(cd "$SNAP" && git ls-files | wc -l)"
say "Schnappschuss: $SNAP_FILES Dateien, Commit ${SNAP_COMMIT:0:10}"

if [[ $DRY_RUN -eq 1 ]]; then
  say "Probelauf beendet (--dry-run): es wurde nichts gepusht."
  exit 0
fi

if [[ $USE_SSH -eq 0 ]]; then
  [[ -n "$TOKEN" ]] || fail "GITHUB_TOKEN ist nicht gesetzt. Token anlegen: https://github.com/settings/tokens (Classic, Scope 'repo') — oder Fine-grained mit Administration: Read and write. Alternativ: --ssh verwenden."
fi

api() { # api <methode> <pfad> [daten]
  local method="$1" path="$2" data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" -d "$data" "https://api.github.com$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" "https://api.github.com$path"
  fi
}

# ---------------------------------------------------------------- 4) Konto/Organisation bestimmen
ACC_TYPE="User"
if [[ $USE_SSH -eq 0 ]]; then
  ACC_TYPE="$(api GET "/users/$OWNER" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("type","User"))' 2>/dev/null || echo User)"
  say "Zielkonto: $OWNER ($ACC_TYPE)"
else
  say "SSH-Modus: Zielkonto $OWNER (Repository muss bereits existieren)."
fi

# ---------------------------------------------------------------- 5) Repository anlegen (idempotent)
if [[ $USE_SSH -eq 1 ]]; then
  # Diagnose: Deploy-Key oder Kontoschluessel? GitHub begruesst Kontoschluessel mit "Hi <konto>!"
  # und Deploy-Keys mit "Hi <owner>/<repo>!" — das sagt direkt, wofuer der Schluessel gilt.
  # Achtung: 'ssh -T git@github.com' endet bei GitHub IMMER mit Exitcode 1 (kein Shell-Zugang);
  # ohne '|| true' wuerde 'set -e' das Skript hier vorzeitig beenden.
  GREETING="$(ssh -F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none -i "$SSH_KEY" -T git@github.com 2>&1 | head -1 || true)"
  say "GitHub meldet: ${GREETING:-keine Antwort}"
  case "$GREETING" in
    *"Hi $OWNER/$REPO!"*) say "  -> Deploy-Key fuer genau dieses Repository erkannt." ;;
    *"Hi $OWNER!"*)       say "  -> Kontoschluessel von $OWNER (greift fuer alle Repositories des Kontos)." ;;
    *"Permission denied"*) fail "Der SSH-Schluessel $SSH_KEY ist bei GitHub nicht hinterlegt." ;;
    *) say "  -> Hinweis: Begruessung passt nicht zu $OWNER/$REPO (Deploy-Key fuer ein anderes Repo?)." ;;
  esac
  # SSH kann keine Repositories anlegen: Existenz vorab pruefen (ls-remote).
  if ! GIT_SSH_COMMAND="ssh -F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none -i $SSH_KEY" \
       git ls-remote "git@$SSH_HOST:$OWNER/$REPO.git" >/dev/null 2>&1; then
    say ""
    say "Das Repository existiert (noch) nicht oder der SSH-Schluessel ist nicht hinterlegt."
    say "Bitte einmalig im Browser anlegen:  https://github.com/new  (Owner: $OWNER, Name: $REPO, Public)"
    say "Und den oeffentlichen Schluessel hinterlegen: https://github.com/settings/keys"
    say ""
    say "Oeffentlicher Schluessel:"
    cat ~/.ssh/id_ed25519_github.pub 2>/dev/null || say "(~/.ssh/id_ed25519_github.pub fehlt)"
    fail "Abbruch: Repository/Schluessel fehlt noch."
  fi
  say "Repository erreichbar — es wird per SSH gepusht."
else
  EXISTS="$(api GET "/repos/$OWNER/$REPO" | python3 -c 'import sys,json;print("yes" if json.load(sys.stdin).get("full_name") else "no")' 2>/dev/null || echo no)"
  if [[ "$EXISTS" == "yes" ]]; then
  say "Repository existiert bereits — es wird nur gepusht."
else
  say "Lege oeffentliches Repository an…"
  if [[ "$ACC_TYPE" == "Organization" ]]; then
    CREATE="$(api POST "/orgs/$OWNER/repos" "{\"name\":\"$REPO\",\"private\":false,\"description\":\"Linux PDF editor (Electron + FastAPI): pages, forms, digital signatures, smartcards\",\"has_issues\":true,\"has_wiki\":false}")"
  else
    CREATE="$(api POST "/user/repos" "{\"name\":\"$REPO\",\"private\":false,\"description\":\"Linux PDF editor (Electron + FastAPI): pages, forms, digital signatures, smartcards\"}")"
  fi
    echo "$CREATE" | python3 -c 'import sys,json;d=json.load(sys.stdin);sys.exit(0 if d.get("full_name") else 1)' \
      || fail "Repository konnte nicht angelegt werden (Antwort: $(echo "$CREATE" | head -c 300))"
  fi
fi

# ---------------------------------------------------------------- 6) Pushen (Token bleibt verborgen)
say "Push…"
if [[ $USE_SSH -eq 1 ]]; then
  ( cd "$SNAP"
    git remote add origin "git@$SSH_HOST:$OWNER/$REPO.git"
    GIT_SSH_COMMAND="ssh -F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none -i $SSH_KEY" \
      git push --force origin main >/dev/null 2>&1 \
      || fail "SSH-Push fehlgeschlagen. Bei einem Deploy-Key pruefen, ob 'Allow write access' gesetzt ist; sonst Schluessel/Rrepository pruefen. Schluessel: $SSH_KEY, Ziel: $OWNER/$REPO"
  )
else
( cd "$SNAP"
  git remote add origin "https://github.com/$OWNER/$REPO.git"
  # Zugangsdaten ueber einen temporaeren Askpass-Helfer: erscheint nie in der Kommandozeile/Logs.
  ASKPASS="$(mktemp)"; printf '#!/bin/sh\nprintf "%%s\\n" "$GIT_TOKEN_FOR_PUSH"\n' > "$ASKPASS"; chmod 700 "$ASKPASS"
  trap 'rm -f "$ASKPASS"' EXIT
  GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 GIT_TOKEN_FOR_PUSH="$TOKEN" \
    git -c credential.helper= push --force origin main >/dev/null 2>&1 \
    || fail "Push fehlgeschlagen (Rechte des Tokens? Organisation freigeschaltet?)"
)
fi

# ---------------------------------------------------------------- 7) Verifizieren
if [[ $USE_SSH -eq 1 ]]; then
  VERIFY="$(curl -sS -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$OWNER/$REPO")"
else
  VERIFY="$(api GET "/repos/$OWNER/$REPO")"
fi
echo "$VERIFY" | python3 -c '
import sys, json
d = json.load(sys.stdin)
name = d.get("full_name")
priv = bool(d.get("private"))
branch = d.get("default_branch")
print("  Repo:       " + str(name))
print("  Sichtbar:   " + ("PRIVAT (Fehler!)" if priv else "public"))
print("  Standard:   " + str(branch))
sys.exit(1 if priv else 0)
' || fail "Repository ist nicht oeffentlich."
if [[ $USE_SSH -eq 1 ]]; then
  REMOTE_SHA="$(GIT_SSH_COMMAND="ssh -F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none -i $SSH_KEY" git ls-remote "git@$SSH_HOST:$OWNER/$REPO.git" refs/heads/main | cut -f1)"
else
  REMOTE_SHA="$(git ls-remote "https://github.com/$OWNER/$REPO.git" refs/heads/main | cut -f1)"
fi
[[ "$REMOTE_SHA" == "$SNAP_COMMIT" ]] || fail "Remote-Commit $REMOTE_SHA weicht vom Schnappschuss $SNAP_COMMIT ab."
say "Verifiziert: github.com/$OWNER/$REPO ist oeffentlich und enthaelt den Schnappschuss ${SNAP_COMMIT:0:10}."
