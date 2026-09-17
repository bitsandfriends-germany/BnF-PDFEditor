import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// §6: Rechtsklick auf die LEINWAND. Bewiesen: Scope des Rechtsklicks (nicht aktuelle Seite!),
// Reihenfolge Seiten-Ops vor Ansicht, echter Endpunkt mit korrekt expr, readOnly = omit-not-grey.

const post = vi.fn()
class ApiError extends Error { code: string; constructor(c: string, m: string) { super(m); this.name = 'ApiError'; this.code = c } }
vi.mock('@/lib/apiClient', () => ({ api: { get: vi.fn().mockResolvedValue({ open: true }), post, del: vi.fn(), getBytes: vi.fn() }, ApiError, sseStream: vi.fn() }))

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { ViewerContextMenu } = await import('@/components/ViewerContextMenu')

beforeEach(() => {
  setLang('en')
  vi.clearAllMocks()
  post.mockResolvedValue({})
  useAppStore.setState({ docOpen: true, readOnly: false, mutationLock: false, signedDoc: false, pageCount: 5, currentPage: 1, commands: [], redoCommands: [], canUndo: false, canRedo: false, undoDepth: 0, toasts: [], docVersion: 1 })
  useUiStore.setState({ selected: [], anchor: null, pendingConfirm: null })
})

function openMenu(page: number): void {
  render(<ViewerContextMenu menu={{ page, x: 10, y: 10 }} textSelected={false} stamping={false} onClose={() => {}} />)
}
// R55 Zwei-Ebenen-Menue: Flyout oeffnen, dann Items darin.
function openGrp(group: string): void {
  const btns = screen.getAllByTestId(`ctx-group-${group}`)
  fireEvent.click(btns[btns.length - 1]!)
}

describe('ViewerContextMenu (§6 Canvas)', () => {
  it('Scope = Rechtsklickseite (Kopf + echter expr), unabhängig von currentPage', async () => {
    openMenu(4)
    expect(screen.getByTestId('ctx-scope')).toHaveTextContent('Page 4')
    openGrp('grp.pdf')
    fireEvent.click(screen.getByTestId('ctx-pg-rot-right'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/pages/rotate-selection', { expr: '4', delta: 90 }))
  })

  it('Reihenfolge: Seiten-Operationen vor Ansicht-Aktionen', () => {
    openMenu(2)
    openGrp('grp.pdf')
    openGrp('grp.view')
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((e) => e.getAttribute('data-testid') ?? '')
    // PDF-Flyout steht VOR dem Ansicht-Flyout (DOM-Reihenfolge der Gruppen).
    expect(items.indexOf('ctx-pg-rot-right')).toBeLessThan(items.indexOf('ctx-view-fit-width'))
    expect(items.indexOf('ctx-pg-extract')).toBeLessThan(items.indexOf('ctx-view-fit-width'))
    // Ansicht-Aktionen am Ende der Primär-Liste, in Registry-Reihenfolge
    const tail = items.filter((id) => id.startsWith('ctx-view-'))
    expect(tail).toEqual(['ctx-view-fit-width', 'ctx-view-fit-page', 'ctx-view-zoom-100'])
  })

  it('Auswahl-Scope: Klickseite in Auswahl -> ganze Auswahl (expr 2-3, Kopf „2 selected")', async () => {
    useUiStore.setState({ selected: [1, 2] })
    openMenu(2)
    expect(screen.getByTestId('ctx-scope')).toHaveTextContent('2 selected')
    openGrp('grp.pdf')
    fireEvent.click(screen.getByTestId('ctx-pg-rot-right'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/pages/rotate-selection', { expr: '2-3', delta: 90 }))
  })

  it('readOnly: Mutationen fehlen, Leseaktion + Ansicht bleiben (omit-not-grey)', () => {
    useAppStore.setState({ readOnly: true })
    openMenu(3)
    expect(screen.queryByTestId('ctx-pg-del')).toBeNull()
    openGrp('grp.pdf')
    expect(screen.queryByTestId('ctx-pg-rot-right')).toBeNull() // fehlt im Flyout (readOnly)
    expect(screen.getByTestId('ctx-pg-extract')).toBeInTheDocument() // nur-lesen bleibt
    openGrp('grp.view')
    expect(screen.getByTestId('ctx-view-fit-width')).toBeInTheDocument()
  })

  it('Ansicht-Aktion wirkt auf echten Store (fitWidth)', () => {
    useUiStore.getState().setZoom(1, 'custom')
    openMenu(1)
    openGrp('grp.view')
    fireEvent.click(screen.getByTestId('ctx-view-fit-width'))
    expect(useUiStore.getState().zoomMode).toBe('fitWidth')
  })
})

describe('§6 Canvas-Reihenfolge vollständig: Auswahl -> Werkzeuge -> Seiten-Ops -> Ansicht', () => {
  it('ohne Textauswahl: Werkzeuge vor Seiten-Ops, Seiten-Ops vor Ansicht; Klick bewaffnet echtes Werkzeug', () => {
    openMenu(2)
    expect(screen.getAllByTestId('ctx-group-grp.annotate').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('ctx-group-grp.pdf').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('ctx-group-grp.view').length).toBeGreaterThan(0)
    openGrp('grp.annotate')
    let items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((e) => e.getAttribute('data-testid') ?? '')
    expect(items.filter((i) => i.startsWith('ctx-ts-'))).toEqual([]) // keine Auswahl -> keine ts-Punkte
    const hls = screen.getAllByTestId('ctx-ann-tool-highlight')
    fireEvent.click(hls[hls.length - 1]!)
    expect(useUiStore.getState().markupTool).toBe('Highlight')
    openMenu(2)
    openGrp('grp.annotate')
    const notes = screen.getAllByTestId('ctx-ann-tool-note')
    fireEvent.click(notes[notes.length - 1]!)
    expect(useUiStore.getState().markupTool).toBe('Text')
  })

  it('mit Textauswahl: ts.* vorn (zerstörerisches redact getrennt unten), danach Werkzeuge', () => {
    render(<ViewerContextMenu menu={{ page: 2, x: 10, y: 10 }} textSelected selection={{ page: 2, text: 'wort', rect: { x: 10, y: 10, width: 50, height: 12 } }} stamping={false} onClose={() => {}} />)
    let items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((e) => e.getAttribute('data-testid') ?? '')
    expect(items.slice(0, 5)).toEqual(['ctx-ts-copy', 'ctx-ts-highlight', 'ctx-ts-underline', 'ctx-ts-strikeout', 'ctx-ts-ask-ai'])
    openGrp('grp.annotate')
    items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((e) => e.getAttribute('data-testid') ?? '')
    expect(items.indexOf('ctx-ts-ask-ai')).toBeLessThan(items.indexOf('ctx-ann-tool-highlight'))
    openGrp('grp.pdf')
    items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((e) => e.getAttribute('data-testid') ?? '')
    expect(items.indexOf('ctx-ann-tool-highlight')).toBeLessThan(items.indexOf('ctx-pg-rot-right'))
    // §6: Zerstörerisches (ts.redact, pg.delete) getrennt ganz unten — Register-Reihenfolge beachtet.
    expect(items.slice(-2)).toEqual(['ctx-ts-redact', 'ctx-pg-del'])
  })

  it('readOnly: Werkzeuge fehlen komplett (omit-not-grey), Ansicht bleibt', () => {
    useAppStore.setState({ readOnly: true })
    openMenu(2)
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((e) => e.getAttribute('data-testid') ?? '')
    expect(items.filter((i) => i.startsWith('ctx-ann-tool-'))).toEqual([]) // Werkzeuge fehlen (auch kein Flyout-Leerlauf)
    expect(items).not.toContain('ctx-group-grp.annotate')
    openGrp('grp.view')
    const items2 = Array.from(document.querySelectorAll('[role="menuitem"]')).map((e) => e.getAttribute('data-testid') ?? '')
    expect(items2).toContain('ctx-view-fit-width') // Ansicht bleibt
  })
})
