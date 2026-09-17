# B&F PDF Editor

Ein vollständiger PDF-Editor für Linux (Electron + React im Frontend, Python/FastAPI-Backend mit
PyMuPDF, pikepdf und pyHanko). Schwerpunkt: Seitenoperationen, Formulare, digitale Signaturen
(PKCS#12 **und** PKCS#11-Smartcards, u. a. estnische ID-Karten), Verschlüsselung und eine
optional konfigurierbare KI-Unterstützung.

> **Sprache:** Code, Tests und Dokumentation sind auf Deutsch kommentiert. Dieses README fasst den
> Einstieg zusammen; eine kurze englische Übersicht steht am Ende.

## Funktionsumfang

**Betrachten & Navigieren** — Einzel-, fortlaufende und Doppelseitenansicht (mit Titelblatt),
Ansichtsdrehung unabhängig von der Seitendrehung, Zoom (Fit-Breite/Fit-Seite/Prozent), Textlayer mit
Auswahl und Kopieren, Suche, Seitenminiaturen mit Drag&Drop-Sortierung, Inhaltsverzeichnis,
Dokument-Infos und -Eigenschaften, Nachtmodus (Invertierung, rein visuell).

**Seitenoperationen** — Drehen, Löschen, Duplizieren, Einfügen/Anhängen (leer, Bild, PDF),
Extrahieren, Teilen, Sortieren, Export (Bilder/Text), Flatten, Seitenzahlen, Wasserzeichen, Text-
und Bildstempel, Bildobjekte direkt bearbeiten (Doppelklick).

**Anmerkungen & Formulare** — Notizen, Hervorheben, Unterstreichen, Durchstreichen, Wellenlinie,
Freitext, Redaktion (unwiderrufliches Schwärzen), Formularfelder ausfüllen und flachlegen.

**Signaturen** — Signieren mit PKCS#12-Dateien oder Smartcards (PKCS#11, inkl. PIN-Führung über
den Kartenleser), frei platzierbares Signaturfeld mit eigener Grafik, Name/Grund/Zeit im Feld,
Vertrauenskette und DSS/PDS-Einbettung ins PDF, Signaturprüfung (Integrität, Krypto, Vertrauen,
Änderungsstufe) mit Klartext-Erklärung, importierbare Vertrauensanker, Signaturbibliothek.

**Sicherheit** — AES-Verschlüsselung mit Passwort, Redaktion, Lesemodus, Mutationssperre für
signierte Dokumente.

**Weitere Extras** — Rendering-Modus (Automatik/GPU/Software mit automatischem Rückfall),
Hover-Tooltips für jede Funktion (abschaltbar), Deutsch/Englisch, Undo/Redo mit optionalem
Plattenverlauf, Kontextmenüs und Menüleiste aus einer einzigen Befehlsregistry, optionale
KI-Panels (Docling-Sidecar als separates Paket).

## Schnellstart (Entwicklung)

```bash
./start.sh          # richtet node_modules und backend/.venv ein und startet die App
```

Alternativ Schritt für Schritt:

```bash
npm install
python3 -m venv backend/.venv && backend/.venv/bin/pip install -r requirements.txt
npm run dev         # Electron-Fenster + Python-Backend
```

Voraussetzungen: Linux (Fedora getestet) mit Node 20+, Python 3.12+, `rpmbuild` für Pakete.

## Tests

```bash
backend/.venv/bin/python -m pytest backend/tests -q    # Backend
npx vitest run                                          # Renderer/Main (jsdom)
npx playwright test --project=electron                  # native App (braucht PDF_EDITOR_APP_PATH)
E2E_BROWSER=1 npx playwright test --project=browser     # echte UI + echtes Backend
node scripts/verification-matrix.mjs                    # Befehlsregistry <-> Beweis-Matrix
node scripts/ui-registry.mjs                            # UI-Elemente-Registry
node scripts/tooltip-coverage.mjs                       # Hilfetexte für alle Funktionen
```

Aktueller Stand: 341 Backend-Tests, 541 Unit-Tests, 58 Browser-E2E-Tests, 6 native Electron-Tests.
Die Echtkarten-Lane läuft nur mit gesetztem `BFTEST_PIN` (und verbraucht echte Kartensignaturen).

## Pakete bauen und installieren

```bash
npm run pipeline            # Gates + Tests + Build + RPM
npm run pipeline:release    # zusätzlich Browser-E2E + Installation + Smoke-Test
```

Ergebnis unter `dist/release/<version>/`: `.rpm` (Fedora/RHEL) und `.deb` (Debian/Ubuntu) samt
`SHA256SUMS` und `manifest.json`. Details: `docs/build-pipeline.md`.

## Architektur (Kurzfassung)

```
src/main/        Electron-Hauptprozess (Fenster, Menü, Backend-Supervisor, Einstellungen)
src/preload/     schmale, typisierte IPC-Brücke (contextIsolation, sandbox)
src/renderer/    React-Oberfläche (Viewer, Panels, Befehlsregistry, Stores)
src/shared/      gemeinsame Typen/IPC-Verträge
backend/         FastAPI-Backend (pdflib, crypto_ops, pkcs11_ops, form_ops, image_ops, ...)
tests/           Backend- (pytest), Unit- (vitest) und E2E-Tests (Playwright)
docs/            Architektur-, UI- und Verifikationsdokumentation
scripts/         Build-Pipeline, Guards, Starter-Installation
```

Regeln des Projekts: **jede** Funktion existiert nur, wenn sie vollständig verdrahtet und durch
einen benannten Test belegt ist (Befehlsregistry, UI-Registry, Tooltip-Abdeckung und die
Verifikationsmatrix werden als Guards erzwungen). Dokumentändernde Funktionen werden zusätzlich
gegen die echte Datei auf der Platte und mit einer zweiten Bibliothek geprüft.

## Sicherheit & Datenschutz

- Es sind **keine** Zugangsdaten, Tokens oder Schlüssel im Repository enthalten; Karten-PINs werden
  ausschließlich über die Umgebungsvariable `BFTEST_PIN` übergeben.
- Die Veröffentlichung erfolgt als **sauberer Schnappschuss** (ein Commit aus dem aktuellen Stand),
  damit ältere Test-Historie keine Zugangsdaten enthält — siehe `scripts/publish-github.sh`.
- Bitte eigene Karten-PINs niemals in Issues, Logs oder Commits schreiben.

## Repository

Quellcode und Releases: **https://github.com/bitsandfriends-germany/BnF-PDFEditor**

Veröffentlicht wird jeweils ein sauberer Schnappschuss des Arbeitsstands (siehe
`scripts/publish-github.sh`), damit keine Test-Zugangsdaten aus älteren Entwicklungsständen im
öffentlichen Verlauf landen.

## Lizenz

MIT — siehe [LICENSE](LICENSE).

---

## English summary

Linux PDF editor: Electron + React front end, FastAPI/PyMuPDF/pikepdf/pyHanko back end. Page
operations, annotations, forms, AES encryption, redaction, digital signatures with PKCS#12 and
PKCS#11 smart cards (including Estonian ID cards), signature validation with trust anchors and
DSS embedding, viewer layouts (single/continuous/facing), view rotation, rendering mode
auto/GPU/software, hover tooltips for every function (switchable), German/English UI.
Build and install with `npm run pipeline[:release]` (RPM and DEB under `dist/release/<version>/`).
Run tests with pytest, vitest and Playwright as shown above. Licensed under MIT.
