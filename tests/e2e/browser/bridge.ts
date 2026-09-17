// Bridge-Stub fuer den Browser-E2E: ersetzt NUR die native IPC-Schicht (Dialog/Push), damit der
// Renderer ohne Electron bootet. HTTP zum echten Backend, echte UI, echte Stores, echte Dateien.
// Der Dateidialog liefert deterministisch die vom Test gesetzte Pfad-Variable.
import type { Page } from '@playwright/test'

export async function installBridgeStub(page: Page, backendUrl: string, token: string): Promise<void> {
  await page.addInitScript(
    ({ url, tok }) => {
      const snapshot = { status: 'ready' as const, port: Number(new URL(url).port) }
      const fixed: Record<string, unknown> = {
        getAppVersion: async () => 'e2e',
        // R75: Einstellungen im Browser-E2E (kein Main-Prozess). Der Stub merkt sich Aenderungen
        // im Fenster, damit Persistenz (z.B. Render-Modus nach dem Oeffnen) pruefbar ist.
        getAppSettings: async () => {
          const w = window as unknown as { __E2E_SETTINGS?: Record<string, unknown> }
          w.__E2E_SETTINGS ??= { renderMode: 'auto', tooltips: true, gpuFailures: 0 }
          return {
            settings: w.__E2E_SETTINGS,
            plan: { effective: 'gpu', disableHardwareAcceleration: false, switches: [], reason: 'E2E' }
          }
        },
        setAppSettings: async (patch: Record<string, unknown>) => {
          const w = window as unknown as { __E2E_SETTINGS?: Record<string, unknown> }
          w.__E2E_SETTINGS = { ...(w.__E2E_SETTINGS ?? { renderMode: 'auto', tooltips: true, gpuFailures: 0 }), ...patch }
          return {
            settings: w.__E2E_SETTINGS,
            plan: { effective: patch['renderMode'] === 'software' ? 'software' : 'gpu', disableHardwareAcceleration: patch['renderMode'] === 'software', switches: [], reason: 'E2E' }
          }
        },
        onAppSettings: (_cb: unknown) => () => undefined,
        getPlatformInfo: async () =>
          ({ platform: 'linux', arch: 'x64', electron: 'e2e', chrome: 'e2e', node: 'e2e', wayland: false, ozoneHint: null, username: 'e2e' }) as never,
        getBackendStatus: async () => snapshot,
        getBackendAuth: async () => ({ baseUrl: url, token: tok }),
        onBackendStatus: (cb: (s: unknown) => void) => {
          setTimeout(() => cb(snapshot), 0)
          return () => undefined
        },
        getInitialFile: async () => null,
        onLogLine: (_cb: unknown) => () => undefined,
        onMenuCommand: (_cb: unknown) => () => undefined,
        logTail: async () => [],
        listRecent: async () => [],
        addRecent: async () => undefined,
        removeRecent: async () => undefined,
        writeLog: () => undefined,
        writeDebugDump: async () => null,
        getCodegraph: async () => null,
        chooseDirectory: async () => (window as unknown as { __E2E_DIR?: string | null }).__E2E_DIR ?? null,
        pickCertDialog: async () => null,
        pathForFile: () => ((window as unknown as { __E2E_IMAGE?: string | null }).__E2E_IMAGE ?? ''),
        pickCertDialog: async () => ((window as unknown as { __E2E_CERT?: string | null }).__E2E_CERT ?? null),
        pickImage: async () => ((window as unknown as { __E2E_IMAGE?: string | null }).__E2E_IMAGE ?? null),
        getSignatureGraphicPref: async () => ((window as unknown as { __E2E_SIGPREF?: { path: string; name: string } | null }).__E2E_SIGPREF ?? null),
        setSignatureGraphicPref: async (v) => { (window as unknown as { __E2E_SIGPREF?: unknown }).__E2E_SIGPREF = v; return null },
        readImageAsBase64: async () => ((window as unknown as { __E2E_IMAGE_B64?: string | null }).__E2E_IMAGE_B64 ?? null),
        openPdfDialog: async () => {
          const w = window as unknown as { __E2E_OPEN_QUEUE?: string[]; __E2E_OPEN_PATH?: string | null }
          if (w.__E2E_OPEN_QUEUE && w.__E2E_OPEN_QUEUE.length > 0) return w.__E2E_OPEN_QUEUE.shift() as string
          return w.__E2E_OPEN_PATH ?? null
        },
        savePdfDialog: async (name: string) => (window as unknown as { __E2E_SAVE_PATH?: string | null }).__E2E_SAVE_PATH ?? `/tmp/e2e-save-${name}`
      }
      const stub = new Proxy(fixed as Record<string, unknown>, {
        get: (target, prop: string) => (prop in target ? target[prop] : async () => null)
      })
      ;(window as unknown as { pdfEditor: unknown }).pdfEditor = stub
    },
    { url: backendUrl, tok: token }
  )
}

export async function setDialogPaths(page: Page, openPath: string | null, savePath?: string | null): Promise<void> {
  await page.addInitScript(
    ({ o, s }) => {
      ;(window as unknown as { __E2E_OPEN_PATH?: string | null }).__E2E_OPEN_PATH = o
      if (s !== undefined) (window as unknown as { __E2E_SAVE_PATH?: string | null }).__E2E_SAVE_PATH = s
    },
    { o: openPath, ...(savePath !== undefined ? { s: savePath } : {}) }
  )
}

// Mehrere Dialoge nacheinander (z. B. Oeffnen UND PDF-Auswahl im Einfuegen-Dialog):
// die Warteschlange wird in Reihenfolge geleert, danach faellt der Stub auf openPath zurueck.
export async function setDialogQueue(page: Page, paths: string[], savePath?: string | null): Promise<void> {
  await page.addInitScript(
    ({ q, s }) => {
      ;(window as unknown as { __E2E_OPEN_QUEUE?: string[] }).__E2E_OPEN_QUEUE = q
      if (s !== undefined) (window as unknown as { __E2E_SAVE_PATH?: string | null }).__E2E_SAVE_PATH = s
    },
    { q: paths, ...(savePath !== undefined ? { s: savePath } : {}) }
  )
}

// Zielverzeichnis fuer den Extract-Dialog (DirField -> chooseDirectory).
export async function setDestDir(page: Page, dir: string): Promise<void> {
  await page.addInitScript((d) => {
    ;(window as unknown as { __E2E_DIR?: string }).__E2E_DIR = d
  }, dir)
}
export async function setStampImage(page: Page, imgPath: string, b64: string): Promise<void> {
  await page.addInitScript(([p, b]) => {
    (window as unknown as { __E2E_IMAGE?: string }).__E2E_IMAGE = p
    ;(window as unknown as { __E2E_IMAGE_B64?: string }).__E2E_IMAGE_B64 = b
  }, [imgPath, b64])
}
// R65: Signaturgrafik-Datei als Dialogergebnis (Panel holt sie via /signature-graphic).
export async function setGraphic(page: Page, imgPath: string): Promise<void> {
  await page.addInitScript((p) => {
    ;(window as unknown as { __E2E_GRAPHIC_PATH?: string }).__E2E_GRAPHIC_PATH = p
    ;(window as unknown as { __E2E_IMAGE?: string }).__E2E_IMAGE = p
  }, imgPath)
}

export async function setCert(page: Page, certPath: string): Promise<void> {
  await page.addInitScript((p) => {
    (window as unknown as { __E2E_CERT?: string }).__E2E_CERT = p
  }, certPath)
}

// Save-Ziel zur Laufzeit wechseln (SaveAs-Flows mit mehreren Zielen).
export async function setSavePath(page: Page, savePath: string | null): Promise<void> {
  await page.evaluate((p) => {
    ;(window as unknown as { __E2E_SAVE_PATH?: string | null }).__E2E_SAVE_PATH = p
  }, savePath)
}
