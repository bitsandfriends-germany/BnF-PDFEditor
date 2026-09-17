# Appstarter (ohne Terminal)

    ./scripts/appstarter/install.sh

Danach startet die App per:

- **App-Menue / Einstellungen:** "B&F PDF Editor" (auch als PDF-Standardanwendung nutzbar)
- **Dateimanager:** Doppelklick auf die App oder (mit zugeordnetem Mime-Type) auf eine PDF
- **Kommandozeile (falls doch):** `gtk-launch bf-pdf-editor.desktop`

Dateien nach der Installation:

- `~/.local/bin/bf-pdf-editor` — Wrapper; Log: `~/.local/share/pdf-editor/app.log`
- `~/.local/share/applications/bf-pdf-editor.desktop` — Verknuepfung (Terminal=false)

Nach jedem neuen Build (`npm run build` + `electron-builder --dir`) ist kein erneutes
Installieren noetig — der Wrapper zeigt auf `dist/electron/linux-unpacked` und findet
den aktuellen Stand. Bei Umzug des Projektordners einmal neu ausfuehren.
