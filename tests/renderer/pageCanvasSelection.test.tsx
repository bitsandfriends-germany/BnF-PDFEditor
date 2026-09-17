import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// §6: Der Seiten-Fänger meldet Auswahl TEXT + PDF-Rechteck über dieselbe Viewport-Naht wie der
// Overlay-Drag. Bewiesen: richtige Seite (anchor in text-layer dieser Seite), y-Achsen-Inversion,
// Collapsed -> null, Auswahl auf ANDERER Seite -> keine Meldung an diese Instanz.

vi.mock('@/lib/pdfjs', () => ({ pdfjs: {} }))
vi.mock('@/hooks/usePdfPageRender', () => ({
  usePdfPageRender: () => ({
    cssWidth: 400, cssHeight: 520, status: 'done' as const,
    viewport: { convertToPdfPoint: (x: number, y: number) => [x, 520 - y] }
  })
}))

const { PageCanvas } = await import('@/components/PageCanvas')

function fakeSelection(opts: { collapsed?: boolean; anchorInPage?: number; text?: string; box?: { left: number; top: number; width: number; height: number } }) {
  const layer = opts.anchorInPage !== undefined
    ? document.querySelector(`[data-testid="text-layer"][data-page="${opts.anchorInPage}"]`)
    : null
  const fake = {
    isCollapsed: opts.collapsed ?? false,
    rangeCount: 1,
    anchorNode: layer ?? document.body,
    getRangeAt: () => ({ getBoundingClientRect: () => opts.box ?? { left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 } }),
    toString: () => opts.text ?? 'wichtiger Text'
  }
  vi.spyOn(window, 'getSelection').mockReturnValue(fake as unknown as Selection)
}

const fire = (): void => { document.dispatchEvent(new Event('selectionchange')) }

beforeEach(() => { vi.restoreAllMocks() })

describe('PageCanvas Auswahl-Fänger (§6)', () => {
  it('meldet Text + PDF-Rechteck (y invertiert) der richtigen Seite', () => {
    const onSelection = vi.fn()
    render(<PageCanvas doc={null} pageNumber={3} scale={1} onSelection={onSelection} />)
    fakeSelection({ anchorInPage: 3 })
    fire()
    expect(onSelection).toHaveBeenCalledWith(3, {
      text: 'wichtiger Text',
      rect: { x: 10, y: 480, width: 100, height: 20 }
    })
  })

  it('collapsed -> null; Auswahl auf anderer Seite -> keine Meldung', () => {
    const onSelection = vi.fn()
    render(<PageCanvas doc={null} pageNumber={3} scale={1} onSelection={onSelection} />)
    fakeSelection({ collapsed: true })
    fire()
    expect(onSelection).toHaveBeenLastCalledWith(3, null)
    onSelection.mockClear()
    fakeSelection({ anchorInPage: 8 }) // andere Seiten-Instanz ist nicht gemountet: Anker gehört ihr
    fire()
    expect(onSelection).not.toHaveBeenCalled()
  })

  it('ohne Text (nur Whitespace) -> null', () => {
    const onSelection = vi.fn()
    render(<PageCanvas doc={null} pageNumber={3} scale={1} onSelection={onSelection} />)
    fakeSelection({ anchorInPage: 3, text: '   ' })
    fire()
    expect(onSelection).toHaveBeenLastCalledWith(3, null)
  })
})
