import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import type { CommandContext } from '@/lib/commands'

// §6 Textauswahl-Aktionen (Canvas-Menü oben): Modell-Reihenfolge + Weglassregeln, und die
// ECHTEN Handler-Runs — addAnnotation/applyRedaction sind die in §3 verifizierten Endpunkte;
// hier wird die korrekte Anfrage (Seite 0-basiert vs. Redact 1-basiert!) bewiesen.

const addAnnotation = vi.fn(async () => true)
const applyRedaction = vi.fn(async () => true)
vi.mock('@/lib/documents', () => ({
  addAnnotation: (...a: unknown[]) => addAnnotation(...(a as [{ page0: number }])),
  applyRedaction: (...a: unknown[]) => applyRedaction(...(a as [{ page: number }[]]))
}))

const { setLang } = await import('@/i18n')
const { contextMenuFor, getCommand } = await import('@/lib/commands')
const { useUiStore } = await import('@/store/useUiStore')
const { useAiStore } = await import('@/store/useAiStore')

const rect = { x: 10, y: 480, width: 100, height: 20 }
const base = (over: Partial<CommandContext>): CommandContext => ({
  docOpen: true, readOnly: false, mutationLock: false, currentPage: 5, pageCount: 9, selected: [5],
  textSelected: true, stamping: false, selectionText: 'wichtiger Text', selectionRect: rect, selectionPage: 5, ...over
})

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  useUiStore.setState({ activeTab: 'thumbnails' })
})

describe('contextMenuFor canvas mit Textauswahl (§6)', () => {
  it('Auswahl-Aktionen stehen VOR den Seiten-Operationen; Schwärzen ist zerstörerisch (unten)', () => {
    const m = contextMenuFor('canvas', base({}))
    // ts.* sind Alltagsaktionen und bleiben Ebene 1; pg.rot* lives im PDF-Flyout.
    const ids = m.primary.map((c) => c.id)
    expect(ids.slice(0, 3)).toEqual(['ts.copy', 'ts.highlight', 'ts.underline'])
    expect(ids).toContain('ts.strikeout')
    const flyout = (m.groups ?? []).flatMap((g) => g.items.map((c) => c.id))
    expect(flyout).toContain('pg.rotLeft')
    // Reihen ueber Ebenen: primary vor Gruppen
    expect((m.groups ?? []).length).toBeGreaterThan(0)
    expect(m.destructive.map((c) => c.id)).toEqual(['pg.clear', 'ts.redact', 'pg.delete'])
  })

  it('ohne Auswahl: KEINE ts.-Einträge (fortlassen, nicht grau)', () => {
    const m = contextMenuFor('canvas', base({ textSelected: false }))
    expect(m.primary.every((c) => !c.id.startsWith('ts.'))).toBe(true)
    expect(m.destructive.map((c) => c.id)).toEqual(['pg.clear', 'pg.delete'])
  })

  it('readOnly: nur wirkungsfreie Auswahl-Aktionen bleiben (Kopieren, KI)', () => {
    const m = contextMenuFor('canvas', base({ readOnly: true }))
    const ts = [...m.primary, ...m.destructive].filter((c) => c.id.startsWith('ts.'))
    expect(ts.map((c) => c.id).sort()).toEqual(['ts.askAi', 'ts.copy'])
  })

  it('Thumbnail-Menü bleibt frei von Auswahl-Aktionen (Ziel-Kontrolle)', () => {
    const m = contextMenuFor('thumbnail', base({}))
    expect([...m.primary, ...m.destructive].some((c) => c.id.startsWith('ts.'))).toBe(false)
  })
})

describe('echte Handler der Auswahl-Befehle (§2/§3-Pfade)', () => {
  it('Kopieren schreibt den Auswahltext in die Zwischenablage', () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    getCommand('ts.copy')?.run(base({}))
    expect(writeText).toHaveBeenCalledWith('wichtiger Text')
  })

  it('Hervorheben -> addAnnotation seitenrichtig (page0 = Seite-1) mit PDF-Rechteck', () => {
    getCommand('ts.highlight')?.run(base({}))
    expect(addAnnotation).toHaveBeenCalledWith({ page0: 4, type: 'Highlight', x: 10, y: 480, width: 100, height: 20 })
    getCommand('ts.underline')?.run(base({}))
    expect(addAnnotation).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'Underline' }))
    getCommand('ts.strikeout')?.run(base({}))
    expect(addAnnotation).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'StrikeOut' }))
  })

  it('Schwärzen -> applyRedaction mit 1-basierter Seite (Backend-Konvention p1)', () => {
    getCommand('ts.redact')?.run(base({}))
    expect(applyRedaction).toHaveBeenCalledWith([{ page: 5, x: 10, y: 480, width: 100, height: 20 }])
  })

  it('KI fragen öffnet den AI-Tab und stellt die echte Frage mit dem Zitat', async () => {
    const ask = vi.fn(async () => {})
    useAiStore.setState({ ask } as never)
    getCommand('ts.askAi')?.run(base({}))
    expect(useUiStore.getState().activeTab).toBe('ai')
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('wichtiger Text'))
  })

  it('Porten: ohne Dokument/rechtefrei/mutierend -> kein Markup-Befehl aktiv', () => {
    const c = base({})
    expect(getCommand('ts.highlight')?.isEnabled(c)).toBe(true)
    expect(getCommand('ts.highlight')?.isEnabled(base({ readOnly: true }))).toBe(false)
    expect(getCommand('ts.highlight')?.isEnabled(base({ mutationLock: true }))).toBe(false)
    expect(getCommand('ts.redact')?.isEnabled(base({ docOpen: false }))).toBe(false)
    expect(getCommand('ts.highlight')?.isEnabled(base({ selectionRect: undefined }))).toBe(false)
  })
})
