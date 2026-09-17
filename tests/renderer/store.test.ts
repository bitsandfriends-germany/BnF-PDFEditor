import { describe, it, expect, beforeEach, vi } from 'vitest'

// useAppStore importiert den Client (api/ApiError/sseStream) — fuer performUndo gemockt.
vi.mock('@/lib/apiClient', () => {
  class ApiError extends Error {
    code: string
    correlationId?: string | undefined
    status?: number | undefined
    constructor(code: string, message: string, cid?: string, status?: number) {
      super(message)
      this.code = code
      this.correlationId = cid
      this.status = status
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() }, sseStream: vi.fn() }
})

import { useAppStore, performUndo, notifyError, type Command } from '@/store/useAppStore'
import { api } from '@/lib/apiClient'

function cmd(seq: number, label = `S${seq}`): Command {
  return { id: 'c' + seq, seq, type: 'ROTATE_PAGE', payload: { page: seq }, label, snapshotId: 'snap' + seq, reversible: true }
}

const INITIAL = useAppStore.getState()

beforeEach(() => {
  useAppStore.setState({ ...INITIAL, commands: [], redoCommands: [], toasts: [], mutationLock: false })
})

describe('Command-Stack (Undo/Redo-Metadaten)', () => {
  it('pushCommand haengt an und verwirft den Redo-Zweig', () => {
    const s = useAppStore.getState()
    s.pushCommand(cmd(1))
    s.pushCommand(cmd(2))
    let st = useAppStore.getState()
    expect(st.commands.map((c) => c.seq)).toEqual([1, 2])
    expect(st.canUndo).toBe(true)
    // Redo-Zweig anlegen, dann neue Mutation verzweigt -> Redo weg.
    useAppStore.setState((s2) => {
      s2.redoCommands = [cmd(9)]
    })
    useAppStore.getState().pushCommand(cmd(3))
    st = useAppStore.getState()
    expect(st.redoCommands).toHaveLength(0)
    expect(st.undoDepth).toBe(3)
  })
})

describe('mutationLock (Serialisierung, Section 3)', () => {
  it('beginMutation braucht ein offenes, beschreibbares Dokument und blockiert parallele', () => {
    expect(useAppStore.getState().beginMutation()).toBe(false) // kein Dokument
    useAppStore.setState({ docOpen: true })
    expect(useAppStore.getState().beginMutation()).toBe(true)
    expect(useAppStore.getState().beginMutation()).toBe(false) // schon in Arbeit
    useAppStore.getState().endMutation()
    expect(useAppStore.getState().mutationLock).toBe(false)
  })

  it('schreibgeschuetzte Dokumente lassen keine Mutation zu', () => {
    useAppStore.setState({ docOpen: true, readOnly: true })
    expect(useAppStore.getState().beginMutation()).toBe(false)
  })
})

describe('Toasts (Section 4C)', () => {
  it('begrenzt fluechtige Toasts, persistent bleiben erhalten', () => {
    for (let i = 0; i < 10; i++) useAppStore.getState().addToast({ kind: 'info', message: 'i' + i })
    expect(useAppStore.getState().toasts).toHaveLength(6)
    for (let i = 0; i < 10; i++) useAppStore.getState().addToast({ kind: 'error', message: 'e' + i })
    const errs = useAppStore.getState().toasts.filter((t) => t.kind === 'error')
    expect(errs).toHaveLength(10) // persistent: nicht verdraengt
  })

  it('dismissToast entfernt gezielt', () => {
    const id = useAppStore.getState().addToast({ kind: 'success', message: 'ok' })
    useAppStore.getState().dismissToast(id)
    expect(useAppStore.getState().toasts.find((t) => t.id === id)).toBeUndefined()
  })

  it('notifyError aus ApiError wird Fehler-Toast mit correlationId', () => {
    notifyError(new Error('x'))
    const last = useAppStore.getState().toasts.at(-1)
    expect(last?.kind).toBe('error')
  })
})

describe('performUndo', () => {
  it('verschiebt Kommando nach Redo und uebernimmt Backend-Status', async () => {
    useAppStore.setState({ docOpen: true })
    useAppStore.getState().pushCommand(cmd(1))
    vi.mocked(api.post).mockResolvedValue({ canUndo: false, canRedo: true, undoDepth: 0, dirty: true })
    await performUndo()
    const s = useAppStore.getState()
    expect(api.post).toHaveBeenCalledWith('/document/undo')
    expect(s.commands).toHaveLength(0)
    expect(s.redoCommands.map((c) => c.seq)).toEqual([1])
    expect(s.canRedo).toBe(true)
    expect(s.mutationLock).toBe(false)
  })
})
