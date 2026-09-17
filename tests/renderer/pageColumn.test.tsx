import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageColumn } from '@/components/PageColumn'
import { buildColumn, type PageDims } from '@/lib/viewerLayout'

// PART 3 §4 auf DOM-Ebene (jsdom): Inline-Stile + Text, ohne echtes pdfjs-Rendering.
// Belegt: jeder Slot == reale Seitengröße (kein größerer Wrapper), nicht sichtbare Seiten sind
// Platzhalter REALER Größe, Seitenlabels vorhanden, Spaltenhöhe == Summe + Abstände.

const DIMS: PageDims[] = [
  { w: 595, h: 842 },
  { w: 842, h: 595 },
  { w: 842, h: 1191 },
  { w: 842, h: 595 }
]
const SCALE = 0.5
const GAP = 20

describe('PageColumn §4 DOM', () => {
  const col = buildColumn(DIMS, SCALE, 0, 2, GAP)

  it('Slotgröße == reale Seitengröße (viewport*scale), nie größer', () => {
    render(
      <PageColumn dims={DIMS} scale={SCALE} center={0} gap={GAP} current={1} renderItem={() => <div data-testid="pg" />} />
    )
    DIMS.forEach((d, i) => {
      const slot = screen.getByTestId(`page-slot-${i + 1}`)
      expect(slot.style.width).toBe(`${Math.round(d.w * SCALE)}px`)
      expect(slot.style.height).toBe(`${Math.round(d.h * SCALE)}px`)
    })
  })

  it('center±window rendert, Rest Platzhalter realer Größe', () => {
    render(
      <PageColumn dims={DIMS} scale={SCALE} center={0} gap={GAP} current={1} renderItem={() => <div />} />
    )
    // center=0, window=2 -> Seiten 1..3 rendern, Seite 4 Platzhalter.
    expect(screen.getByTestId('page-slot-1').dataset.render).toBe('1')
    expect(screen.getByTestId('page-slot-3').dataset.render).toBe('1')
    const ph = screen.getByTestId('page-slot-4')
    expect(ph.dataset.render).toBe('0')
    // Platzhalter trägt REALE Größe seiner Seite (4. Seite 842x595 -> 421x298).
    expect(ph.style.width).toBe(`${Math.round(842 * SCALE)}px`)
    expect(ph.style.height).toBe(`${Math.round(595 * SCALE)}px`)
  })

  it('Seitenlabels vorhanden', () => {
    render(
      <PageColumn dims={DIMS} scale={SCALE} center={0} gap={GAP} current={1} renderItem={() => <div />} />
    )
    expect(screen.getByTestId('page-label-2').textContent).toBe('2')
  })

  it('Spaltenhöhe == Summe Seitenhöhen + Abstände (ohne Labels)', () => {
    render(
      <PageColumn dims={DIMS} scale={SCALE} center={0} gap={GAP} current={1} renderItem={() => <div />} />
    )
    expect(screen.getByTestId('page-column').style.height).toBe(`${col.totalHeight}px`)
  })
})
