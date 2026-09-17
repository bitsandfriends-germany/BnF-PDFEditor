import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// §7.5/§7.6: die Seiten-Werkzeugleiste wird aus der Registry gerendert und hält die feste
// §5-Gruppenreihenfolge EINER Zeile (kein Wrap). Hier DOM-seitig: reale Button-Reihenfolge prüfen.

const post = vi.fn()
class ApiError extends Error { code: string; constructor(c: string, m: string) { super(m); this.name = 'ApiError'; this.code = c } }
vi.mock('@/lib/apiClient', () => ({ api: { get: vi.fn().mockResolvedValue({ open: true }), post, del: vi.fn(), getBytes: vi.fn() }, ApiError, sseStream: vi.fn() }))

const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { PagesToolbar } = await import('@/components/PagesToolbar')
const { TOOLBAR_GROUPS, COMMANDS } = await import('@/lib/commands')
const { SHORTCUTS, formatShortcut } = await import('@/lib/shortcuts')
const { getLang } = await import('@/i18n')

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ docOpen: true, readOnly: false, pageCount: 3, currentPage: 2, signedDoc: false, mutationLock: false, commands: [], redoCommands: [], canUndo: false, canRedo: false, undoDepth: 0, toasts: [], docVersion: 1 })
  useUiStore.setState({ selected: [], anchor: null, pendingConfirm: null })
})

function renderedPageCmdOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="pg-"]'))
    .map((el) => (el.getAttribute('data-testid') ?? ''))
    .filter((id) => id !== 'pages-toolbar' && id !== 'pages-count')
}

describe('PagesToolbar rendert aus der Registry (§7.5)', () => {
  // R75: Der Tooltip ist jetzt eine echte Hover-Ueberlagerung (Komponente Tooltip) statt eines
  // nativen title-Attributs. Geprueft wird derselbe Vertrag wie in §5: JEDES Steuerelement zeigt
  // beim Verweilen eine Erklaerung, und bei hinterlegtem Shortcut nennt der Text auch die Tasten.
  it('jedes Steuerelement zeigt beim Hover einen Tooltip mit Erklaerung und Shortcut (§5/R75)', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(<PagesToolbar />)
      const buttons = Array.from(container.querySelectorAll('button[data-testid]'))
      expect(buttons.length).toBeGreaterThan(0)
      const modName = getLang() === 'de' ? 'Strg' : 'Ctrl'
      const shiftName = getLang() === 'de' ? 'Umschalt' : 'Shift'
      for (const b of buttons) {
        const testid = b.getAttribute('data-testid') ?? ''
        fireEvent.mouseOver(b)
        act(() => {
          vi.advanceTimersByTime(400) // Anzeigeverzoegerung des Tooltips
        })
        const tip = container.querySelector('[role="tooltip"]')
        expect(tip, `Tooltip von ${testid}`).not.toBeNull()
        const text = tip?.textContent ?? ''
        expect(text.length, `Erklaerung von ${testid}`).toBeGreaterThan(3)
        const cmd = COMMANDS.find((c) => c.testid === testid)
        const sc = cmd?.shortcutId !== undefined ? SHORTCUTS.find((x) => x.id === cmd.shortcutId) : undefined
        if (sc !== undefined) expect(text, cmd!.id).toContain(formatShortcut(sc, modName, shiftName))
        fireEvent.mouseOut(b)
        act(() => {
          vi.advanceTimersByTime(20)
        })
        expect(container.querySelector('[role="tooltip"]'), `Tooltip schliesst bei ${testid}`).toBeNull()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('Button-Reihenfolge folgt den §5-Gruppen (rotate vor arrange vor extractSplit vor content)', () => {
    const { container } = render(<PagesToolbar />)
    const order = renderedPageCmdOrder(container)
    const rank = (id: string): number => {
      const group = TOOLBAR_GROUPS.find((g) => {
        // testid -> gruppe über die Registry-Reihenfolge; grob über Prefixe
        return false || (id === 'pg-rot-left' || id === 'pg-rot-right' || id === 'pg-rot-180') ? g === 'rotate' : false
      })
      void group
      const idx = (g: string): number => TOOLBAR_GROUPS.indexOf(g as never)
      if (id.startsWith('pg-rot')) return idx('rotate')
      if (id === 'pg-dup' || id === 'pg-del') return idx('arrange')
      if (id === 'pg-insert') return idx('insert')
      if (id === 'pg-extract' || id === 'pg-split') return idx('extractSplit')
      if (['pg-numbers', 'pg-watermark', 'pg-stamp', 'pg-stamp-image', 'pg-images'].includes(id)) return idx('content')
      if (id === 'pg-flatten' || id === 'pg-export') return idx('layers')
      return 99
    }
    const ranks = order.map(rank)
    // nicht fallend => Gruppenreihenfolge respektiert
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]!).toBeGreaterThanOrEqual(ranks[i - 1]!)
    // explizite Anker
    expect(order.indexOf('pg-rot-right')).toBeLessThan(order.indexOf('pg-del'))
    expect(order.indexOf('pg-del')).toBeLessThan(order.indexOf('pg-insert'))
    expect(order.indexOf('pg-insert')).toBeLessThan(order.indexOf('pg-extract'))
    expect(order.indexOf('pg-extract')).toBeLessThan(order.indexOf('pg-stamp'))
  })

  it('zerstörerisches Löschen steht nach dem Duplizieren (mit Abstand davor)', () => {
    const { container } = render(<PagesToolbar />)
    const del = container.querySelector('[data-testid="pg-del"]')
    expect(del).not.toBeNull()
    // unmittelbar vor dem Delete-Button sitzt ein Abstands-Element (width-Klasse), nicht direkt nach dup
    const wrapper = del?.parentElement
    expect(wrapper?.firstElementChild?.className).toContain('w-2')
  })

  it('ohne Dokument verschwinden die Dokument-Aktionen (keine toten Kontrollen)', () => {
    useAppStore.setState({ docOpen: false })
    const { container } = render(<PagesToolbar />)
    expect(container.querySelector('[data-testid="pg-rot-right"]')).toBeNull()
  })
})
