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
const { PagesToolbar } = await import('@/components/PagesToolbar')
const { ConfirmModal } = await import('@/components/ConfirmModal')

const baseState = { open: true, originalPath: '/x.pdf', readOnly: false, dirty: false, encrypted: false, canUndo: false, canRedo: false, undoDepth: 0, pageCount: 3 }

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  get.mockResolvedValue(baseState)
  useAppStore.setState({ docOpen: true, readOnly: false, pageCount: 3, currentPage: 2, signedDoc: false, mutationLock: false, commands: [], redoCommands: [], canUndo: false, canRedo: false, undoDepth: 0, toasts: [], docVersion: 1 })
  useUiStore.setState({ selected: [], anchor: null, pendingConfirm: null })
})

describe('PagesToolbar', () => {
  it('dreht die Auswahl (expr aus Selection)', async () => {
    post.mockResolvedValue({})
    useUiStore.setState({ selected: [2, 3] })
    render(<PagesToolbar />)
    fireEvent.click(screen.getByTestId('pg-rot-right'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/pages/rotate-selection', { expr: '2-3', delta: 90 }))
  })
  it('ohne Auswahl wirkt der Knopf auf die aktuelle Seite', async () => {
    post.mockResolvedValue({})
    render(<PagesToolbar />)
    fireEvent.click(screen.getByTestId('pg-del'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/pages/delete-selection', { expr: '2' }))
  })
  it('Alle-auswaehlen fuellt die Auswahl', () => {
    render(<PagesToolbar />)
    fireEvent.click(screen.getByTestId('pg-all'))
    expect(useUiStore.getState().selected).toEqual([1, 2, 3])
  })
  it('deaktiviert im Read-only', () => {
    useAppStore.setState({ readOnly: true })
    render(<PagesToolbar />)
    expect(screen.getByTestId('pg-rot-right')).toBeDisabled()
  })
})

describe('ConfirmModal', () => {
  it('zeigt Titel/Body und loest bei Bestaetigung true auf', async () => {
    render(<ConfirmModal />)
    let result: boolean | null = null
    void useUiStore.getState().requestConfirm('Titel X', 'Body Y').then((r) => { result = r })
    await waitFor(() => expect(screen.getByText('Titel X')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('confirm-ok'))
    await waitFor(() => expect(result).toBe(true))
  })
  it('Abbruch loest false auf', async () => {
    render(<ConfirmModal />)
    let result: boolean | null = null
    void useUiStore.getState().requestConfirm('T', 'B').then((r) => { result = r })
    fireEvent.click(await screen.findByTestId('confirm-cancel'))
    await waitFor(() => expect(result).toBe(false))
  })
})

describe('§5 Visuelle Anordnung (DOM-Beweise)', () => {
  it('Nie-Umbruch: flex-nowrap; sichtbare Trennlinien zwischen je zwei Inline-Gruppen', () => {
    render(<PagesToolbar />)
    const bar = screen.getByTestId('pages-toolbar')
    expect(bar.className).toContain('flex-nowrap')
    const separators = Array.from(bar.querySelectorAll('span.h-5.w-px'))
    // inline-Gruppen > 1 bei breiter jsdom-Box -> genau Gruppen-1 Separatoren
    const inlineGroupCount = Array.from(bar.querySelectorAll('span.flex.shrink-0.items-center')).length
    expect(inlineGroupCount).toBeGreaterThan(1)
    expect(separators.length).toBe(inlineGroupCount - 1)
  })

  it('Destruktiver Knopf (Loeschen) hat Luecke zum Nachbarn und Warnfarbe; 180° ist ein Icon, kein Text', () => {
    render(<PagesToolbar />)
    const del = screen.getByTestId('pg-del')
    const wrapper = del.closest('span') as HTMLElement
    const gap = wrapper.querySelector('span.w-2')
    expect(gap).not.toBeNull()
    expect(del.className).toContain('text-red-600')
    const rot180 = screen.getByTestId('pg-rot-180')
    expect(rot180.textContent).not.toContain('180')
    expect(rot180.querySelector('svg')).not.toBeNull()
  })
})
