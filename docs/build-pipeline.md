# Build-Pipeline (R72)

Ein Einstiegspunkt für den kompletten Weg vom Quellcode zum installierten Paket:

```bash
npm run pipeline                 # Gates + Unit-Tests + Build + RPM-Paket
npm run pipeline:release         # zusätzlich Browser-E2E + Installation + Smoke-Test
bash scripts/build-pipeline.sh   # dasselbe direkt (alle Optionen siehe --help)
```

## Optionen

| Option | Wirkung |
| --- | --- |
| `--e2e` | Browser-E2E-Suite mitlaufen lassen (Vite-Dev-Server wird automatisch gestartet/beendet) |
| `--no-tests` | Gates und Tests überspringen (nur Build + Paket, z. B. für schnelle Iteration) |
| `--install` | RPM per `dnf` installieren und die installierte App starten/prüfen (braucht `sudo`) |
| `--with-docling` | Docling-Sidecar mitbauen (`WITH_DOCLING=1` an `scripts/build.sh`) |
| `--keep-going` | Nach fehlgeschlagener Stufe weitermachen (Diagnose; Exitcode bleibt 1) |

Umgebung: `VENV` (Python-Interpreter des Backends, Default `backend/.venv/bin/python`),
`E2E_PORT` (Default `5199`), `WITH_DOCLING=0|1`.

## Stufen

| # | Stufe | Werkzeug | Beweis |
| --- | --- | --- | --- |
| 1 | Preflight | Werkzeug-/Versionsprüfung, Plattenplatz, **Version aus `package.json` == `build/linux/pdf-editor.spec`** | Abbruch mit Klartext bei fehlendem Werkzeug oder Versionsdrift |
| 2 | Qualitätsgates | `verification-matrix.mjs`, `ui-registry.mjs`, `npm run typecheck` | Matrix-/Registry-Ausgabe im Log |
| 3 | Unit-Tests | `pytest backend/tests`, `vitest run` | Testzahlen im Log (aktuell 339 / 511) |
| 4 | Browser-E2E (`--e2e`) | Playwright `--project=browser` gegen echtes Python-Backend | „N passed" inkl. Karten-Lane übersprungen ohne `BFTEST_PIN` |
| 5 | Build + Paket | `scripts/build.sh`: electron-vite, PyInstaller-onedir, `electron-builder --dir`, `rpmbuild` | App-Binary und Backend-Bundle werden auf Existenz geprüft |
| 6 | Release-Artefakte | Kopie nach `dist/release/<version>/` + `SHA256SUMS` + `manifest.json` | Hash-Liste im Log |
| 7 | Installation + Smoke (`--install`) | `dnf reinstall --nogpgcheck` (bzw. `rpm -Uvh --replacepkgs`), `rpm -q/-V`, Pfadprüfung, **sha256-Vergleich installiert == gebaut**, Start der installierten App | Electron- **und** Backend-Prozess aus `/usr/lib/pdf-editor` laufen; die Instanz bleibt am Ende offen |

Jede Stufe schreibt ihr eigenes Log nach `dist/logs/pipeline-<UTC-Zeit>/`. Am Ende steht eine
Zusammenfassung mit Stufendauer, Ergebnissen und Artefaktpfaden; der Exitcode ist 1, sobald eine
Stufe fehlschlägt (die erste fehlerhafte Stufe wird benannt).

## Artefakte

```
dist/rpms/pdf-editor-<version>-<release>.<dist>.rpm     # Installationspaket (rpmbuild, Wrapper + Backend)
dist/rpms/pdf-editor-docling-<version>-...rpm           # optionales Unterpaket (nur mit --with-docling)
dist/electron/linux-unpacked/                           # App-Baum (für den .desktop-Starter aus R69)
dist/release/<version>/pdf-editor-...rpm                # Release-Kopie
dist/release/<version>/SHA256SUMS                       # Prüfsummen
dist/release/<version>/manifest.json                    # Version, Commit, Zeit, Größen, Hashes, Installationsbefehl
```

Installation (auch manuell):

```bash
# WICHTIG: bei gleicher Version+Release ist 'dnf install' ein No-op — immer reinstallieren,
# sonst bleibt der alte Stand liegen:
sudo dnf reinstall -y --nogpgcheck dist/release/<version>/pdf-editor-<version>-<release>.<dist>.rpm
/usr/bin/pdf-editor          # Wrapper setzt Wayland/X11-Flags; App-Menü: „PDF Editor"
```

Beim Start über das App-Menü oder `/usr/bin/pdf-editor` greift die Single-Instance-Sperre: eine
parallel laufende Entwicklungsinstanz (aus `dist/electron/linux-unpacked`) muss vorher beendet
werden, sonst beendet sich der neue Start sofort. Genau das macht die Installationsstufe selbst.

Die installierte App liegt unter `/usr/lib/pdf-editor/` (inkl.
`resources/backend/pdf-editor-backend/`), der Starter unter `/usr/bin/pdf-editor`, dazu
Desktop-Eintrag und Icon unter `/usr/share/…`.

## Pakete (R76)

| Paket | Zielsystem | Bau | Inhalt |
| --- | --- | --- | --- |
| `dist/rpms/x86_64/pdf-editor-<version>-<release>.<dist>.rpm` | Fedora/RHEL | `rpmbuild` (Spec `build/linux/pdf-editor.spec`) | App unter `/usr/lib/pdf-editor`, Starter `/usr/bin/pdf-editor`, Desktop+Icon, Backend-Bundle |
| `dist/electron/pdf-editor-<version>.<arch>.deb` | Debian/Ubuntu | `electron-builder --linux deb --prepackaged` | derselbe App-Baum unter `/opt/pdf-editor`, Desktop+Icon |
| `dist/release/<version>/` | — | Pipeline-Stufe 6 | beide Pakete + optionales Docling-RPM + `SHA256SUMS` + `manifest.json` (mit Installationsbefehlen) |

Der DEB-Bau braucht `dpkg-deb` (`dnf install dpkg`) und fuer das von electron-builder mitgelieferte
`fpm` die Bibliothek `libcrypt.so.1` (`dnf install libxcrypt-compat`). Fehlt eines davon, baut die
Pipeline nur das RPM und meldet das im Log. Beide Pakete entstehen aus **demselben** App-Baum
(`--prepackaged`), damit ihr Inhalt identisch ist — nachgeprueft per sha256 von `app.asar` und
Backend-Binary aus dem entpackten DEB gegen den Build (R76).

## Bekannte Startfallen (R74)

- **Single-Instance-Sperre:** Von der App darf nur EINE Instanz laufen. Ein zweiter Start beendet
  sich sofort mit Code 0 — sichtbar passiert dabei nichts. Die App holt ein vorhandenes Fenster
  jetzt zurueck (zeigen/fokussieren) und erzeugt eines, wenn keines mehr existiert. Fuer
  native Tests gilt: vorher alle Instanzen beenden, sonst haengt der Playwright-Start.
- **Verwaistes Backend:** Wird der Electron-Hauptprozess hart beendet (SIGKILL/Absturz), beendet
  sich das Python-Backend selbst (Elternprozess-Waechter, `BACKEND_ORPHANED` im Log). Sonst
  blockieren Reste die Sitzung und ein Neustart scheitert.
- **`dnf install` ist ein No-op** bei identischer Version+Release — deshalb `dnf reinstall`
  bzw. `rpm -Uvh --replacepkgs` (macht die Pipeline automatisch).

## Was die Pipeline bewusst NICHT tut

- Sie **signiert** das RPM nicht (kein GPG-Schlüssel im Repo) — daher `--nogpgcheck` beim lokalen
  Installieren. Für eine Verteilung bitte `rpm --addsign` mit eigenem Schlüssel ergänzen.
- Das RPM wird **nicht gestrippt** (`%global __os_install_post %{nil}` im Spec): der Paketinhalt ist
  damit byte-identisch zum Build und Stufe 7 kann installiert vs. gebaut per sha256 vergleichen.
  Ohne diese Einstellung hätte rpmbuild die ELF-Binaries nachträglich verändert und der Vergleich
  wäre nicht möglich (kleineres Paket vs. Verifizierbarkeit).
- Sie baut **kein** `.deb`: `dpkg` ist auf diesem System nicht installiert; die Stufe meldet das
  nur indirekt über `rpmbuild`. (electron-builder könnte `deb` erzeugen — Option bei Bedarf.)
- Sie installiert nur mit `--install`; ohne die Option bleibt das System unangetastet.

## CI-Hinweis

Die Pipeline ist bewusst ein Shell-Skript ohne CI-Bindung, damit sie lokal und in einem Runner
identisch läuft. Ein Runner braucht: Node + npm, das Backend-venv (`backend/.venv`), `rpmbuild`,
Playwright-Browser und (nur für `--install`) `sudo`. Für CI genügt
`bash scripts/build-pipeline.sh --e2e` und das Einsammeln von `dist/release/<version>/`.

## Tooltips (R75)

`node scripts/tooltip-coverage.mjs` (Teil der Gates) erzwingt, dass **jeder Befehl der Registry**
und **jede gelistete Shell-Kontrolle** in Deutsch und Englisch einen Hover-Hilfetext hat
(`tip.cmd.<id>` bzw. `tip.shell.<testid>` in `src/renderer/locales/{de,en}.json`). Die Zuordnung
der Shell-Kontrollen steht in `src/renderer/lib/tooltips.ts`. Die Texte erscheinen ueber die
Komponente `src/renderer/components/Tooltip.tsx` (Hover + Tastaturfokus) und lassen sich in den
Einstellungen abschalten. Der Wrapper ist bewusst layout-neutral (`display: contents`, Box per
`position: fixed`), weil ein `inline-flex`-Wrapper die Toolbar verschoben hat (im Browser gemessen).

## Einstellungen fuer Rendering und Tooltips (R75)

- **Rendering**: `Automatisch` (Default) nutzt die GPU und schaltet nach mehr als
  `GPU_FAILURE_THRESHOLD` (3, `src/main/renderPlan.ts`) GPU-Prozess-Abstuerzen selbst auf
  Software-Rendering um; `GPU` und `Software` erzwingen den Modus. Die Wahl liegt in
  `userData/settings.json`, wird VOR `app.whenReady` angewandt (Hardware-Beschleunigung ist zur
  Laufzeit nicht umschaltbar) und wirkt daher nach dem Neustart. Bleibt der Betrieb
  `GPU_FAILURE_RESET_MINUTES` (10) stabil, wird der Ausfallzaehler zurueckgesetzt.
- **Tooltips**: an/aus in den Einstellungen; die Texte stehen vollstaendig in `de.json`/`en.json`
  (`tip.cmd.*` fuer die 56 Registry-Befehle, `tip.shell.*` fuer die Shell-Kontrollen) und werden
  vom Guard `scripts/tooltip-coverage.mjs` erzwungen.
