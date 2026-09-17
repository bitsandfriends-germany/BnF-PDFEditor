import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const TextLayerCtor = vi.fn()
class FakeTextLayer {
  opts: Record<string, unknown>
  constructor(opts: Record<string, unknown>) {
    this.opts = opts
    TextLayerCtor(opts)
  }
  async render() {
    const c = this.opts.container as HTMLElement
    const span = document.createElement('span')
    span.textContent = 'Hallo Welt'
    c.appendChild(span)
  }
  cancel = vi.fn()
}

vi.mock('@/lib/pdfjs', () => ({
  pdfjs: { TextLayer: FakeTextLayer },
  openDocumentFromBytes: vi.fn()
}))

const { PageTextLayer } = await import('@/components/PageTextLayer')

const makeDoc = () => ({
  getPage: vi.fn(async () => ({ streamTextContent: () => ({}) }))
})

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PageTextLayer (Section 5)', () => {
  it('baut eine TextLayer-Instanz mit Viewport + Container und fuellt sie', async () => {
    const doc = makeDoc() as never
    render(<PageTextLayer doc={doc} pageNumber={3} viewport={{ width: 612, height: 792 } as never} />)
    const layer = screen.getByTestId('text-layer')
    await waitFor(() => expect(TextLayerCtor).toHaveBeenCalledTimes(1))
    const opt = TextLayerCtor.mock.calls[0]?.[0] as { container: HTMLElement; viewport: unknown }
    expect(opt.container).toBe(layer)
    expect(opt.viewport).toMatchObject({ width: 612 })
    await waitFor(() => expect(layer).toHaveTextContent('Hallo Welt'))
  })

  it('ohne Viewport/Doc wird keine Instanz gebaut', () => {
    const doc = makeDoc() as never
    render(<PageTextLayer doc={doc} pageNumber={1} viewport={null} />)
    render(<PageTextLayer doc={null} pageNumber={1} viewport={{} as never} />)
    expect(TextLayerCtor).not.toHaveBeenCalled()
  })

  it('leert den Container beim Unmount', async () => {
    const doc = makeDoc() as never
    const view = { width: 612, height: 792 } as never
    const { unmount } = render(<PageTextLayer doc={doc} pageNumber={2} viewport={view} />)
    await waitFor(() => expect(screen.getByTestId('text-layer')).toHaveTextContent('Hallo Welt'))
    unmount()
    expect(screen.queryByTestId('text-layer')).toBeNull()
  })
})
