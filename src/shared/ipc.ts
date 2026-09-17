// Gemeinsame Typen zwischen Main und Preload/Renderer.
// Der Renderer importiert NUR diese Typen, niemals Backend-/Node-Code (Layering-Regel, Section 0.2).

export const IPC = {
  APP_GET_VERSION: 'app:get-version',
  APP_GET_PLATFORM: 'app:get-platform',
  LOG_WRITE: 'log:write',
  // Native Dateialoge laufen im Main-Prozess (Section 2); der Renderer erhaelt nur den Pfad.
  DIALOG_OPEN_PDF: 'dialog:open-pdf',
  DIALOG_SAVE_PDF: 'dialog:save-pdf',
  DIALOG_PICK_CERT: 'dialog:pick-cert',
  DIALOG_PICK_DIR: 'dialog:pick-dir',
  DIALOG_PICK_IMAGE: 'dialog:pick-image',
  DIALOG_PICK_IMAGES: 'dialog:pick-images',
  // Bildinhalt als Base64 (fuer Stempel/Bild einfuegen). Main liest die Datei, Renderer bekommt nur Base64.
  FILE_READ_IMAGE: 'file:read-image',
  BACKEND_GET_STATUS: 'backend:get-status',
  // Einmaliges Abholen von Basis-URL + lokalem Auth-Token fuer den axios-Client im Renderer.
  // Achtung: dies ist der LOKALE Guard-Token (Section 2), NICHT der Cloud-API-Key (Section 5.1).
  BACKEND_GET_AUTH: 'backend:get-auth',
  // Push-Kanal main -> renderer für Backend-Statuswechsel (kein Token im Payload!).
  BACKEND_STATUS: 'backend:status',
  // Debug-Konsole (Section 6): Live-Spiegel jeder Logzeile main -> renderer.
  LOG_LINE: 'log:line',
  // Letzte N Log-Eintraege aus der Datei (main ist der einzige Leser/Schreiber).
  LOG_TAIL: 'log:tail',
  // Diagnose-Dump-Datei im Main-Prozess schreiben (Renderer hat keinen fs-Zugriff).
  DEBUG_DUMP_WRITE: 'debug:dump-write',
  // Codegraph-Auszug fuer den Diagnose-Dump (read-only, Debug-Zweck).
  CODEGRAPH_READ: 'debug:codegraph-read',
  // Pfad einer per argv/.desktop (%f) uebergebenen Datei, einmalig abholbar.
  APP_GET_INITIAL_FILE: 'app:get-initial-file',
  RECENT_LIST: 'recent:list',
  RECENT_ADD: 'recent:add',
  RECENT_REMOVE: 'recent:remove',
  SIGGRAPHIC_GET: 'siggraphic:get',
  SIGGRAPHIC_SET: 'siggraphic:set',
  // §6: Menü-Bar-Klick -> Befehls-id an den Renderer (dispatch erfolgt dort über die Registry).
  MENU_COMMAND: 'menu:command',
  // R75: persistente Einstellungen (Render-Modus, Tooltips) + Aenderungs-Push an den Renderer.
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed'
} as const

// Auth-Snapshot fuer den HTTP-Client (Renderer). Enthaelt das lokale Guard-Token, damit der
// Renderer requests mit X-Auth-Token senden kann (Step 7). Der Cloud-API-Key laeuft nie hier.
export interface BackendAuth {
  baseUrl: string
  token: string
}

// Backend-Lifecycle (Section 2). 'ready' erst nach erfolgreichem /health.
export type BackendStatus = 'starting' | 'ready' | 'crashed'

export interface BackendStatusSnapshot {
  status: BackendStatus
  // Nur Status + Port/pid/Version — niemals das Auth-Token.
  port?: number
  pid?: number
  restartCount?: number
}

export type LogLevel = 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly'

// Struktur des JSONL-Logeintrags exakt nach Section 6.
// ts ist ISO-8601 UTC, source ist der Ursprung, error optional und nur bei Fehlern gesetzt.
export interface LogEntry {
  ts: string
  source: 'main' | 'renderer' | 'backend'
  level: LogLevel
  action: string
  correlationId?: string
  payload?: Record<string, unknown>
  error?: {
    type: string
    message: string
    stacktrace?: string
  }
}

export interface PlatformInfo {
  platform: NodeJS.Platform
  arch: string
  electron: string
  chrome: string
  node: string
  wayland: boolean
  ozoneHint: string | null
  // Systemnutzer als Standard fuer den Annotations-Autor (Section 8).
  username: string
}

// Was der Renderer an den Logger geben DARF. Kein `ts` und kein `source`: Die Zeitmarke und
// die Quelle setzt ausschliesslich der Main-Prozess (Single-Writer, Section 6). `error` ist
// bewusst `unknown` und wird im Main-Prozess strukturiert serialisiert.
export interface RendererLogInput {
  level: LogLevel
  action: string
  correlationId?: string
  payload?: Record<string, unknown>
  error?: unknown
}

// Die typisierte, über contextBridge exponierte API. Sie ist die einzige Brücke
// zwischen Renderer und Main. Keine fs-, keine netzwerkfähigen Primitives.
/** R75: Render-Modus + effektiver Plan (Quelle: src/main/renderPlan.ts). */
export type RenderModeSetting = 'auto' | 'gpu' | 'software'
export interface AppSettingsSnapshot {
  settings: { renderMode: RenderModeSetting; tooltips: boolean; gpuFailures: number }
  plan: { effective: 'gpu' | 'software'; disableHardwareAcceleration: boolean; switches: string[]; reason: string }
}

export interface PdfEditorBridge {
  getAppSettings(): Promise<AppSettingsSnapshot>
  setAppSettings(patch: Partial<AppSettingsSnapshot['settings']>): Promise<AppSettingsSnapshot>
  onAppSettings(cb: (snapshot: AppSettingsSnapshot) => void): () => void
  pathForFile: (file: File) => string
  getAppVersion(): Promise<string>
  getPlatformInfo(): Promise<PlatformInfo>
  getBackendStatus(): Promise<BackendStatusSnapshot>
  // Liefert Basis-URL + lokales Guard-Token fuer den HTTP-Client, sobald Backend bereit ist.
  // Rueckgabe null, solange das Backend noch nicht 'ready' ist.
  getBackendAuth(): Promise<BackendAuth | null>
  // Abo auf Statuswechsel; gibt eine Abmeldefunktion zurück. Kein Token im Snapshot.
  onBackendStatus(cb: (snapshot: BackendStatusSnapshot) => void): () => void
  onMenuCommand(cb: (id: string) => void): () => void
  // Fire-and-forget: strukturierte Logs aus dem Renderer an Main zum Mitschreiben.
  writeLog(entry: RendererLogInput): void
  // Native Dateialoge (Main-Prozess). Geben den gewaehlten absoluten Pfad oder null zurueck.
  openPdfDialog(): Promise<string | null>
  savePdfDialog(suggestedName: string): Promise<string | null>
  pickCertDialog(): Promise<string | null>
  // Zielverzeichnis waehlen (Extrahieren/Teilen/Export). Gibt absoluten Pfad oder null.
  chooseDirectory(): Promise<string | null>
  // Bilddatei waehlen (Bild einfuegen/Stempel). Gibt absoluten Pfad oder null.
  pickImage(): Promise<string | null>
  // Bilder mehrfach waehlen (Bilder->PDF). Gibt absolute Pfade oder null. Optional, damit bestehende Mocks gueltig bleiben.
  pickImages?(): Promise<string[] | null>
  // R63: bevorzugte Signaturgrafik persistent (App-Ordner). Optional fuer Mocks.
  getSignatureGraphicPref?(): Promise<{ path: string; name: string } | null>
  setSignatureGraphicPref?(v: { path: string; name: string } | null): Promise<null>
  //optional: gewaehltes Bild als Base64 (null bei Fehler/zu gross). Optional, damit bestehende Mocks gueltig bleiben.
  readImageAsBase64?(path: string): Promise<string | null>
  // Debug-Konsole (Section 6). Abo auf Live-Logzeilen; gibt eine Abmeldefunktion zurueck.
  onLogLine(cb: (entry: LogEntry) => void): () => void
  // Letzte N Log-Eintraege aus der Logdatei (zeitlich aufsteigend).
  logTail(n: number): Promise<LogEntry[]>
  // Diagnose-Dump als Datei schreiben via Dialog; gibt den geschriebenen Pfad oder null zurueck.
  writeDebugDump(content: string): Promise<string | null>
  // Read-only-Auszug des Codegraphs fuer den Dump (Struktur ohne Nutzdaten).
  getCodegraph(): Promise<unknown>
  // Einmalig: eine beim Start per argv uebergebene PDF-Pfad (Desktop %f). Sonst null.
  getInitialFile(): Promise<string | null>
  // Zuletzt geoeffnete Dateien (Section 4): Pfade + Zeitstempel, nur Metadaten.
  listRecent(): Promise<Array<{ path: string; lastOpened: string; exists: boolean }>>
  addRecent(filePath: string): Promise<void>
  removeRecent(filePath: string): Promise<void>
}
