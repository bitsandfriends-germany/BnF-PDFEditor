import { app, BrowserWindow, dialog, ipcMain, session, Menu } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'
import { IPC, type RendererLogInput, type PlatformInfo, type BackendStatusSnapshot, type BackendAuth, type LogEntry } from '@shared/ipc'
import { buildMenuModel } from './menuModel'
import enLabels from '../renderer/locales/en.json'
import { initLogger, type LoggerHandle } from './logger'
import { planChromiumLaunch, detectWayland, type FlagEnv } from './platform'
import { SessionManager } from './sessionManager'
import { BackendSupervisor } from './backendSupervisor'
import { addRecent, removeRecent, recentWithExistence } from './recentFiles'
import { handleSecondInstance } from './singleInstance'
import { planRender, isGpuFailure, GPU_FAILURE_RESET_MINUTES } from './renderPlan'
import { readSettingsFile, writeSettingsFile, settingsPath, type AppSettings } from './appSettings'

// --- Wayland-/Ozone-Flags VOR app-Bereitschaft setzen (Section 1) ---
const env = process.env as unknown as FlagEnv
const launch = planChromiumLaunch(env)
for (let i = 0; i < launch.switches.length; i++) {
  const arg = launch.switches[i] as string
  const m = /^--([^=]+)=(.*)$/.exec(arg)
  if (m) app.commandLine.appendSwitch(m[1] as string, m[2] as string)
}
if (launch.extraFeatures.length > 0) {
  app.commandLine.appendSwitch('enable-features', launch.extraFeatures.join(','))
}

// --- R75: Render-Modus VOR app-Bereitschaft anwenden (Hardware-Beschleunigung ist zur Laufzeit
// nicht umschaltbar). Die Entscheidung kommt aus den persistenten Einstellungen plus gezaehlten
// GPU-Abstuerzen; 'auto' faellt nach mehreren Ausfaellen selbststaendig auf Software zurueck. ---
let appSettings: AppSettings = { renderMode: 'auto', tooltips: true, gpuFailures: 0 }
try {
  appSettings = readSettingsFile(settingsPath(app.getPath('userData')))
} catch {
  /* Defaults */
}
const renderPlan = planRender(appSettings.renderMode, appSettings.gpuFailures)
if (renderPlan.disableHardwareAcceleration) app.disableHardwareAcceleration()
for (const sw of renderPlan.switches) app.commandLine.appendSwitch(sw)

let logger: LoggerHandle | null = null
let mainWindow: BrowserWindow | null = null
let sessionManager: SessionManager | null = null
let supervisor: BackendSupervisor | null = null
let sessionId: string | null = null
let currentStatus: BackendStatusSnapshot = { status: 'starting' }
let shuttingDown = false

// CSP: in Produktion streng (script-src 'self'). Im Dev-Modus (electron-vite setzt
// ELECTRON_RENDERER_URL) laeuft der Renderer auf dem Vite-Dev-Server; plugin-react injiziert
// ein Inline-Preamble-Skript und HMR benoetigt ws://localhost — beides waere mit 'self' blockiert
// ("can't detect preamble"). Daher nur im Dev-Modus gelockert. Produktion bleibt unveraendert dicht.
function buildCsp(isDev: boolean): string[] {
  const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'"
  const connectSrc = isDev
    ? "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*"
    : "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*"
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    connectSrc,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ]
}

function enforceCsp(): void {
  const isDev = !!process.env['ELECTRON_RENDERER_URL']
  const cspHeader = buildCsp(isDev).join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspHeader]
      }
    })
  })
}

// Backend-Pfade: dev = Repo-Root (venv/python + main.py), paketiert (Step 12) = die per
// electron-builder ausgelieferte PyInstaller-onedir-Executable unter /usr/lib/pdf-editor/backend/.
// Vorrang: PDF_EDITOR_BACKEND_BIN (explizit), sonst packaged-onedir, sonst Quellbetrieb.
function resolveBackend(): { interpreter?: string; scriptPath?: string; frozenBinary?: string } {
  const envBin = process.env.PDF_EDITOR_BACKEND_BIN
  if (envBin && fs.existsSync(envBin)) return { frozenBinary: envBin }
  const onedir = path.join(process.resourcesPath, 'backend', 'pdf-editor-backend', 'pdf-editor-backend')
  if (fs.existsSync(onedir)) return { frozenBinary: onedir }
  const root = app.getAppPath()
  const scriptPath = process.env.PDF_EDITOR_BACKEND_MAIN ?? path.join(root, 'backend', 'main.py')
  const venvPython = path.join(root, 'backend', '.venv', 'bin', 'python')
  let interpreter = process.env.PDF_EDITOR_PYTHON ?? ''
  if (interpreter === '') interpreter = fs.existsSync(venvPython) ? venvPython : 'python3'
  return { interpreter, scriptPath }
}

// R75: Einstellungen schreiben (atomar) und den Render-Plan bei Bedarf neu bewerten.
function applySettings(patch: Partial<AppSettings>): AppSettings {
  appSettings = { ...appSettings, ...patch }
  try {
    writeSettingsFile(settingsPath(app.getPath('userData')), appSettings)
  } catch (err) {
    logger?.write(logger.entry({ level: 'warn', source: 'main', action: 'SETTINGS_WRITE_FAILED', error: { type: typeof err, message: String(err).slice(0, 200) } }))
  }
  const plan = planRender(appSettings.renderMode, appSettings.gpuFailures)
  mainWindow?.webContents.send(IPC.SETTINGS_CHANGED, { settings: appSettings, plan })
  return appSettings
}

/** Ein GPU-Prozess ist gestorben: zaehlen, persistieren und bei Schwelle die Automatik umschalten. */
function noteGpuFailure(reason: string | undefined): void {
  appSettings = { ...appSettings, gpuFailures: appSettings.gpuFailures + 1 }
  try {
    writeSettingsFile(settingsPath(app.getPath('userData')), appSettings)
  } catch {
    /* nicht kritisch */
  }
  const plan = planRender(appSettings.renderMode, appSettings.gpuFailures)
  mainWindow?.webContents.send(IPC.SETTINGS_CHANGED, { settings: appSettings, plan })
  logger?.write(
    logger.entry({
      level: 'warn',
      source: 'main',
      action: 'GPU_PROCESS_GONE',
      payload: { reason: reason ?? 'unbekannt', gpuFailures: appSettings.gpuFailures, effective: plan.effective }
    })
  )
}

function pushStatus(snapshot: BackendStatusSnapshot): void {
  currentStatus = snapshot
  mainWindow?.webContents.send(IPC.BACKEND_STATUS, snapshot)
}

function registerIpc(): void {
  ipcMain.handle(IPC.SETTINGS_GET, () => ({ settings: appSettings, plan: planRender(appSettings.renderMode, appSettings.gpuFailures) }))
  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: Partial<AppSettings>) => {
    const next = applySettings(patch)
    return { settings: next, plan: planRender(next.renderMode, next.gpuFailures) }
  })
  ipcMain.handle(IPC.APP_GET_VERSION, () => app.getVersion())
  ipcMain.handle(IPC.APP_GET_PLATFORM, (): PlatformInfo => {
    return {
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      wayland: detectWayland(process.env as unknown as FlagEnv),
      ozoneHint: process.env.ELECTRON_OZONE_PLATFORM_HINT ?? null,
      username: os.userInfo().username
    }
  })
  ipcMain.handle(IPC.BACKEND_GET_STATUS, (): BackendStatusSnapshot => currentStatus)
  // Liefert Basis-URL + lokales Guard-Token an den Renderer-Client, sobald bereit; sonst null.
  ipcMain.handle(IPC.BACKEND_GET_AUTH, (): BackendAuth | null => {
    const baseUrl = supervisor?.getBaseUrl()
    const token = supervisor?.getAuthToken()
    return baseUrl && token ? { baseUrl, token } : null
  })
  // Native Dateialoge im Main-Prozess (Section 2: der Renderer bekommt nie fs-Zugriff, nur den Pfad).
  ipcMain.handle(IPC.DIALOG_OPEN_PDF, async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: 'PDF öffnen',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.DIALOG_SAVE_PDF, async (_e, suggestedName: string): Promise<string | null> => {
    const res = await dialog.showSaveDialog({
      title: 'Speichern unter',
      defaultPath: suggestedName,
      // Ueberschreib-Warnung: plattformunabhaengig im Renderer (/fs/exists + Bestaetigung),
      // da der GTK-Dialog dieses Flag nicht unterstuetzt.
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    return res.canceled ? null : (res.filePath ?? null)
  })
  ipcMain.handle(IPC.DIALOG_PICK_CERT, async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Zertifikat (.p12) wählen',
      properties: ['openFile'],
      filters: [{ name: 'PKCS#12', extensions: ['p12', 'pfx'] }]
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.DIALOG_PICK_DIR, async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Zielverzeichnis waehlen',
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.DIALOG_PICK_IMAGE, async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Bild waehlen',
      properties: ['openFile'],
      filters: [{ name: 'Bild', extensions: ['png', 'jpg', 'jpeg', 'svg'] }]
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.DIALOG_PICK_IMAGES, async (): Promise<string[] | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Bilder waehlen',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Bild', extensions: ['png', 'jpg', 'jpeg', 'svg'] }]
    })
    return res.canceled ? null : res.filePaths
  })
  const MAX_IMAGE_B64 = 32 * 1024 * 1024 // ~24 MB Datei -> Base64-Grenze
  ipcMain.handle(IPC.FILE_READ_IMAGE, (_e, filePath: string): string | null => {
    // Bild fuer Stempel/Einfguen als Base64. Pfad kommt aus dem eigenen Datei-Dialog; Grossen-
    // begrenzung verhindert, dass ein Riesenspiel ins Backend geblasen wird.
    try {
      if (!filePath || !fs.existsSync(filePath)) return null
      const st = fs.statSync(filePath)
      if (!st.isFile() || st.size === 0 || st.size > MAX_IMAGE_B64) return null
      return fs.readFileSync(filePath).toString('base64')
    } catch {
      return null
    }
  })
  ipcMain.handle(IPC.LOG_TAIL, (_e, n: number): LogEntry[] => {
    return logger?.readTail(Math.max(1, Math.min(500, n))) ?? []
  })
  ipcMain.handle(IPC.APP_GET_INITIAL_FILE, (): string | null => {
    // Per argv / Desktop-%f uebergebene PDF: erste existierende .pdf-Argument, die kein Switch ist.
    for (const a of process.argv.slice(1)) {
      if (a.startsWith('-')) continue
      if (a.toLowerCase().endsWith('.pdf') && fs.existsSync(a)) return a
    }
    return null
  })
  const recentDir = (): string => path.join(app.getPath('appData'), 'pdf-editor')
  ipcMain.handle(IPC.RECENT_LIST, () => recentWithExistence(recentDir()))
  ipcMain.handle(IPC.RECENT_ADD, (_e, filePath: string) => { addRecent(recentDir(), filePath); return null })
  ipcMain.handle(IPC.RECENT_REMOVE, (_e, filePath: string) => { removeRecent(recentDir(), filePath); return null })
  // R63: bevorzugte Signaturgrafik (Pfad + Name) ueberlebt Neustarts (Nutzerwunsch).
  ipcMain.handle(IPC.SIGGRAPHIC_GET, (): { path: string; name: string } | null => {
    try {
      const f = path.join(recentDir(), 'signature-graphic.json')
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (typeof j?.path === 'string' && typeof j?.name === 'string' && fs.existsSync(j.path)) return { path: j.path, name: j.name }
      return null
    } catch { return null }
  })
  ipcMain.handle(IPC.SIGGRAPHIC_SET, (_e, v: { path: string; name: string } | null) => {
    try {
      const f = path.join(recentDir(), 'signature-graphic.json')
      if (!v || typeof v.path !== 'string') { fs.rmSync(f, { force: true }); return null }
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, JSON.stringify({ path: v.path, name: v.name }), { encoding: 'utf8', mode: 0o600 })
    } catch { /* nicht kritisch */ }
    return null
  })
  ipcMain.handle(IPC.CODEGRAPH_READ, (): unknown => {
    // Read-only: den versionierten Codegraph aus dem App-Paket lesen (nur Debug-Dump, Section 6).
    try {
      const cgPath = path.join(app.getAppPath(), 'docs', 'codegraph.json')
      return JSON.parse(fs.readFileSync(cgPath, 'utf8'))
    } catch {
      return null
    }
  })
  ipcMain.handle(IPC.DEBUG_DUMP_WRITE, async (_e, content: string): Promise<string | null> => {
    const res = await dialog.showSaveDialog({
      title: 'KI-Diagnose-Dump exportieren',
      defaultPath: 'ai_debug_dump.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (res.canceled || !res.filePath) return null
    // Anonymisierung geschieht im Renderer; Main schreibt nur die fertigen Bytes (atomic).
    const tmp = res.filePath + '.tmp'
    fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(tmp, res.filePath)
    return res.filePath
  })
  ipcMain.on(IPC.LOG_WRITE, (_event, input: RendererLogInput) => {
    if (!input || typeof input !== 'object') return
    logger?.write(logger.entry({ ...input, source: 'renderer' }))
  })
}

function isDevBuild(): boolean {
  return !!process.env['ELECTRON_RENDERER_URL']
}

// Dev-Only: die UI als PNG nach Debug/ sichern, damit ein Assistent (mit Vision) die
// Oberflaeche selbst ansehen kann — statt sich nur auf Logs/Text-Dumps zu verlassen.
// Trigger: nach dem Laden und nach jedem Reload (Strg+R), mit kurzem Verzug bis zum
// fertigen Paint. Schreibt Debug/ui-<marke>.png und Debug/ui-latest.txt (Name + Hint).
function scheduleUiCapture(marker: string): void {
  const win = mainWindow
  if (!win || !isDevBuild()) return
  const dir = path.join(process.cwd(), 'Debug')
  setTimeout(() => {
    void (async () => {
      try {
        const img = await win.webContents.capturePage()
        fs.mkdirSync(dir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, '')
        const file = path.join(dir, `ui-${marker}-${stamp}.png`)
        fs.writeFileSync(file, img.toPNG())
        fs.writeFileSync(path.join(dir, 'ui-latest.txt'), `${file}\n`, 'utf-8')
        logger?.write(logger.entry({ level: 'info', source: 'main', action: 'UI_CAPTURE', payload: { path: file, size: img.getSize() } }))
      } catch (err) {
        logger?.write(logger.entry({ level: 'warn', source: 'main', action: 'UI_CAPTURE_FAILED', error: { message: err instanceof Error ? err.message : String(err) } }))
      }
    })()
  }, 2200)
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, '../preload/index.js')
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: 'B&F PDF Editor',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  // §6-Menü-Bar: ersetzt Electrons Default-Menü vollständig (das sonst Strg+R/Strg+W als
  // stumme Reload-/Close-Roles brächte — Datenverlustklasse) und wird aus dem generierten
  // Command-Katalog gebaut; Klick sendet nur die Befehls-id (Dispatch im Renderer über die
  // eine Registry). Edit-Roles sind reine Clipboard-Helfer, keine Aktions-Kopie.
  const model = buildMenuModel(enLabels as Record<string, string>, (id) => {
    mainWindow?.webContents.send(IPC.MENU_COMMAND, id)
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...model.map((bar) => ({ label: bar.label, submenu: bar.items.map((it) => ({ label: it.label, click: it.click })) })),
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' }, { role: 'quit' }
      ]
    }
  ]))

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send(IPC.BACKEND_STATUS, currentStatus)
    if (isDevBuild()) scheduleUiCapture('load')
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function cleanShutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  // Backend sauber beenden (SIGTERM, SIGKILL nach 3 s) und Session-Verzeichnis loeschen (Section 2).
  if (supervisor) {
    try {
      await supervisor.shutdown()
    } catch (err) {
      logger?.write(logger.entry({ level: 'error', action: 'BACKEND_SHUTDOWN_ERROR', error: err }))
    }
  }
  if (sessionManager && sessionId) sessionManager.removeSession(sessionId)
  app.quit()
}

function bootstrapBackendAndSession(): void {
  if (!logger) return
  sessionManager = new SessionManager()
  sessionId = randomUUID()

  // Startup-Sweep: Was ein Crash/SIGKILL hinterlassen hat, sieht man nur jetzt.
  const sweep = sessionManager.sweepOrphans(sessionId)
  if (sweep.deleted.length > 0) {
    logger.write(
      logger.entry({ level: 'info', action: 'SESSION_SWEEP', payload: { deleted: sweep.deleted.length } })
    )
  }
  if (sweep.recoverable.length > 0) {
    // Wiederherstellungs-Dialog kommt Step 9; vorerst sichtbar loggen.
    console.warn('[session] nicht gespeicherte Sitzungen gefunden:', sweep.recoverable.join(', '))
    logger.write(
      logger.entry({ level: 'warn', action: 'SESSION_RECOVERABLE', payload: { ids: sweep.recoverable } })
    )
  }
  sessionManager.createSession(sessionId)

  const backendPaths = resolveBackend()
  const frozen = backendPaths.frozenBinary
  if (!frozen) {
    const sp = backendPaths.scriptPath ?? ''
    if (!fs.existsSync(sp)) {
      logger.write(logger.entry({ level: 'error', action: 'BACKEND_SCRIPT_MISSING', payload: { scriptPath: sp } }))
      pushStatus({ status: 'crashed' })
      return
    }
  }
  supervisor = new BackendSupervisor({
    frozenBinary: frozen,
    interpreter: backendPaths.interpreter,
    scriptPath: backendPaths.scriptPath,
    logger,
    session: sessionManager,
    onStatus: pushStatus
  })
  supervisor.start()
}

// Einzelinstanz: verhindert zwei Backends/Sitzungen mit demselben Session-Layout.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // R74 Nutzerbefund ("Programm laesst sich nicht starten"): Die Single-Instance-Sperre beendet
    // jeden weiteren Start. Ohne nutzbares Fenster passierte dabei sichtbar nichts. Die Regel
    // (zeigen/fokussieren, sonst neu erzeugen) liegt testbar in main/singleInstance.ts.
    handleSecondInstance({
      mainWindow,
      allWindows: BrowserWindow.getAllWindows(),
      createWindow
    })
  })

  app.whenReady().then(() => {
    logger = initLogger((entry) => {
      // Live-Spiegel jeder Logzeile an alle Fenster (Debug-Konsole, Section 6). Kein fs-Schreiben.
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.LOG_LINE, entry)
    })
    logger.write(
      logger.entry({
        level: 'info',
        source: 'main',
        action: 'APP_START',
        payload: {
          version: app.getVersion(),
          ozone: launch.switches,
          features: launch.extraFeatures,
          waylandForcedOff: launch.waylandForcedOff,
          homedir: os.homedir()
        }
      })
    )
    registerIpc()

    // R75: GPU-Ausfaelle beobachten. Nach mehreren Ausfaellen schaltet die Automatik beim
    // NAECHSTEN Start auf Software-Rendering (Hinweis in den Einstellungen). Bleibt der Betrieb
    // GPU_FAILURE_RESET_MINUTES stabil, wird der Zaehler zurueckgesetzt (transiente Treiberfehler).
    app.on('child-process-gone', (_e, details) => {
      if (isGpuFailure(details.type, details.reason)) noteGpuFailure(details.reason)
    })
    if (renderPlan.effective === 'gpu' && appSettings.gpuFailures > 0) {
      setTimeout(() => {
        if (appSettings.gpuFailures > 0) {
          appSettings = { ...appSettings, gpuFailures: 0 }
          try {
            writeSettingsFile(settingsPath(app.getPath('userData')), appSettings)
          } catch {
            /* nicht kritisch */
          }
          logger?.write(logger.entry({ level: 'info', source: 'main', action: 'GPU_FAILURES_RESET', payload: { minutes: GPU_FAILURE_RESET_MINUTES } }))
        }
      }, GPU_FAILURE_RESET_MINUTES * 60_000).unref?.()
    }
    enforceCsp()
    createWindow()
    bootstrapBackendAndSession()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') void cleanShutdown()
})

app.on('before-quit', () => {
  logger?.write(logger.entry({ level: 'info', source: 'main', action: 'APP_QUIT' }))
})
