import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const post = vi.fn()
const get = vi.fn()
class ApiError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.name = 'ApiError'; this.code = code }
}
vi.mock('@/lib/apiClient', () => ({ api: { get, post, del: vi.fn(), getBytes: vi.fn() }, ApiError, sseStream: vi.fn() }))

const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { setLang } = await import('@/i18n')
const { PagesDialogs } = await import('@/components/PagesDialogs')

const baseState = { open: true, originalPath: '/x.pdf', readOnly: false, dirty: false, encrypted: false, canUndo: false, canRedo: false, undoDepth: 0, pageCount: 3 }

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  get.mockResolvedValue(baseState)
  useAppStore.setState({ docOpen: true, readOnly: false, pageCount: 3, currentPage: 2, signedDoc: false, mutationLock: false, commands: [], redoCommands: [], canUndo: false, canRedo: false, undoDepth: 0, toasts: [], docVersion: 1 })
  useUiStore.setState({ selected: [], anchor: null, pagesDialog: null, pendingConfirm: null })
  ;(window as unknown as { pdfEditor: unknown }).pdfEditor = {
    chooseDirectory: vi.fn().mockResolvedValue('/out'),
    pickImage: vi.fn().mockResolvedValue('/img.png'),
    openPdfDialog: vi.fn().mockResolvedValue('/src.pdf'),
    pickImages: vi.fn().mockResolvedValue(['/a.png', '/b.jpg'])
  }
})

describe('PagesDialogs', () => {
  it('Extrahieren: erst ohne Ziel laeuft nichts, nach Verwahl wird extract aufgerufen', async () => {
    post.mockResolvedValue({ created: ['/out/a_1.pdf'], count: 1 })
    useUiStore.setState({ pagesDialog: 'extract' })
    render(<PagesDialogs />)
    // Ziel fehlt -> Run deaktiviert
    expect(screen.getByTestId('extract-run')).toBeDisabled()
    fireEvent.click(screen.getByText('Wählen…'))
    await waitFor(() => expect(screen.getByTestId('dlg-dir-path')).toHaveValue('/out'))
    fireEvent.click(screen.getByTestId('extract-run'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/pages/extract', { expr: '2', destDir: '/out', each: false, baseName: undefined }))
  })

  it('Ungueltige Seitenangabe deaktiviert den Run', async () => {
    useUiStore.setState({ pagesDialog: 'extract' })
    render(<PagesDialogs />)
    fireEvent.change(screen.getByTestId('extract-expr'), { target: { value: 'not-a-range' } })
    await waitFor(() => expect(screen.getByTestId('extract-run')).toBeDisabled())
  })

  it('Einfuegen leer (A4 Hoch) ruft insert mit korrekter Quelle auf', async () => {
    post.mockResolvedValue({ added: 1, page_count: 4 })
    useUiStore.setState({ pagesDialog: 'insert' })
    render(<PagesDialogs />)
    fireEvent.click(screen.getByTestId('insert-run'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/pages/insert', { position: 'end', page: undefined, source: { kind: 'blank', width: 595, height: 842 } }))
  })

  it('Seitenzahlen: Format + Start werden durchgereicht (mutate)', async () => {
    post.mockResolvedValue({ page_count: 3 })
    useUiStore.setState({ pagesDialog: 'numbers' })
    render(<PagesDialogs />)
    fireEvent.change(screen.getByTestId('dlg-num-fmt'), { target: { value: '{n} / {total}' } })
    fireEvent.click(screen.getByTestId('numbers-run'))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/stamps/page-numbers', {
        expr: '2', position: 'bottom-center', margin: 36, format: '{n} / {total}', start: 1, fontname: 'helv', fontsize: 10, color: '#000000'
      })
    )
    expect(useAppStore.getState().commands[0]?.type).toBe('PAGE_NUMBERS')
  })
})

describe('PagesDialogs Wasserzeichen (Section 7)', () => {
  it('baut cfg und ruft /stamps/watermark (Command -> Signatur-Gate moeglich)', async () => {
    post.mockResolvedValue({ applied: 1 })
    useUiStore.setState({ pagesDialog: 'watermark' })
    render(<PagesDialogs />)
    // ohne Text laeuft nichts
    expect(screen.getByTestId('watermark-run')).toBeDisabled()
    fireEvent.change(screen.getByTestId('wm-text'), { target: { value: 'VERTRAULICH' } })
    fireEvent.change(screen.getByTestId('wm-angle'), { target: { value: '90' } })
    fireEvent.change(screen.getByTestId('wm-opacity'), { target: { value: '0.5' } })
    fireEvent.click(screen.getByTestId('wm-tiled'))
    fireEvent.click(screen.getByTestId('wm-behind'))
    fireEvent.click(screen.getByTestId('watermark-run'))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/stamps/watermark', expect.objectContaining({
        kind: 'text', expr: '2', text: 'VERTRAULICH', angle: 90, opacity: 0.5, tiled: true, overlay: false
      }))
    )
  })
})

describe('PagesDialogs Bilder & Flatten (Section 7)', () => {
  it('Bilder: erst Aufloesungen, dann Extraktion in Zielverzeichnis', async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.includes('/document/images')
      ? { images: [{ page: 2, index: 0, xref: 7, width: 1200, height: 800, bpc: 8, colorspace: 'DeviceRGB' }] }
      : baseState))
    post.mockResolvedValue({ created: [{ path: '/out/x_p2_0.png' }], count: 1 })
    useUiStore.setState({ pagesDialog: 'images' })
    render(<PagesDialogs />)
    fireEvent.click(screen.getByTestId('img-list'))
    await waitFor(() => expect(get).toHaveBeenCalledWith('/document/images?expr=2'))
    await waitFor(() => expect(screen.getByTestId('img-row-0')).toBeInTheDocument())
    expect(screen.getByText('1200 × 800')).toBeInTheDocument()
    // Ziel fehlt -> Run deaktiviert
    expect(screen.getByTestId('images-run')).toBeDisabled()
    fireEvent.click(screen.getByText('Wählen…'))
    await waitFor(() => expect(screen.getByTestId('images-run')).toBeEnabled())
    fireEvent.click(screen.getByTestId('images-run'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/document/extract-images', expect.objectContaining({ expr: '2', destDir: '/out' })))
  })

  it('Flatten: Kategorien als Command an /document/flatten', async () => {
    post.mockResolvedValue({ flattened: true })
    useUiStore.setState({ pagesDialog: 'flatten' })
    render(<PagesDialogs />)
    fireEvent.click(screen.getByTestId('flat-forms')) // nur Annotationen
    fireEvent.click(screen.getByTestId('flatten-run'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/document/flatten', { categories: ['annotations'] }))
  })

  it('Flatten: ohne Kategorie deaktiv', () => {
    useUiStore.setState({ pagesDialog: 'flatten' })
    render(<PagesDialogs />)
    fireEvent.click(screen.getByTestId('flat-annotations'))
    fireEvent.click(screen.getByTestId('flat-forms'))
    expect(screen.getByTestId('flatten-run')).toBeDisabled()
  })
})

describe('ExportDialog (Section 12)', () => {
  it('Seiten als Bilder: ruft /export/images mit expr/dir/fmt/dpi', async () => {
    post.mockResolvedValue({ count: 2 })
    useUiStore.setState({ pagesDialog: 'export' })
    render(<PagesDialogs />)
    fireEvent.click(screen.getByText('Wählen…'))
    await waitFor(() => expect(screen.getByTestId('dlg-dir-path')).toHaveValue('/out'))
    fireEvent.change(screen.getByTestId('exp-fmt'), { target: { value: 'jpeg' } })
    fireEvent.change(screen.getByTestId('exp-dpi'), { target: { value: '300' } })
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/export/images', { expr: '2', destDir: '/out', fmt: 'jpeg', dpi: 300, baseName: undefined }))
  })
  it('Komprimieren ruft /export/compress', async () => {
    post.mockResolvedValue({ path: '/o.pdf', beforeBytes: 100, afterBytes: 60, savedPercent: 40, smaller: true })
    useUiStore.setState({ pagesDialog: 'export' })
    render(<PagesDialogs />)
    fireEvent.change(screen.getByTestId('exp-what'), { target: { value: 'compress' } })
    fireEvent.click(screen.getByText('Wählen…'))
    await waitFor(() => expect(screen.getByTestId('dlg-dir-path')).toHaveValue('/out'))
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/export/compress', { destDir: '/out', targetDpi: 150, jpegQuality: 60 }))
  })
  it('Linearisieren ist bei verschluesseltem Dokument deaktiviert + Hinweis', async () => {
    useAppStore.setState({ encrypted: true })
    useUiStore.setState({ pagesDialog: 'export' })
    render(<PagesDialogs />)
    fireEvent.change(screen.getByTestId('exp-what'), { target: { value: 'linearise' } })
    fireEvent.click(screen.getByText('Wählen…'))
    await waitFor(() => expect(screen.getByTestId('dlg-dir-path')).toHaveValue('/out'))
    expect(screen.getByTestId('exp-enc-hint')).toBeInTheDocument()
    expect(screen.getByTestId('export-run')).toBeDisabled()
  })
})

describe('ExportDialog Bilder→PDF (Section 12)', () => {
  it('wählt Bilder und ruft /export/images-to-pdf mit Pfaden/Grösse/Ausrichtung', async () => {
    post.mockResolvedValue({ path: '/out/x.pdf', pages: 2 })
    useUiStore.setState({ pagesDialog: 'export' })
    render(<PagesDialogs />)
    fireEvent.change(screen.getByTestId('exp-what'), { target: { value: 'imagesToPdf' } })
    fireEvent.click(screen.getByTestId('exp-pick-images'))
    await waitFor(() => expect(screen.getByTestId('exp-img-count')).toHaveTextContent('2'))
    // ohne Ziel deaktiviert
    expect(screen.getByTestId('export-run')).toBeDisabled()
    fireEvent.click(screen.getByText('Wählen…'))
    await waitFor(() => expect(screen.getByTestId('dlg-dir-path')).toHaveValue('/out'))
    fireEvent.change(screen.getByTestId('exp-pagesize'), { target: { value: 'a4' } })
    fireEvent.change(screen.getByTestId('exp-orient'), { target: { value: 'landscape' } })
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/export/images-to-pdf', { paths: ['/a.png', '/b.jpg'], destDir: '/out', pageSize: 'a4', orientation: 'landscape' }))
  })
})

describe('Images- und Flatten-Tab bis zum echten Endpunkt (§7.1-Beweislücken)', () => {
  it('Bilder: Run ruft /document/extract-images mit Seitenbereich + Zielverzeichnis', async () => {
    post.mockResolvedValue({ created: ['/out/a_1.png'], count: 1 })
    get.mockImplementation(async (url: string) =>
      url.startsWith('/document/images')
        ? { images: [{ page: 1, width: 100, height: 80, space: 'DeviceRGB', xref: 5, ext: 'png' }] }
        : baseState)
    useUiStore.setState({ pagesDialog: 'images' })
    render(<PagesDialogs />)
    fireEvent.click(screen.getByTestId('img-list'))                 // Liste laden — Vorbedingung des Run
    await screen.findByTestId('img-row-0')
    expect(screen.getByTestId('images-run')).toBeDisabled()         // Zielverzeichnis fehlt noch
    fireEvent.click(screen.getByText('Wählen…'))
    await waitFor(() => expect(screen.getByTestId('dlg-dir-path')).toHaveValue('/out'))
    fireEvent.change(screen.getByTestId('images-expr'), { target: { value: '1-2' } })
    fireEvent.click(screen.getByTestId('images-run'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/document/extract-images', { expr: '1-2', destDir: '/out', baseName: undefined }))
  })

  it('Flatten: Run sendet genau die angeklickten Kategorien an /document/flatten', async () => {
    post.mockResolvedValue({ ok: true })
    useUiStore.setState({ pagesDialog: 'flatten' })
    render(<PagesDialogs />)
    fireEvent.click(screen.getByTestId('flat-forms')) // nur Annotationen
    fireEvent.click(screen.getByTestId('flatten-run'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/document/flatten', { categories: ['annotations'] }))
  })
})

describe('Scoped-Presets aus dem Kontextmenü (§6)', () => {
  it('Insert-Preset "before Seite 2": Dialog startet vorausgefüllt, Run sendet before+2', async () => {
    post.mockResolvedValue({ ok: true })
    useUiStore.setState({ pagesDialog: 'insert', pagesDialogPreset: { position: 'before', page: 2 } })
    render(<PagesDialogs />)
    expect(screen.getByTestId('dlg-ins-pos')).toHaveValue('before')
    expect(screen.getByTestId('insert-page')).toHaveValue(2)
    fireEvent.click(screen.getByTestId('insert-run'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/pages/insert', { position: 'before', page: 2, source: { kind: 'blank', width: 595, height: 842 } }))
  })

  it('Split-Preset "at Seite 3": Modus/Seite vorausgefüllt, Run sendet at+3', async () => {
    post.mockResolvedValue({ created: ['/out/a_1.pdf', '/out/a_2.pdf'], count: 2 })
    useUiStore.setState({ pagesDialog: 'split', pagesDialogPreset: { mode: 'at', page: 3 } })
    render(<PagesDialogs />)
    expect(screen.getByTestId('dlg-split-mode')).toHaveValue('at')
    expect(screen.getByTestId('split-page')).toHaveValue(3)
    fireEvent.click(screen.getByText('Wählen…'))
    await waitFor(() => expect(screen.getByTestId('dlg-dir-path')).toHaveValue('/out'))
    fireEvent.click(screen.getByTestId('split-run'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/pages/split', expect.objectContaining({ mode: 'at', page: 3 })))
  })
})
