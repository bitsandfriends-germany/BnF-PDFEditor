import { describe, it, expect, vi, beforeEach } from 'vitest'

// Die neuen Typed-Client-Aktionen (Sections 6/7/9/10/12) gegen einen gemockten Client.

const post = vi.fn()
const get = vi.fn()
const del = vi.fn()

class ApiError extends Error {
  code: string
  constructor(code: string, message: string): void { super(message); this.name = 'ApiError'; this.code = code }
}

vi.mock('@/lib/apiClient', () => ({
  api: { get, post, del, getBytes: vi.fn() },
  ApiError,
  sseStream: vi.fn(),
}))

const { useAppStore } = await import('@/store/useAppStore')
const d = await import('@/lib/documents')
const { setLang } = await import('@/i18n')

const baseState = { open: true, originalPath: '/tmp/x.pdf', readOnly: false, dirty: false, encrypted: false, canUndo: true, canRedo: false, undoDepth: 1, pageCount: 3 }

function reset(): void {
  useAppStore.setState({ docOpen: true, readOnly: false, pageCount: 3, currentPage: 2, commands: [], redoCommands: [], canUndo: false, canRedo: false, undoDepth: 0, mutationLock: false, toasts: [], docVersion: 1 })
}

beforeEach(() => { setLang('de'); vi.clearAllMocks(); reset(); get.mockResolvedValue(baseState) })

describe('Section 6 Auswahl-OPs', () => {
  it('rotateSelection ruft rotate-selection und spaht Command', async () => {
    post.mockResolvedValue({})
    await expect(d.rotateSelection('1-3', 90)).resolves.toBe(true)
    expect(post).toHaveBeenCalledWith('/pages/rotate-selection', { expr: '1-3', delta: 90 })
    expect(useAppStore.getState().commands[0]?.type).toBe('ROTATE_SELECTION')
  })
  it('deleteSelection + duplicateSelection + insertPages', async () => {
    post.mockResolvedValue({})
    await d.deleteSelection('2,4'); expect(post).toHaveBeenLastCalledWith('/pages/delete-selection', { expr: '2,4' })
    await d.duplicateSelection('1', 'after', 1); expect(post).toHaveBeenLastCalledWith('/pages/duplicate', { expr: '1', position: 'after', page: 1 })
    await d.insertPages('end', undefined, { kind: 'blank', width: 595, height: 842 }); expect(post).toHaveBeenLastCalledWith('/pages/insert', { position: 'end', page: undefined, source: { kind: 'blank', width: 595, height: 842 } })
  })
  it('extractPages ist kein Command (Quelle unveraendert)', async () => {
    post.mockResolvedValue({ created: ['/x/a_p1.pdf'], count: 1 })
    await expect(d.extractPages('1', '/x', false)).resolves.toBe('/x/a_p1.pdf')
    expect(post).toHaveBeenCalledWith('/pages/extract', { expr: '1', destDir: '/x', each: false, baseName: undefined })
    expect(useAppStore.getState().commands).toHaveLength(0)
  })
})

describe('Section 7/10 Commands', () => {
  it('addPageNumbers spaht PAGE_NUMBERS', async () => {
    post.mockResolvedValue({})
    await d.addPageNumbers({ expr: 'all', position: 'bottom-center', format: '{n}', start: 1 })
    expect(post).toHaveBeenCalledWith('/stamps/page-numbers', { expr: 'all', position: 'bottom-center', format: '{n}', start: 1 })
    expect(useAppStore.getState().commands[0]?.type).toBe('PAGE_NUMBERS')
  })
  it('applyRedaction ist NICHT reversibel', async () => {
    post.mockResolvedValue({ verified: true })
    await d.applyRedaction([{ page: 1, x: 0, y: 0, width: 10, height: 10 }])
    expect(post).toHaveBeenCalledWith('/redaction/apply', { regions: [{ page: 1, x: 0, y: 0, width: 10, height: 10 }], images: 'pixels' })
    expect(useAppStore.getState().commands[0]?.reversible).toBe(false)
  })
  it('encryptDoc ist NICHT reversibel', async () => {
    post.mockResolvedValue({ encrypted: true })
    await d.encryptDoc('u', 'o', { printing: 'none' })
    expect(post).toHaveBeenCalledWith('/document/encrypt', { password: 'u', ownerPw: 'o', permissions: { printing: 'none' } })
    expect(useAppStore.getState().commands[0]?.reversible).toBe(false)
  })
  it('previewRedaction liest ohne Command', async () => {
    get.mockResolvedValue(baseState)
    post.mockResolvedValue({ willRedact: [{ page: 1, strings: ['x'] }] })
    const r = await d.previewRedaction([{ page: 1, x: 0, y: 0, width: 1, height: 1 }])
    expect(r.willRedact[0]?.strings).toContain('x')
    expect(useAppStore.getState().commands).toHaveLength(0)
  })
})

describe('Section 12/9 Read/Produzenten', () => {
  it('exportImages zaehlt und kein Command', async () => {
    post.mockResolvedValue({ count: 2 })
    await expect(d.exportImages('all', '/o', 'png', 150)).resolves.toBe(2)
    expect(post).toHaveBeenCalledWith('/export/images', { expr: 'all', destDir: '/o', fmt: 'png', dpi: 150, baseName: undefined })
    expect(useAppStore.getState().commands).toHaveLength(0)
  })
  it('listSignatures/importSignature/describeCertificate', async () => {
    get.mockResolvedValue({ signatures: [{ id: 'a', name: 'S', fileName: 'a.png', defaultSizePt: 160, defaultOpacity: 1, createdAt: null, mime: 'image/png', hasImage: true }] })
    expect((await d.listSignatures())[0]?.name).toBe('S')
    post.mockResolvedValue({ id: 'new1' })
    await expect(d.importSignature('S', 'AAA', '.png', 160, 1)).resolves.toBe('new1')
    post.mockResolvedValue({ subject: 'CN=X', issuer: 'CN=X', expired: false, notYetValid: false, selfSigned: true, hasPrivateKey: true, canSignWith: true, warnings: [] })
    expect((await d.describeCertificate('/x.p12', 'pw')).canSignWith).toBe(true)
  })
  it('deleteSignature loescht per Pfad', async () => {
    del.mockResolvedValue({ deleted: 'a' })
    await d.deleteSignature('a b')
    expect(del).toHaveBeenCalledWith('/signatures/a%20b')
  })
})

const { useUiStore } = await import('@/store/useUiStore')

describe('Section 2.8 Signatur-Gate (in mutate zentral)', () => {
  it('bricht bei Abbruch ab — kein Request, kein Command', async () => {
    useAppStore.setState({ signedDoc: true })
    useUiStore.setState({ requestConfirm: async () => false })
    const ok = await d.rotateSelection('1-3', 90)
    expect(ok).toBe(false)
    expect(post).not.toHaveBeenCalled()
    expect(useAppStore.getState().commands).toHaveLength(0)
  })
  it('laeuft bei Bestaetigung durch', async () => {
    useAppStore.setState({ signedDoc: true })
    useUiStore.setState({ requestConfirm: async () => true })
    post.mockResolvedValue({})
    const ok = await d.rotateSelection('1-3', 90)
    expect(ok).toBe(true)
    expect(post).toHaveBeenCalledWith('/pages/rotate-selection', { expr: '1-3', delta: 90 })
    expect(useAppStore.getState().commands).toHaveLength(1)
  })
  it('ohne signiertes Dokument kein Gate (RequestConfirm wird nicht gefraget)', async () => {
    useAppStore.setState({ signedDoc: false })
    let asked = false
    useUiStore.setState({ requestConfirm: async () => { asked = true; return false } })
    post.mockResolvedValue({})
    await d.deleteSelection('2')
    expect(asked).toBe(false)
    expect(post).toHaveBeenCalledWith('/pages/delete-selection', { expr: '2' })
  })
})

describe('Schliessen mit 3 Optionen (Section 4)', () => {
  it('Abbruch: kein close-Request, Dokument bleibt', async () => {
    useAppStore.setState({ dirty: true })
    useUiStore.setState({ requestClose: async () => 'cancel' })
    await d.closeDocument()
    expect(post).not.toHaveBeenCalled()
    expect(useAppStore.getState().docOpen).toBe(true)
  })
  it('Verwerfen: close-Request + lokales Zuruecksetzen', async () => {
    post.mockResolvedValue(baseState)
    useAppStore.setState({ dirty: true })
    useUiStore.setState({ requestClose: async () => 'discard' })
    await d.closeDocument()
    expect(post).toHaveBeenCalledWith('/document/close', {})
    expect(useAppStore.getState().docOpen).toBe(false)
  })
  it('Speichern-Option speichert zuerst, dann close', async () => {
    post.mockResolvedValue(baseState)
    useAppStore.setState({ dirty: true })
    useUiStore.setState({ requestClose: async () => 'save' })
    await d.closeDocument()
    expect(post).toHaveBeenCalledWith('/document/save', {})
    expect(post).toHaveBeenCalledWith('/document/close', {})
    expect(useAppStore.getState().docOpen).toBe(false)
  })
  it('sauber (nicht dirty): kein Rueckfrage, direktes close', async () => {
    post.mockResolvedValue(baseState)
    useAppStore.setState({ dirty: false })
    let asked = false
    useUiStore.setState({ requestClose: async () => { asked = true; return 'cancel' } })
    await d.closeDocument()
    expect(asked).toBe(false)
    expect(post).toHaveBeenCalledWith('/document/close', {})
  })
})
