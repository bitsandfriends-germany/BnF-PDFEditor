import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { InteractionOverlay } from '@/components/InteractionOverlay'

// Stub-Viewport mit deterministischer Umrechnung (kein pdfjs-Runtime noetig).
const stub = {
  convertToPdfPoint: (x: number, y: number): number[] => [x / 2, 200 - y / 2]
}

function root(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-tool]')
  if (!el) throw new Error('Overlay-Root nicht gefunden')
  return el as HTMLElement
}

describe('InteractionOverlay', () => {
  it('ist passiv (pointer-events none), wenn kein Tool aktiv ist', () => {
    const { container } = render(<InteractionOverlay viewport={stub} activeTool="none" />)
    expect(root(container).style.pointerEvents).toBe('none')
    expect(root(container).getAttribute('data-tool')).toBe('none')
  })

  it('sendet kein Rechteck, wenn kein Tool aktiv ist', () => {
    const onRect = vi.fn()
    const { container } = render(<InteractionOverlay viewport={stub} activeTool="none" onRect={onRect} />)
    const el = root(container)
    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(el, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1 })
    expect(onRect).not.toHaveBeenCalled()
  })

  it('emittiert bei select-rect ein PDF-Raum-Rechteck (unten-links, positiv)', () => {
    const onRect = vi.fn()
    const { container } = render(<InteractionOverlay viewport={stub} activeTool="select-rect" onRect={onRect} />)
    const el = root(container)
    expect(el.style.pointerEvents).toBe('auto')
    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(el, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1 })
    // toPdf(0,0)=[0,200]; toPdf(100,100)=[50,150] -> x=0,y=150,w=50,h=50
    expect(onRect).toHaveBeenCalledTimes(1)
    expect(onRect.mock.calls[0]?.[0]).toEqual({ x: 0, y: 150, width: 50, height: 50 })
  })

  it('Esc bricht das aktive Tool ab', () => {
    const onToolCancel = vi.fn()
    render(<InteractionOverlay viewport={stub} activeTool="select-rect" onToolCancel={onToolCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onToolCancel).toHaveBeenCalledTimes(1)
  })

  it('Kinder behalten pointer-events:auto permanent (auch ohne Tool)', () => {
    const { container } = render(
      <InteractionOverlay viewport={stub} activeTool="none">
        <div data-testid="handle">Griff</div>
      </InteractionOverlay>
    )
    const handles = container.querySelector('[data-testid="handle"]')?.parentElement
    expect(handles?.getAttribute('style')).toContain('pointer-events: auto')
  })
})
