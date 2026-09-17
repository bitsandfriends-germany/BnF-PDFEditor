import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// §5 am echten Bauteil: zu schmaler Raum -> ganze Gruppen in den ⋯-Knopf, Zeile bricht nie um,
// ⋯-Menü zeigt die ausgezogenen Befehle und führt sie echt aus. ResizeObserver wird als realer
// Fake gespielt (misst wie der Browser), damit der Verdrahtungspfad getestet wird.

const post = vi.fn()
class ApiError extends Error { code: string; constructor(c: string, m: string) { super(m); this.name = 'ApiError'; this.code = c } }
vi.mock('@/lib/apiClient', () => ({ api: { get: vi.fn().mockResolvedValue({ open: true }), post, del: vi.fn(), getBytes: vi.fn() }, ApiError, sseStream: vi.fn() }))

let emit = (_w: number): void => {}
class FakeRO {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(_el: Element): void {
    emit = (w: number): void => {
      const entry = { contentRect: { width: w } } as unknown as ResizeObserverEntry
      this.cb([entry], this as unknown as ResizeObserver)
    }
  }
  unobserve(): void {}
  disconnect(): void {}
}

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { PagesToolbar } = await import('@/components/PagesToolbar')

beforeEach(() => {
  setLang('en')
  vi.clearAllMocks()
  post.mockResolvedValue({})
  ;(globalThis as Record<string, unknown>).ResizeObserver = FakeRO
  useAppStore.setState({ docOpen: true, readOnly: false, mutationLock: false, signedDoc: false, pageCount: 3, currentPage: 2, commands: [], redoCommands: [], canUndo: false, canRedo: false, undoDepth: 0, toasts: [], docVersion: 1 })
  useUiStore.setState({ selected: [], anchor: null, pendingConfirm: null })
})
afterEach(() => {
  delete (globalThis as Record<string, unknown>).ResizeObserver
})

describe('PagesToolbar Überlauf (§5, echtes Bauteil)', () => {
  it('breit: keine ⋯-Knopf, alle Gruppen sichtbar', () => {
    render(<PagesToolbar />)
    act(() => emit(2000))
    expect(screen.queryByTestId('pages-more')).toBeNull()
    expect(screen.getByTestId('pg-rot-right')).toBeInTheDocument()
    expect(screen.getByTestId('pg-flatten')).toBeInTheDocument()
  })

  it('schmal: ⋯ erscheint, hintere Gruppen verschwinden vollständig (kein Teil einer Gruppe)', () => {
    render(<PagesToolbar />)
    act(() => emit(260)) // rotate+arrange+insert passen, content/layers/selection nicht
    expect(screen.getByTestId('pages-more')).toBeInTheDocument()
    expect(screen.getByTestId('pg-rot-right')).toBeInTheDocument()
    expect(screen.queryByTestId('pg-flatten')).toBeNull()
    expect(screen.queryByTestId('pg-export')).toBeNull()
  })

  it('sehr schmal: ALLE Gruppen im ⋯ (nie abgeschnitten), ⋯ bleibt erreichbar', () => {
    render(<PagesToolbar />)
    act(() => emit(60))
    expect(screen.getByTestId('pages-more')).toBeInTheDocument()
    expect(screen.queryByTestId('pg-rot-right')).toBeNull()
  })

  it('⋯-Menü: ausgezogene Befehle vorhanden, Zerstörerisches nach Separator, Klick führt echten Endpunkt aus', () => {
    useUiStore.setState({ selected: [1, 2] })
    const spy = vi.spyOn(useUiStore.getState(), 'openPagesDialog')
    render(<PagesToolbar />)
    act(() => emit(260))
    fireEvent.click(screen.getByTestId('pages-more'))
    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
    expect(screen.queryByTestId('ctx-scope')).toBeNull() // Überlauf hat keinen Scope-Header
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((e) => e.getAttribute('data-testid'))
    expect(items).toContain('ctx-pg-flatten')
    expect(items[items.length - 1]).toBe('ctx-pg-clear') // Zerstörerisches des Überlaufs steht zuletzt
    expect(screen.getByTestId('ctx-destructive-separator')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ctx-pg-flatten'))
    expect(screen.queryByTestId('context-menu')).toBeNull() // Menü schließt nach Auswahl
    expect(spy).toHaveBeenCalled() // echter Store-Aufruf (Dialog wird geöffnet), nicht nur Klick
  })
})
