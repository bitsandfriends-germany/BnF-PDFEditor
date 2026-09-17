import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// §6 Annotations-Ziel: Rechtsklick auf eine Annotation -> eigene Aktionen, Zerstörerisches zuletzt,
// readOnly lässt nur Nicht-Zutreffendes weg; Löschen erreicht den echten Endpunkt mit der ID.

const post = vi.fn()
const listAnnotations = vi.fn()
class ApiError extends Error { code: string; constructor(c: string, m: string) { super(m); this.name = 'ApiError'; this.code = c } }
vi.mock('@/lib/apiClient', () => ({ api: { get: vi.fn().mockResolvedValue({ open: true }), post, del: vi.fn(), getBytes: vi.fn() }, ApiError, sseStream: vi.fn() }))
vi.mock('@/lib/documents', async (orig) => {
  const real = await orig<typeof import('@/lib/documents')>()
  return { ...real, listAnnotations: listAnnotations, removeAnnotations: vi.fn().mockResolvedValue(false) }
})

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { AnnotationListPanel } = await import('@/components/AnnotationListPanel')
const { contextMenuFor, getCommand } = await import('@/lib/commands')

const base = { docOpen: true, readOnly: false, mutationLock: false, currentPage: 1, pageCount: 3, selected: [], textSelected: false, stamping: false }
const ann = { onAnnotation: true, annotationId: 'a-7' }

beforeEach(() => {
  setLang('en')
  vi.clearAllMocks()
  post.mockResolvedValue({})
  listAnnotations.mockResolvedValue([
    { id: 'a-7', page: 2, type: 'Highlight', author: 'Ben', text: 'Wichtig', date: '2026-01-01' },
    { id: 'b-1', page: 3, type: 'Text', author: '', text: 'Rand', date: '2026-01-02' }
  ])
  useAppStore.setState({ docOpen: true, readOnly: false, mutationLock: false, signedDoc: false, pageCount: 3, currentPage: 1, commands: [], redoCommands: [], canUndo: false, canRedo: false, undoDepth: 0, toasts: [], docVersion: 1 })
  useUiStore.setState({ selected: [], anchor: null, pendingConfirm: null, selectedAnnotationId: null })
})

describe('contextMenuFor("annotation") (§6)', () => {
  it('enthält Eigenschaften primär, Löschen zerstörerisch zuletzt; ohne Ziel leer', () => {
    const m = contextMenuFor('annotation', { ...base, ...ann })
    expect(m.primary.map((c) => c.id)).toEqual(['ann.edit'])
    expect(m.destructive.map((c) => c.id)).toEqual(['ann.delete'])
    const none = contextMenuFor('annotation', base)
    expect(none.primary.length + none.destructive.length).toBe(0)
  })

  it('readOnly: beide weggelassen (kein grau)', () => {
    const m = contextMenuFor('annotation', { ...base, ...ann, readOnly: true })
    expect(m.primary.length + m.destructive.length).toBe(0)
  })

  it('kein Ziel (keine Annotations-ID) oder Sperre -> nichts verfügbar', () => {
    expect(getCommand('ann.delete')?.isEnabled(base)).toBe(false) // ohne Annotation unter dem Cursor: kein Eintrag
    expect(getCommand('ann.edit')?.isEnabled({ ...base, ...ann, mutationLock: true })).toBe(false)
  })
})

describe('Rechtsklick-Journey auf Annotations-Zeile (§6, echter Pfad)', () => {
  it('Öffnet Menü mit Typ+Seite als Kopf, Löschen trifft echten Endpunkt mit der Zeilen-ID', async () => {
    render(<AnnotationListPanel />)
    await screen.findByTestId('ann-item-0')
    fireEvent.contextMenu(screen.getByTestId('ann-item-0'))
    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
    expect(screen.getByTestId('ctx-scope')).toHaveTextContent('Highlight')
    expect(screen.getByTestId('ctx-scope')).toHaveTextContent('p. 2')
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((e) => e.getAttribute('data-testid'))
    expect(items).toEqual(['ctx-ann-edit', 'ctx-ann-delete']) // zerstörerisch zuletzt
    expect(screen.getByTestId('ctx-destructive-separator')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ctx-ann-delete'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/document/delete-annotation', { id: 'a-7' }))
    expect(screen.queryByTestId('context-menu')).toBeNull()
  })

  it('Eigenschaften bearbeiten wählt die Annotation aus (Editor öffnet sich, echter Store)', async () => {
    render(<AnnotationListPanel />)
    await screen.findByTestId('ann-item-1')
    fireEvent.contextMenu(screen.getByTestId('ann-item-1'))
    fireEvent.click(screen.getByTestId('ctx-ann-edit'))
    expect(useUiStore.getState().selectedAnnotationId).toBe('b-1')
  })

  it('readOnly: Menü zeigt keine Aktionen -> gar kein Menü-Stapel mit Einträgen', async () => {
    useAppStore.setState({ readOnly: true })
    render(<AnnotationListPanel />)
    await screen.findByTestId('ann-item-0')
    fireEvent.contextMenu(screen.getByTestId('ann-item-0'))
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(0)
  })
})
