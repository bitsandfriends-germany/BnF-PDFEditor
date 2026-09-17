import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { api, ApiError, sseStream } from '@/lib/apiClient'
import type { DocumentState } from '@/lib/apiTypes'
import type { BackendStatus } from '@shared/ipc'

// ---- Typen exakt nach Section 3 (Command traegt nur Metadaten, nie Ruecknahme-Logik) ----
export type CommandType =
  | 'ROTATE_PAGE'
  | 'DELETE_PAGE'
  | 'REORDER_PAGES'
  | 'MERGE_PDF'
  | 'STAMP_IMAGE'
  | 'IMAGE_OBJECT'
  | 'SET_METADATA'
  | 'ADD_ANNOTATION'
  | 'SET_OUTLINE'
  | 'REDACT_REGIONS'
  | 'ROTATE_SELECTION'
  | 'DELETE_SELECTION'
  | 'DUPLICATE_PAGES'
  | 'INSERT_PAGES'
  | 'STAMP_TEXT'
  | 'PAGE_NUMBERS'
  | 'WATERMARK'
  | 'SANITIZE'
  | 'SCRUB_METADATA'
  | 'FLATTEN'
  | 'ENCRYPT'
  | 'SIGN'
  | 'REMOVE_SIGNATURES'
  | 'REMOVE_ANNOTATIONS'
  | 'EDIT_ANNOTATION'
  | 'DELETE_ANNOTATION'
  | 'FILL_FORM'
  | 'RESET_FORM'

export interface Command {
  id: string
  seq: number
  type: CommandType
  payload: unknown
  label: string // z.B. "Seite 4 drehen" — Undo-Tooltip
  snapshotId: string // Zustand VOR diesem Command
  reversible: boolean // false: Signieren, Verschuesseln
}

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
  correlationId?: string | undefined
  details?: string | undefined
  persistent: boolean // Fehler + Backend-Neustart bleiben bis zur Quittierung
  actionLabel?: string | undefined
  action?: (() => void) | undefined
}

const MAX_TOASTS = 6

interface AppState {
  backendStatus: BackendStatus
  restartCount: number
  crashModal: boolean

  docOpen: boolean
  readOnly: boolean
  dirty: boolean
  encrypted: boolean
  signedDoc: boolean // enthaelt digitale Signaturen -> Gate vor Mutationen (Section 2.8)
  pageCount: number
  currentPage: number
  canUndo: boolean
  canRedo: boolean
  undoDepth: number
  docVersion: number // steigt nach jeder Mutation -> pdfjs laedt die Arbeitskopie neu

  commands: Command[] // Undo-Stack-Metadaten (aelter -> jünger)
  redoCommands: Command[] // Redo-Zweig
  mutationLock: boolean

  toasts: Toast[]
}

interface AppActions {
  setBackendStatus: (status: BackendStatus, restartCount?: number) => void
  openCrashModal: () => void
  closeCrashModal: () => void

  applyDocumentState: (s: DocumentState) => void
  clearDocument: () => void
  setCurrentPage: (page: number) => void
  setPageCount: (n: number) => void
  setSigned: (v: boolean) => void
  bumpDocVersion: () => void

  beginMutation: () => boolean
  endMutation: () => void
  pushCommand: (cmd: Command) => void
  clearHistory: () => void

  addToast: (t: Omit<Toast, 'id' | 'persistent'> & { persistent?: boolean }) => string
  dismissToast: (id: string) => void
}

export type AppStore = AppState & AppActions

function freshDoc(): Pick<AppState, 'docOpen' | 'readOnly' | 'dirty' | 'encrypted' | 'signedDoc' | 'pageCount' | 'currentPage' | 'canUndo' | 'canRedo' | 'undoDepth' | 'docVersion' | 'commands' | 'redoCommands'> {
  return {
    docOpen: false,
    readOnly: false,
    dirty: false,
    encrypted: false,
    signedDoc: false,
    pageCount: 0,
    currentPage: 1,
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    docVersion: 1,
    commands: [],
    redoCommands: []
  }
}

export const useAppStore = create<AppStore>()(
  immer((set, get) => ({
    backendStatus: 'starting',
    restartCount: 0,
    crashModal: false,
    ...freshDoc(),
    mutationLock: false,
    toasts: [],

    setBackendStatus: (status, restartCount) =>
      set((s) => {
        s.backendStatus = status
        if (restartCount !== undefined) s.restartCount = restartCount
      }),
    openCrashModal: () => set((s) => { s.crashModal = true }),
    closeCrashModal: () => set((s) => { s.crashModal = false }),

    applyDocumentState: (doc) =>
      set((s) => {
        s.docOpen = doc.open
        s.readOnly = doc.readOnly
        s.dirty = doc.dirty
        s.encrypted = doc.encrypted
        s.canUndo = doc.canUndo
        s.canRedo = doc.canRedo
        s.undoDepth = doc.undoDepth
        // Einziger Ort, der die Seitenzahl nach Mutationen aktuell hält (E2E-Fund r29).
        s.pageCount = doc.pageCount
        s.currentPage = Math.min(Math.max(1, s.currentPage), Math.max(1, doc.pageCount))
      }),
    clearDocument: () => set((s) => Object.assign(s, freshDoc())),
    setCurrentPage: (page) =>
      set((s) => {
        if (s.pageCount === 0) return
        s.currentPage = Math.min(Math.max(1, page), s.pageCount)
      }),
    setPageCount: (n) =>
      set((s) => {
        s.pageCount = Math.max(0, n)
        s.currentPage = Math.min(Math.max(1, s.currentPage), Math.max(1, n))
      }),
    bumpDocVersion: () => set((s) => { s.docVersion += 1 }),

    setSigned: (v) => set((s) => { s.signedDoc = v }),

    beginMutation: () => {
      // true, wenn die Mutation ausgefuehrt werden darf; false, wenn schon eine laeuft.
      if (get().mutationLock || get().readOnly || !get().docOpen) return false
      set((s) => { s.mutationLock = true })
      return true
    },
    endMutation: () => set((s) => { s.mutationLock = false }),
    pushCommand: (cmd) =>
      set((s) => {
        s.commands.push(cmd)
        // Neue Mutation verzweigt die Historie: der Redo-Zweig wird verworfen.
        s.redoCommands = []
        s.canUndo = true
        s.canRedo = false
        s.undoDepth = s.commands.length
      }),
    clearHistory: () =>
      set((s) => {
        s.commands = []
        s.redoCommands = []
        s.canUndo = false
        s.canRedo = false
        s.undoDepth = 0
      }),

    addToast: (input) => {
      const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      const toast: Toast = { id, ...input, persistent: input.persistent ?? input.kind === 'error' }
      set((s) => {
        s.toasts.push(toast)
        // Kapazitaet: persistenten Eintraegen den Vorzug lassen, aelteste fluechtige zuerst verdrangen.
        if (s.toasts.length > MAX_TOASTS) {
          const idx = s.toasts.findIndex((t) => !t.persistent)
          if (idx !== -1) s.toasts.splice(idx, 1)
        }
      })
      return id
    },
    dismissToast: (id) =>
      set((s) => {
        s.toasts = s.toasts.filter((t) => t.id !== id)
      })
  }))
)

// ---- Toast-/Fehler-Helfer (Section 4C: kein stilles Scheitern, jeder Fehler -> Toast) ----
// "Details anzeigen" oeffnet die Debug-Konsole (Section 6) vorbefiltert auf die correlationId.
import { t } from '@/i18n'
import { useDebugStore } from '@/store/useDebugStore'

function detailsAction(correlationId?: string): { actionLabel: string; action: () => void } {
  return { actionLabel: t('toast.showDetails'), action: () => useDebugStore.getState().openFor(correlationId) }
}

export function notifyError(err: unknown, correlationIdFallback?: string): void {
  const store = useAppStore.getState()
  if (err instanceof ApiError) {
    const cid = err.correlationId ?? correlationIdFallback
    store.addToast({
      kind: 'error',
      message: err.message,
      correlationId: cid,
      details: err.code,
      ...detailsAction(cid)
    })
  } else {
    store.addToast({
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
      ...(correlationIdFallback ? { correlationId: correlationIdFallback } : {}),
      ...detailsAction(correlationIdFallback)
    })
  }
}

export function notifySuccess(message: string): void {
  useAppStore.getState().addToast({ kind: 'success', message })
}

// ---- Dokument-/Verlauf-Aktionen (sprechen nur den getypten Client an) ----
export async function refreshDocumentState(): Promise<void> {
  try {
    const state = await api.get<DocumentState>('/document/state')
    useAppStore.getState().applyDocumentState(state)
  } catch (err) {
    notifyError(err)
  }
  // Signatur-Status fuer das Section-2.8-Gate. Best-effort: ein Fehler hier darf den State-Refresh
  // nicht kippen; ohne Info gilt "nicht signiert" (Gate bleibt aus, wie zuvor).
  try {
    const sig = await api.get<{ signatures?: unknown[] }>('/document/signatures')
    useAppStore.getState().setSigned(Array.isArray(sig.signatures) && sig.signatures.length > 0)
  } catch {
    useAppStore.getState().setSigned(false)
  }
}

export async function performUndo(): Promise<void> {
  const st = useAppStore.getState()
  if (!st.beginMutation()) return
  try {
    const next = await api.post<DocumentState>('/document/undo')
    useAppStore.setState((s) => {
      const last = s.commands.pop()
      if (last) s.redoCommands.push(last)
      s.canUndo = next.canUndo
      s.canRedo = next.canRedo
      s.undoDepth = next.undoDepth
      s.dirty = next.dirty
    })
    useAppStore.getState().bumpDocVersion()
  } catch (err) {
    notifyError(err)
  } finally {
    useAppStore.getState().endMutation()
  }
}

export async function performRedo(): Promise<void> {
  const st = useAppStore.getState()
  if (!st.beginMutation()) return
  try {
    const next = await api.post<DocumentState>('/document/redo')
    useAppStore.setState((s) => {
      const nextCmd = s.redoCommands.pop()
      if (nextCmd) s.commands.push(nextCmd)
      s.canUndo = next.canUndo
      s.canRedo = next.canRedo
      s.undoDepth = next.undoDepth
      s.dirty = next.dirty
    })
    useAppStore.getState().bumpDocVersion()
  } catch (err) {
    notifyError(err)
  } finally {
    useAppStore.getState().endMutation()
  }
}

export { sseStream }
