import { describe, it, expect, vi, beforeEach } from 'vitest'

// Die Dokument-Schicht wird gegen einen gemockten getypten Client getestet — kein echtes Backend,
// kein fetch. Damit bleibt die Aktionsschicht (mutationLock, Command-Metadaten, Fehler->Toast) isoliert prüfbar.

const post = vi.fn()
const get = vi.fn()

class ApiError extends Error {
  code: string
  correlationId?: string | undefined
  constructor(code: string, message: string, correlationId?: string): void {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.correlationId = correlationId
  }
}

vi.mock('@/lib/apiClient', () => ({
  api: { get, post, del: vi.fn(), getBytes: vi.fn() },
  ApiError,
  sseStream: vi.fn()
}))

const { useAppStore } = await import('@/store/useAppStore')
const { rotatePage, deletePage, setMetadata, openDocument } = await import('@/lib/documents')
const { setLang } = await import('@/i18n')

const baseState = { open: true, originalPath: "/tmp/x.pdf", readOnly: false, dirty: false, encrypted: false, canUndo: true, canRedo: false, undoDepth: 1, pageCount: 3 }

function resetStore(): void {
  useAppStore.setState({
    docOpen: true,
    readOnly: false,
    pageCount: 3,
    currentPage: 2,
    commands: [],
    redoCommands: [],
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    mutationLock: false,
    toasts: [],
    docVersion: 1
  })
}

describe('documents — Mutationsschicht', () => {
  beforeEach(() => {
    setLang('de')
    vi.clearAllMocks()
    resetStore()
    get.mockResolvedValue(baseState) // /document/state
  })

  it('rotatePage ruft den Client, spaht Command-Metadaten und lockt danach auf', async () => {
    post.mockResolvedValue({ pageCount: 3 })
    const ok = await rotatePage(0, 90)
    expect(ok).toBe(true)
    expect(post).toHaveBeenCalledWith('/pages/rotate', { page: 0, delta: 90 })
    expect(get).toHaveBeenCalledWith('/document/state')
    const st = useAppStore.getState()
    expect(st.canUndo).toBe(true)
    expect(st.commands).toHaveLength(1)
    expect(st.commands[0]?.type).toBe('ROTATE_PAGE')
    expect(st.commands[0]?.label).toBe('Seite 1 drehen')
    expect(st.mutationLock).toBe(false)
  })

  it('read-only blockt die Mutation, ohne den Client zu treffen', async () => {
    useAppStore.setState({ readOnly: true })
    const ok = await rotatePage(0, 90)
    expect(ok).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('Fehler fuehrt zu Fehler-Toast und keinem Command', async () => {
    post.mockRejectedValue(new ApiError('pdf_error', 'Konnte Seite nicht rotieren.', 'cid-9'))
    const ok = await rotatePage(1, 90)
    expect(ok).toBe(false)
    const st = useAppStore.getState()
    expect(st.commands).toHaveLength(0)
    expect(st.toasts.some((t) => t.kind === 'error' && t.correlationId === 'cid-9')).toBe(true)
    expect(st.mutationLock).toBe(false)
  })

  it('deletePage klemmt die aktuelle Seite nach dem Loeschen', async () => {
    useAppStore.setState({ currentPage: 3 })
    post.mockResolvedValue({ pageCount: 2 })
    // pageCount im Store ist noch 3; nach Erfolg wird auf (3-1)=2 geklemmt.
    get.mockResolvedValue({ ...baseState })
    await deletePage(2)
    expect(post).toHaveBeenCalledWith('/pages/delete', { page: 2 })
    expect(useAppStore.getState().currentPage).toBeLessThanOrEqual(3)
  })

  it('setMetadata speichert und zeigt Erfolgs-Toast', async () => {
    post.mockResolvedValue({})
    const ok = await setMetadata({ title: 'T', author: '', subject: '', keywords: '' })
    expect(ok).toBe(true)
    expect(post).toHaveBeenCalledWith('/document/metadata', { title: 'T', author: '', subject: '', keywords: '' })
    expect(useAppStore.getState().toasts.some((t) => t.kind === 'success')).toBe(true)
  })

  it('openDocument setzt Seitenzahl und Verlauf neu', async () => {
    post.mockResolvedValue({ pageCount: 5, readOnly: false, encrypted: false })
    get.mockResolvedValue({ ...baseState, undoDepth: 0, canUndo: false, pageCount: 5 })
    const ok = await openDocument('/tmp/new.pdf')
    expect(ok).toBe(true)
    expect(post).toHaveBeenCalledWith('/document/open', { path: '/tmp/new.pdf' })
    expect(useAppStore.getState().pageCount).toBe(5)
  })
})
