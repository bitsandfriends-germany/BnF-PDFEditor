import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type PdfEditorBridge,
  type RendererLogInput,
  type BackendStatusSnapshot,
  type BackendAuth,
  type LogEntry
} from '@shared/ipc'

// Preload ist die einzige Bruecke. contextIsolation:true, sandbox:true, nodeIntegration:false
// (Section 2). Keine fs-, child_process-, netzwerkfaehigen Objekte werden exponiert.

const bridge: PdfEditorBridge = {
  // Drag&Drop: echter Dateipfad aus einer gedroppten File (webUtils statt entferntem File.path).
  pathForFile: (file: File) => { try { return webUtils.getPathForFile(file) } catch { return '' } },
  getAppVersion: () => ipcRenderer.invoke(IPC.APP_GET_VERSION) as Promise<string>,
  getPlatformInfo: () => ipcRenderer.invoke(IPC.APP_GET_PLATFORM),
  getBackendStatus: () => ipcRenderer.invoke(IPC.BACKEND_GET_STATUS) as Promise<BackendStatusSnapshot>,
  getBackendAuth: () => ipcRenderer.invoke(IPC.BACKEND_GET_AUTH) as Promise<BackendAuth | null>,
  onBackendStatus: (cb: (snapshot: BackendStatusSnapshot) => void) => {
    const listener = (_evt: unknown, snapshot: BackendStatusSnapshot): void => cb(snapshot)
    ipcRenderer.on(IPC.BACKEND_STATUS, listener)
    return () => {
      ipcRenderer.removeListener(IPC.BACKEND_STATUS, listener)
    }
  },
  onMenuCommand: (cb: (id: string) => void) => {
    const listener = (_evt: unknown, id: string): void => cb(id)
    ipcRenderer.on(IPC.MENU_COMMAND, listener)
    return () => {
      ipcRenderer.removeListener(IPC.MENU_COMMAND, listener)
    }
  },
  writeLog: (entry: RendererLogInput) => {
    // Nur den erlaubten, ts-/source-freien Rumpf durchreichen. Main stempelt Quelle + Zeitmarke.
    ipcRenderer.send(IPC.LOG_WRITE, entry)
  },
  openPdfDialog: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_PDF) as Promise<string | null>,
  savePdfDialog: (suggestedName: string) => ipcRenderer.invoke(IPC.DIALOG_SAVE_PDF, suggestedName) as Promise<string | null>,
  pickCertDialog: () => ipcRenderer.invoke(IPC.DIALOG_PICK_CERT) as Promise<string | null>,
  chooseDirectory: () => ipcRenderer.invoke(IPC.DIALOG_PICK_DIR) as Promise<string | null>,
  pickImage: () => ipcRenderer.invoke(IPC.DIALOG_PICK_IMAGE) as Promise<string | null>,
  // R75: Einstellungen (Render-Modus/Tooltips) aus dem Main-Prozess.
  getAppSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET) as Promise<import('@shared/ipc').AppSettingsSnapshot>,
  setAppSettings: (patch: Partial<{ renderMode: 'auto' | 'gpu' | 'software'; tooltips: boolean }>) =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, patch) as Promise<import('@shared/ipc').AppSettingsSnapshot>,
  onAppSettings: (cb: (snapshot: import('@shared/ipc').AppSettingsSnapshot) => void) => {
    const listener = (_evt: unknown, snapshot: import('@shared/ipc').AppSettingsSnapshot): void => cb(snapshot)
    ipcRenderer.on(IPC.SETTINGS_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(IPC.SETTINGS_CHANGED, listener)
    }
  },
  getSignatureGraphicPref: () => ipcRenderer.invoke(IPC.SIGGRAPHIC_GET) as Promise<{ path: string; name: string } | null>,
  setSignatureGraphicPref: (v: { path: string; name: string } | null) => ipcRenderer.invoke(IPC.SIGGRAPHIC_SET, v) as Promise<null>,
  pickImages: () => ipcRenderer.invoke(IPC.DIALOG_PICK_IMAGES) as Promise<string[] | null>,
  readImageAsBase64: (filePath: string) => ipcRenderer.invoke(IPC.FILE_READ_IMAGE, filePath) as Promise<string | null>,
  onLogLine: (cb: (entry: LogEntry) => void) => {
    const listener = (_e: unknown, entry: LogEntry): void => cb(entry)
    ipcRenderer.on(IPC.LOG_LINE, listener)
    return () => {
      ipcRenderer.removeListener(IPC.LOG_LINE, listener)
    }
  },
  logTail: (n: number) => ipcRenderer.invoke(IPC.LOG_TAIL, n) as Promise<LogEntry[]>,
  writeDebugDump: (content: string) => ipcRenderer.invoke(IPC.DEBUG_DUMP_WRITE, content) as Promise<string | null>,
  getCodegraph: () => ipcRenderer.invoke(IPC.CODEGRAPH_READ),
  getInitialFile: () => ipcRenderer.invoke(IPC.APP_GET_INITIAL_FILE) as Promise<string | null>,
  listRecent: () => ipcRenderer.invoke(IPC.RECENT_LIST) as Promise<Array<{ path: string; lastOpened: string; exists: boolean }>>,
  addRecent: (filePath: string) => ipcRenderer.invoke(IPC.RECENT_ADD, filePath) as Promise<void>,
  removeRecent: (filePath: string) => ipcRenderer.invoke(IPC.RECENT_REMOVE, filePath) as Promise<void>
}

contextBridge.exposeInMainWorld('pdfEditor', bridge)
