import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// PART 3 §6 — ECHTER Nutzerpfad: Rechtsklick auf ein Thumbnail öffnet das Seiten-Kontextmenü und die
// gewählte Aktion erreicht die echte Endpoint-Aufrufstelle MIT dem korrekten Scope (Einzel-Seite vs.
// ganze Auswahl). Das ist der Beweis, den §3/§6 verlangen — nicht nur, dass ein Handler feuert.

const post = vi.fn()
class ApiError extends Error { code: string; constructor(c: string, m: string) { super(m); this.name = 'ApiError'; this.code = c } }
vi.mock('@/lib/apiClient', () => ({ api: { get: vi.fn().mockResolvedValue({ open: true }), post, del: vi.fn(), getBytes: vi.fn() }, ApiError, sseStream: vi.fn() }))

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { ThumbnailList } = await import('@/components/ThumbnailList')
const { COMMANDS, TOOLBAR_GROUPS, toolbarGroups } = await import('@/lib/commands')

const fakeDoc = { getPage: async (_n: number) => ({ getViewport: () => ({ width: 595, height: 842 }), render: () => ({ promise: Promise.resolve(), cancel: () => {} }) }) } as never

beforeEach(() => {
  setLang('en')
  vi.clearAllMocks()
  post.mockResolvedValue({})
  useAppStore.setState({ docOpen: true, readOnly: false, mutationLock: false, signedDoc: false, pageCount: 3, currentPage: 2, commands: [], redoCommands: [], canUndo: false, canRedo: false, undoDepth: 0, toasts: [], docVersion: 1 })
  useUiStore.setState({ selected: [], anchor: null, pendingConfirm: null })
})

// R55 Zwei-Ebenen-Menue: Flyout oeffnen, Items darin anklicken.
function openGrp(group: string): void {
  const btns = screen.getAllByTestId(`ctx-group-${group}`)
  fireEvent.click(btns[btns.length - 1]!)
}
function open(): void {
  render(<ThumbnailList doc={fakeDoc} pageCount={3} itemHeight={120} targetWidth={120} selectedIndex={1} selected={[]} onSelect={() => {}} onSelectAll={() => {}} />)
}
function openSel(sel: number[]): void {
  render(<ThumbnailList doc={fakeDoc} pageCount={3} itemHeight={120} targetWidth={120} selectedIndex={1} selected={sel} onSelect={() => {}} onSelectAll={() => {}} />)
}

describe('Rechtsklick-Journey auf Thumbnails (§6, echter Pfad)', () => {
  it('öffnet Menü mit Einzel-Seiten-Scope und Lösung rotiert die echte Seite 2', async () => {
    open()
    fireEvent.contextMenu(screen.getByTestId('thumb-wrap-1'))
    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
    expect(screen.getByTestId('ctx-scope')).toHaveTextContent('Page 2')
    openGrp('grp.pdf')
    fireEvent.click(screen.getByTestId('ctx-pg-rot-right'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/pages/rotate-selection', { expr: '2', delta: 90 }))
  })

  it('Scope = ganze Auswahl, wenn angeklickte Seite Teil der Auswahl ist (expr 2-3)', () => {
    openSel([1, 2]) // 0-basiert -> Seiten 2,3
    fireEvent.contextMenu(screen.getByTestId('thumb-wrap-1')) // Seite 2 in Auswahl
    expect(screen.getByTestId('ctx-scope')).toHaveTextContent('2 selected')
    openGrp('grp.pdf')
    fireEvent.click(screen.getByTestId('ctx-pg-rot-right'))
    expect(post).toHaveBeenCalledWith('/pages/rotate-selection', { expr: '2-3', delta: 90 })
  })

  it('löschen steht zuletzt nach Separator und trifft denselben Scope', async () => {
    open()
    fireEvent.contextMenu(screen.getByTestId('thumb-wrap-1'))
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((e) => e.getAttribute('data-testid'))
    expect(items[items.length - 1]).toBe('ctx-pg-del')
    expect(screen.getByTestId('ctx-destructive-separator')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ctx-pg-del'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/pages/delete-selection', { expr: '2' }))
  })

  it('Outside-Click und Esc schließen das Menü', () => {
    open()
    fireEvent.contextMenu(screen.getByTestId('thumb-wrap-0'))
    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ctx-backdrop'))
    expect(screen.queryByTestId('context-menu')).toBeNull()

    fireEvent.contextMenu(screen.getByTestId('thumb-wrap-0'))
    fireEvent.keyDown(screen.getByTestId('context-menu'), { key: 'Escape' })
    expect(screen.queryByTestId('context-menu')).toBeNull()
  })

  it('readOnly: Mutationen fehlen, reine Leseaktion bleibt (omit-not-grey)', () => {
    useAppStore.setState({ readOnly: true })
    open()
    fireEvent.contextMenu(screen.getByTestId('thumb-wrap-1'))
    openGrp('grp.pdf')
    expect(screen.queryByTestId('ctx-pg-rot-right')).toBeNull()
    expect(screen.queryByTestId('ctx-pg-del')).toBeNull()
    expect(screen.getByTestId('ctx-pg-extract')).toBeInTheDocument()
  })

  it('Thumbnail ist fokussierbar und die Kontext-Menü-Taste öffnet für ihn (§6)', () => {
    open()
    const wrap = screen.getByTestId('thumb-wrap-1')
    expect(wrap.tabIndex).toBeGreaterThanOrEqual(0)
    wrap.focus()
    expect(document.activeElement).toBe(wrap)
    // Die Browser-Taste "Kontext-Menü" feuert ein contextmenu-Event auf dem fokussierten Element.
    fireEvent.contextMenu(wrap)
    openGrp('grp.pdf')
    expect(screen.getByTestId('ctx-pg-rot-right')).toBeInTheDocument()
  })
})

describe('§6 Scoped-Punkte: Split before / Insert before-after (Thumbnail nur, Toolbar nie)', () => {
  it('Menü zeigt die Scoped-Varianten statt der generischen; Klick öffnet Dialog mit Scope-Preset', () => {
    const spy = vi.spyOn(useUiStore.getState(), 'openPagesDialog')
    open()
    fireEvent.contextMenu(screen.getByTestId('thumb-wrap-1')) // Seite 2 -> Scope-Start 2
    // Ein Flyout pro Zeit: PDF-Gruppe, dann Einfuegen-Gruppe pruefen.
    openGrp('grp.pdf')
    let ids2 = Array.from(document.querySelectorAll('[role="menuitem"]')).map((e) => e.getAttribute('data-testid'))
    expect(ids2).toEqual(expect.arrayContaining(['ctx-pg-insert-after', 'ctx-pg-split-before']))
    expect(ids2).not.toContain('ctx-pg-insert')
    expect(ids2).not.toContain('ctx-pg-split')
    openGrp('grp.insert')
    ids2 = Array.from(document.querySelectorAll('[role="menuitem"]')).map((e) => e.getAttribute('data-testid'))
    expect(ids2).toContain('ctx-pg-insert-before')
    expect(ids2).not.toContain('ctx-pg-insert')
    fireEvent.click(screen.getByTestId('ctx-pg-insert-before'))
    expect(spy).toHaveBeenCalledWith('insert', { position: 'before', page: 2 })
    fireEvent.contextMenu(screen.getByTestId('thumb-wrap-1'))
    openGrp('grp.pdf')
    fireEvent.click(screen.getByTestId('ctx-pg-split-before'))
    expect(spy).toHaveBeenCalledWith('split', { mode: 'at', page: 2 })
  })

  it('Toolbar-Gruppen schließen die menu-only-Befehle aus (§6: Menüpunkte, keine Toolbar-Klicke)', () => {
    const menuOnly = COMMANDS.filter((c) => c.group === 'menu').map((c) => c.id)
    expect(menuOnly).toEqual(expect.arrayContaining(['pg.insertBefore', 'pg.insertAfter', 'pg.splitBefore']))
    expect(TOOLBAR_GROUPS).not.toContain('menu')
    for (const g of toolbarGroups({ docOpen: true, readOnly: false, mutationLock: false, currentPage: 2, pageCount: 3, selected: [], textSelected: false, stamping: false })) {
      expect(g.items.map((c) => c.id)).not.toEqual(expect.arrayContaining(menuOnly))
    }
  })

  it('Context-Menue-Taste und Shift+F10 oeffnen das Menue am fokussierten Thumbnail (§6-Tastatur)', () => {
    open()
    const item = screen.getByTestId('thumb-item-1')
    item.focus()
    fireEvent.keyDown(window, { key: 'ContextMenu' })
    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
    expect(screen.getByTestId('ctx-scope')).toHaveTextContent('Page 2')
    fireEvent.keyDown(window, { key: 'Escape' })
    // Zweiter Weg: Shift+F10 am ersten Thumbnail -> Scope Seite 1.
    screen.getByTestId('thumb-item-0').focus()
    fireEvent.keyDown(window, { key: 'F10', shiftKey: true })
    expect(screen.getByTestId('ctx-scope')).toHaveTextContent('Page 1')
  })
})
