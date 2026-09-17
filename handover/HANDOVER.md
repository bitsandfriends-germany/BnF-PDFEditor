# HANDOVER — B&F PDF Editor

> Ziel dieses Docs: Ein neuer Chat (oder neue Person) kann das Projekt **ohne Vorwissen**
> fortsetzen. Stand: **2026‑09‑14**. Alle Zahlen unten sind in dieser Sitzung verifiziert.

---

## 0. Projekt in einem Satz
Enterprise‑Linux‑PDF‑Editor (Fedora/Wayland) als **Electron‑Desktop‑App mit lokalem
Python‑Backend**: Bearbeiten, Signieren, Verschlüsseln, Schwärzen, Export und optional KI.

## 1. Der Maßstab (bitte immer gegenlesen)
Es gibt zwei Vertragsdokumente (nicht im Repo — sie kamen als Chat‑Prompts):
- **SYSTEM PROMPT PART 1 — Architektur**: Stack, Prozessmodell, Undo/Commands, Logging,
  KI‑Integration, 12‑Stufen‑Plan, `⚠️ CONFLICT`‑Protocol.
- **SYSTEM PROMPT PART 2 — Funktionsumfang** (der „feature contract"): was gebaut wird,
  mit `[V1]` / `[V1.1]` / `[OUT]`, plus §2 Querschnittsregeln, §3 Seitenbereichs‑Syntax.

**Bindende Regeln (Kurzform):**
- Jede Dokument‑Änderung = **`Command`** mit Snapshot + Label, läuft über `mutate()`.
- Nie das Original anfassen bis explizites Speichern; neue Dateien bekommen bei Kollision
  `_1`, `_2` (§2.6, `unique_filename`).
- **§2.7 Verschlüsselung bleibt erhalten**; was das nicht kann, sagt es **vor** dem Lauf.
- **§2.8 Signatur**: jede Mutation auf signiertem Dokument zeigt vorher eine Bestätigung.
- Labels **alle** über `t()` (Deutsch Default, de/en‑Parität wird getestet).
- **[V1.1]** bewusst nicht gebaut; **[OUT]** nie. Konflikte laut Protokoll melden, nie still
  auflösen.

## 2. Verifizierter Stand (diese Sitzung)
- **Frontend: vitest 352 Tests / 51 Dateien** grün.
- **tsc `node` und `web`: fehlerfrei** (strict inkl. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- **Backend: pytest 292** grün.
- **i18n‑Parität de/en: 468/468** Schlüssel gleich.
- **32 Renderer‑Komponenten.**
- **Git‑Repo (Git/Gitea):** `https://git.nc4.io/iambarth/bf-pdf-editor.git` (private, Branch `main`,
  `origin` eingerichtet). **Immer dorthin pushen:** `git push` (Tracking `origin/main`).
  Klonen: `git clone https://git.nc4.io/iambarth/bf-pdf-editor.git`. Authentifizierung über HTTPS‑
  Credential‑Store (`~/.git-credentials`, Nutzer `iambarth`) — bereits hinterlegt. `.gitignore`
  hält `node_modules/`, `.venv/`, `out/`, `dist/`, `Debug/`, Logs/Dumps draußen.

### Verifikations‑Befehle (aus Repo‑Root)
```bash
npx vitest run
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npx tsc -p tsconfig.node.json --noEmit
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npx tsc -p tsconfig.web.json --noEmit
ELECTRON_SKIP_BINARY_DOWNLOAD=1 backend/.venv/bin/python -m pytest backend/tests -q
node scripts/ui-registry.mjs        # UID-Register neu erzeugen
```

## 3. Verzeichnis
**ACHTUNG Pfad enthält `&`:** `/home/iambarth/Documents/Projects/B&F PDF Editor` — in der Shell
**immer in Anführungszeichen**. Ein `pgrep/pkill -f` muss den Suchstring mit Klammer trick
schreiben (z. B. `electron-[-]vite`, `backend/main[.]py`), sonst matched er den eigenen Shell‑Prozess.

## 4. Starten
- **`./start.sh`** — idempotenter Starter: legt bei Bedarf `node_modules` und `backend/.venv`
  (venv + `requirements.txt`, liegt im **Repo‑Root**, nicht in `backend/`) an, startet dann
  `electron-vite dev` (Electron‑Fenster **und** Python‑Backend automatisch). `SKIP_SETUP=1`
  überspringt die Checks.
- Desktop‑Eintrag (Dev): `pdf-editor-dev.desktop` (installiert unter
  `~/.local/share/applications/pdf-editor-dev.desktop`).
- **Auth‑Token:** wird vom **Supervisor generiert** (`backendSupervisor.ts`, `crypto.randomBytes`)
  und per Env ans Backend übergeben; der Renderer holt ihn via IPC `BACKEND_GET_AUTH`. Das Shell‑Env
  `PDF_EDITOR_BACKEND_TOKEN` wird **überschrieben** — nicht verwirren lassen.
- Backend lauscht auf einem **dynamischen** `127.0.0.1:<port>`; ermitteln: `ss -ltnp | grep pid=$(pgrep -f 'backend/main[.]py')`.

## 5. Stack
- **Frontend:** Electron `^33.4.11`, electron‑vite `^4`, React 18, TypeScript strict, zustand v5 (+immer),
  pdfjs‑dist `4.10.38` (Worker lokal gebundelt), vitest, lucide‑react, Tailwind.
- **Backend:** Python 3.14 (venv `backend/.venv`), FastAPI + uvicorn, PyMuPDF `import pymupdf as fitz`
  (`1.28.2`), **pikepdf `10.13`**, pyHanko `0.37`, cryptography. Pins in `requirements.txt`.
- **Renderer‑Schichten:** `components/*.tsx` → `lib/documents.ts` (typisierte Client‑Funktionen) →
  `lib/apiClient.ts` (`api.get/post/del/getBytes`, axios). Änderungen laufen über `lib/mutations.ts::mutate()`
  (macht §2.8‑Signatur‑Gate zuerst).

## 6. Was V1 ist (abgeschlossen + verifiziert)
Backend Steps 1–12 + V1‑Backend komplett; Renderer/UI verdrahtet. Highlights:
- §4 Lebenszyklus (Öffnen inkl. CLI/`.desktop`, Recent, Save/As/Copy atomar, Schließen mit 3 Optionen,
  Eigenschaften‑Panel), §5 Ansicht/Navigation (Zoom, Layouts, **Ansichts**rotation ≠ Seitendrehung,
  Suche mit Akzent‑unabhängig, Vollbild `F11`, Dark‑Mode + Invertieren, Tastatur‑Referenz).
- §6 Seiten (Multi‑Select, Drehen/Löschen/Umsortieren, Einfügen, **Merge** mit Outline/Formkollision/
  Verschlüsselung/Links, Extrahieren, Teilen, Duplizieren), §7 Stempel/Bilder/Wasserzeichen/Nummern/
  Bilder‑extrahieren/Flatten.
- §8 Annotationen (alle Typen, Listen‑Panel, Bearbeiten/Löschen, Alle entfernen).
- §9 Signaturen: Bibliothek, 3 Erstellquellen, **PKCS#12‑Signieren**, Zertifikats‑Übersicht,
  **Signatur‑Appearance** (sichtbar mit Text / unsichtbar / Bibliotheksgrafik im `/AP`), Verifikation
  in Klartext‑Urteil.
- §10 Verschlüsseln (AES‑256, User/Owner), Berechtigungen, Entsperren, **echte Schwärzung** (2‑stufig +
  Verifikationslauf), Bereinigen, Metadaten‑Scrubbing.
- §11 AcroForm erkennen/ausfüllen/speichern/flatten/zurücksetzen.
- §12 Export/Optimieren **voll bedienbar** (ExportDialog, s. §7 unten): Bilder, Text, **Bilder→PDF**,
  Komprimieren, **Linearisieren**.

## 7. Wichtige Architektur‑Entscheidungen & Fallen
- **§12 UI = `ExportDialog`** in `src/renderer/components/PagesDialogs.tsx`, Trigger `pg-export` in
  `PagesToolbar.tsx`, Modus‑Select: `images | text | compress | linearise | imagesToPdf`. Geöffnet über
  `useUiStore.pagesDialog === 'export'`. Bilder→PDF nutzt **`window.pdfEditor.pickImages()`**
  (Mehrfach‑Picker, über alle drei Bridge‑Schichten: `shared/ipc.ts` optional, `main` `multiSelections`, `preload`).
- **Linearisieren (C3):** pikepdf **kann** das (`pikepdf.save(linearize=True)` über gebündelte libqpdf;
  früher für „nicht baubar" gehalten — war falsch). Route `/export/linearise` in `routers.py`, lehnt
  **verschlüsselte** Dokumente **vor** dem Lauf ab (§2.7). `export_ops.linearise`.
- **C1 (PKCS#11) / C2 (NSS) = entschieden B:** Signieren **nur** aus **PKCS#12**; Smartcard/NSS im
  Signier‑Panel **sichtbar** als nicht unterstützt gekennzeichnet (`certs.sourceHint`). Begründung: kein
  Token da, Brücken nicht gepinnt. Siehe `docs/scope-conflicts.md` (dort auch C3 als gelöst vermerkt).
- **CORS (war ein echter Laufzeit‑Bug):** Renderer (`http://localhost:5173`) ruft Backend
  (`127.0.0.1:<dyn>`) cross‑origin auf; `X-Auth-Token` erzwingt Preflight → Backend hatte **kein** CORS →
  axios „Error: network" beim PDF‑Öffnen. Fix in `backend/main.py`: `CORSMiddleware` **als äußerste
  Middleware** (registriert **nach** den `@app.middleware`‑Dekoratoren), erlaubt nur `localhost`/`127.0.0.1:*`
  und `null` (`file://`), plus OPTIONS‑Preflight in `auth_gate` durchlassen. Regressionstests in
  `backend/tests/test_health.py`.
- **CSP:** `src/main/index.ts::buildCsp(isDev)` — streng in Produktion (`script-src 'self'`), im **Dev**
  gelockert (`'unsafe-inline'` + `ws/http://localhost:*` für Vite‑Preamble/HMR). `<meta>`‑CSP wurde aus
  `index.html` **entfernt** (Header besitzt die CSP, umgebungsabhängig).

## 8. UI‑UID‑System (wichtig für die Zusammenarbeit)
- **`data-testid` = die UID** eines Bedienelements, **global eindeutig** (200 UIDs: 181 statisch + 19 dynamisch
  wie `thumb-item-${index}`).
- **Register:** `docs/ui-registry.md` — Tabelle `UID → Datei:Zeile → Beschriftung`. Neu erzeugen: `npm run ui-registry`.
- **Guard:** `tests/renderer/uiRegistry.test.ts` fällt durch bei UID‑losem Control oder doppelter UID.
- **Nutzung:** Der Nutzer nennt eine UID (z. B. `tb-zoom-select`, `export-run`), der Assistent findet sie über
  Datei:Zeile im Register und bearbeitet genau das. Beispiel‑Konvention: `tb-*` TopBar, `sidebar-*`, `menu-*`,
  `<dialog>-run`/`<dialog>-expr` pro Dialog, `ai-*`, `settings-*`, `debug-*`, `meta-*`, `search-*`.
- **UIDs in der GUI sichtbar (Dev-Overlay):** `Debug-Panel` öffnen (**Strg+Shift+D**) → Button
  **„UIDs anzeigen"** (`debug-show-uids`) blendet über jedem `data-testid`-Element ein Label ein
  (nur im Dev-Build, `import.meta.env.DEV`). Quelle: `src/renderer/components/UidOverlay.tsx`
  (scannt `[data-testid]` inkl. Void-Elemente, `pointer-events:none`, räumt alle Listener beim
  Ausschalten auf). So kann der Nutzer eine UID direkt ablesen und benennen.

## 9. UI‑Screenshot + Vision‑Prüfung (Neu)
- **App schreibt Dev‑Screenshots:** `src/main/index.ts::scheduleUiCapture()` ruft `webContents.capturePage()`
  bei Load und bei jedem Reload (`Strg+R`) → `Debug/ui-load-<stempel>.png` + `Debug/ui-latest.txt`. Nur in Dev.
  (Externer `import`/`grim`‑Weg war auf diesem System kaputt/unvorhanden.)
- **Vision ansehen:** `scripts/vision-look.py` schickt einen Screenshot an ein **lokales Vision‑Modell** und
  druckt die Beschreibung — funktioniert, ohne dass die Harness das Chat‑Modell als bildfähig führt:
  ```bash
  backend/.venv/bin/python scripts/vision-look.py                 # nutzt Debug/ui-latest.txt
  backend/.venv/bin/python scripts/vision-look.py "Was zeigt die Seitenleiste?"
  ```
  Defaults: `VISION_BASE_URL=http://127.0.0.1:11434/v1`, `VISION_MODEL=qwen3.8-unsloth-mtp:q4`
  (überschreibbar per Env). **Verifiziert:** beschreibt die UI korrekt.
- **Natives `read_image`/Vision‑Subagent aktivieren:** in `~/.dsh/settings.yaml` dem Modell‑Eintrag
  `input: [text, image]` hinzufügen (Beispiel vorhanden: `bigpc1-gemma4` deklariert das bereits).
  Das aktuelle Chat‑Modell `unsloth/Qwen3.8-Flash-Next-FP8` hat **kein** `input:` → Harness blockt
  `read_image`, obwohl der Endpunkt Vision beherrscht. Der lokale Qwen `qwen38llmlocal`
  (`127.0.0.1:11434`) kann Vision (direkt getestet).

## 10. Offene Punkte / nächste Schritte
1. **App‑interne Vision ist noch ein Stumpf** (nicht zu verwechseln mit §9 oben, das ist *mein* Prüfen):
   Die KI‑Panel‑Funktion „Bereich auswählen" existiert (Overlay setzt `pendingRegion`, `ai-select-region`,
   `useAiStore.setRegion`), aber: `ChatRequest` hat **kein Bild‑Feld**, `stream_chat` baut nur Text,
   `gateway.describe_vision` wird **nirgends aufgerufen**, und `visionConfigured` verlangt ein **separat
   konfiguriertes** `visionModel`. Zum Aktivieren: (a) Config erlauben, dass Vision das **Text‑Modell
   mitbenutzt** (Qwen kann Vision), (b) Region im Renderer zu PNG rastern (pdfjs Offscreen +
   `viewport.convertToViewportRectangle`), (c) `image` im `/ai/chat` annehmen und einen Vision‑Stream‑Pfad
   bauen, (d) UI‑Toggle „Vision (nutzt gleiches Modell)". Backend‑Helfer vorhanden: `build_vision_message`,
   `describe_vision`.
2. **Git initialisieren** (s. §2).
3. **[V1.1]** bewusst ausstehend laut Vertrag: Tabs/Multi‑Doc, Bookmark‑Bearbeitung, Zuschnitt/Skalierung/N‑up,
   Kopf-/Fußzeilen/Bates, Antwort‑Kommentare/XFDF, FDF/CSV, TSA/RFC‑3161, Multi‑Sign, PDF/A, Office→PDF,
   Dokumentvergleich, Batch. **[OUT]** nie bauen (Text‑in‑Place, Vektorbearbeitung, PDF→Office, XFA,
   Form‑Designer, Cloud, Kollaboration, Booklet, Overlay, Zertifizierung, Remote‑Signing, Win/mac).

## 11. Datei‑Index (die wichtigsten)
- Backend: `backend/main.py` (App, CORS, Auth‑Gate, Health), `backend/routers.py` (PDF‑Routen),
  `backend/export_ops.py` (Export/Komprimieren/`linearise`/Bilder→PDF), `backend/crypto_ops.py`
  (Signieren/Verifizieren), `backend/redaction*.py`/`security*.py`, `backend/pagerange*.py`,
  `backend/ai/*` (config/gateway/client/router — Stumpf §10.1), `backend/tests/*`.
- Frontend‑Bridge: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts` (CSP, Screenshot, Fenster),
  `src/main/backendSupervisor.ts` (Token/Spawn), `src/main/platform.ts` (Wayland‑Flags).
- Frontend‑UI: `src/renderer/components/*.tsx` (u. a. `PagesDialogs.tsx` = Dialoge inkl. ExportDialog,
  `PagesToolbar.tsx`, `TopBar.tsx`, `Sidebar.tsx`, `CertificatePanel.tsx`, `AiPanel.tsx`, `AnnotationListPanel.tsx`),
  `src/renderer/lib/{documents,apiClient,mutations,pdfjs,pdfCoords,aiClient}.ts`,
  `src/renderer/store/{useAppStore,useUiStore,useAiStore}.ts`, `src/renderer/locales/{de,en}.json`.
- Werkzeug/Artefakte: `start.sh`, `pdf-editor-dev.desktop`, `scripts/ui-registry.mjs`,
  `scripts/vision-look.py`, `tests/renderer/uiRegistry.test.ts`, `docs/ui-registry.md`, `docs/scope-conflicts.md`.

## 12. Kurz-Kochrezept für die neue Sitzung
1. Repo‑Pfad in Quotes; Repo existiert bereits (s. §2). Fortsetzen: `git clone …/bf-pdf-editor` oder
   `git pull`. **Änderungen immer nach `git push` zu `origin` (main).**
2. `./start.sh` → Fenster + Backend. PDF öffnen → muss gehen (CORS gefixt).
3. Vor jedem „fertig": die vier Verifikations‑Befehle aus §2 + `node scripts/ui-registry.mjs`.
4. UI ansehen: Reload drücken, dann `backend/.venv/bin/python scripts/vision-look.py`.
5. Element ändern: UID aus `docs/ui-registry.md` nennen → Datei:Zeile öffnen → bearbeiten → Guard/Test grün.
6. Gegen PART 1/PART 2 prüfen; [V1.1]/[OUT] respektieren; Konflikte melden statt still lösen.

---

## 13. PART 3 — Funktionsverifikation & Viewer-Layout (läuft, Goal aktiv)

Neuer Maßstab (PART 3): ein Feature gilt erst als fertig, wenn sich das **PDF auf der Platte**
wie spezifiziert geändert hat — bewiesen durch einen Test, der (1) über den **echten Pfad**
(HTTP-Endpoint) läuft, (2) die geschriebene Datei mit einer **zweiten Bibliothek** erneut öffnet
(PyMuPDF schreiben → pikepdf prüfen oder umgekehrt), (3) das prüft, was sich **nicht** ändern darf.

**Stand dieser Runde:**
- **§7.3 Anhängen/Merge: gefixt + bewiesen.** Neu `backend/tests/test_merge_verify.py` (4 Tests, grün):
  echter Pfad `POST /pages/merge` → `/document/save`, Prüfung mit pikepdf (Seitenzahl, `/Outlines`)
  + PyMuPDF-erneutes-Öffnen der **geschriebenen** Datei (Textreihenfolge, TOC, Links) + pikepdf
  AcroForm-Feldnamen. **Echten Fehler gefunden & behoben:** `merge_pdf` hat die **Gliederung (TOC)
  des angehängten Dokuments verworfen**. Fix in `backend/pdflib.py::merge_pdf`: Ziel- + Quellen-TOC
  einfangen, Quellen-Einträge um alte Seitenzahl verschieben, kombinierte TOC setzen. Belegte
  Nebeneffekte bleiben korrekt: interne Links remappen (0→1, 2→3), Feldnamen werden **nicht** umbenannt.
- Backend-Suite **296 grün** (292 + 4). Keine Regression.
- **Bekannte Lücke (ehrlich):** bestehende `test_pages_ops.py` prüft Routen nur über `/document/pages`
  (derselbe In-Memory-Zustand) und nur mit fitz → **Self-Lib**, die Datei auf Platte nie mit 2. Bibliothek
  verifiziert. Wird Zug um Zug auf den §3-Standard gehoben (rotate, delete, reorder, insert, extract, split).
- **Offen (nächste Runden):** Verifikations-Matrix (§7.1), `REMOVED — NOT IMPLEMENTED` (§7.2),
  Viewer-Layout (§4: echte Seitengrößen statt Platzhalter, Fit-Width-Default, seitengroße
  Virtualisierungs-Platzhalter, sichtbare Seitenzahlen, Anker-treuer Zoom), Toolbar-Gruppen (§5),
  Befehls-Register + Kontextmenüs (§6), Playwright-E2E je Feature.
- Fortschritt & Plan: `.agent-state/part3-verification/HANDOFF.md` (+ `checkpoints/`).
