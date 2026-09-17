#!/usr/bin/env bash
# Installiert den Appstarter ohne Terminal:
#  - ~/.local/bin/bf-pdf-editor        (Wrapper, schreibt Log nach ~/.local/share/pdf-editor/app.log)
#  - ~/.local/share/applications/bf-pdf-editor.desktop  (App-Menue/Einstellungen, Doppelklick)
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$REPO/dist/electron/linux-unpacked"
[ -x "$APP/pdf-editor" ] || { echo "Fehler: $APP/pdf-editor existiert nicht. Erst bauen (npm run build + electron-builder)."; exit 1; }

mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/pdf-editor"
cat > "$HOME/.local/bin/bf-pdf-editor" << WRAP
#!/usr/bin/env bash
# B&F PDF Editor Starter (ohne Terminal). Neu erzeugt von install.sh: $(date -Is)
APP="$APP"
mkdir -p "\$HOME/.local/share/pdf-editor"
exec "\$APP/pdf-editor" "\$@" >>"\$HOME/.local/share/pdf-editor/app.log" 2>&1
WRAP
chmod +x "$HOME/.local/bin/bf-pdf-editor"

cat > "$HOME/.local/share/applications/bf-pdf-editor.desktop" << DESK
[Desktop Entry]
Type=Application
Name=B&F PDF Editor
Comment=PDF betrachten, bearbeiten und digital signieren
Exec=$HOME/.local/bin/bf-pdf-editor %F
Icon=$APP/resources/icon.png
Terminal=false
Categories=Office;Viewer;
StartupWMClass=pdf-editor
MimeType=application/pdf;
DESK

command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "Installiert: App-Menue -> 'B&F PDF Editor'; Start auch via: gtk-launch bf-pdf-editor.desktop"
