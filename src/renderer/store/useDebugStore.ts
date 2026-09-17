import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { LogEntry, LogLevel } from '@shared/ipc'

// Debug-Konsole (Section 6). Puffert die letzten Logzeilen (Live-Spiegel aus Main + Tail-Start)
// und haelt Offenzustand/Filter. Importiert bewusst keine anderen Stores — useAppStore darf
// therefore darauf zeigen (Toast "Details anzeigen"), ohne einen Zyklus zu bilden.

const MAX = 200
export type LevelFilter = 'all' | LogLevel
export type SourceFilter = 'all' | LogEntry['source']

interface DebugState {
  open: boolean
  entries: LogEntry[]
  level: LevelFilter
  source: SourceFilter
  focusCorrelationId: string | null
  initialised: boolean
  showUids: boolean
}

interface DebugActions {
  init: () => void
  toggle: () => void
  toggleUids: () => void
  openPanel: () => void
  closePanel: () => void
  openFor: (correlationId?: string) => void
  clearFocus: () => void
  setLevel: (l: LevelFilter) => void
  setSource: (s: SourceFilter) => void
  push: (e: LogEntry) => void
}

export type DebugStore = DebugState & DebugActions

export const useDebugStore = create<DebugStore>()(
  immer((set, get) => ({
    open: false,
    entries: [],
    level: 'all',
    source: 'all',
    focusCorrelationId: null,
    initialised: false,
    showUids: false,

    init: () => {
      if (get().initialised) return
      const bridge = window.pdfEditor
      bridge.onLogLine((e) => get().push(e))
      void bridge.logTail(MAX).then((tail) => {
        set((s) => {
          s.entries = tail.slice(-MAX)
          s.initialised = true
        })
      })
    },
    toggle: () =>
      set((s) => {
        s.open = !s.open
      }),
    toggleUids: () =>
      set((s) => {
        s.showUids = !s.showUids
      }),
    openPanel: () => set((s) => { s.open = true }),
    closePanel: () => set((s) => { s.open = false }),
    openFor: (cid) =>
      set((s) => {
        s.open = true
        s.focusCorrelationId = cid ?? null
        s.level = 'error'
      }),
    clearFocus: () => set((s) => { s.focusCorrelationId = null }),
    setLevel: (l) => set((s) => { s.level = l }),
    setSource: (src) => set((s) => { s.source = src }),
    push: (e) =>
      set((s) => {
        s.entries.push(e)
        if (s.entries.length > MAX) s.entries.splice(0, s.entries.length - MAX)
      })
  }))
)

// Angewendete Filter (rein), damit das Panel und die Tests dieselbe Logik teilen.
export function filterEntries(entries: LogEntry[], level: LevelFilter, source: SourceFilter, focusCorrelationId: string | null): LogEntry[] {
  return entries.filter((e) => {
    if (focusCorrelationId && e.correlationId !== focusCorrelationId) return false
    if (level !== 'all' && e.level !== level) return false
    if (source !== 'all' && e.source !== source) return false
    return true
  })
}
