import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { FacingColumn } from '@/components/FacingColumn'
import { allRows } from '@/lib/layout'
import type { PageDims } from '@/lib/viewerLayout'

// §7.4 Parität im DOM: Slots so groß wie die Seiten (nie größer), Label unter JEDE Seite,
// Platzhalter in realer Größe, Auswahl-Rahmen nur auf der aktuellen Seite.

const dims: PageDims[] = [
  { w: 100, h: 200 },
  { w: 60, h: 120 },
  { w: 100, h: 200 },
  { w: 80, h: 160 }
]

const renderTree = (): JSX.Element => (
  <FacingColumn
    dims={dims}
    rows={allRows('facing', 4)}
    scale={2}
    gap={20}
    innerGap={12}
    current={3}
    center={1}
    window={2}
    renderItem={(p, w, h) => <div data-testid={`rendered-${p}`} style={{ width: w, height: h }} />}
  />
)

describe('FacingColumn (§7.4)', () => {
  it('Slots exakt seitengroß, Paar nebeneinander, Höhe der kürzeren Seite bleibt real', () => {
    render(renderTree())
    const s1 = screen.getByTestId('facing-slot-1')
    const s2 = screen.getByTestId('facing-slot-2')
    expect(s1).toHaveStyle({ width: '200px', height: '400px' })
    expect(s2).toHaveStyle({ width: '120px', height: '240px' })
    expect(screen.getByTestId('facing-row-1')).toBeInTheDocument()
    expect(s1.closest('[data-testid="facing-row-1"]')).toBe(s2.closest('[data-testid="facing-row-1"]'))
  })

  it('Label unter jeder Seite; Auswahl-Rahmen nur auf der aktuellen Seite', () => {
    render(renderTree())
    expect(screen.getByTestId('facing-label-1').textContent).toBe('1')
    expect(screen.getByTestId('facing-label-4').textContent).toBe('4')
    expect(screen.getByTestId('facing-slot-3').className).toContain('ring-sky-500')
    expect(screen.getByTestId('facing-slot-1').className).not.toContain('ring-sky-500')
  })

  it('ferne Seiten: Platzhalter in REALer Größe (data-render=0), Nähe rendert echt', () => {
    render(renderTree())
    // center=1, window=2 -> Seiten 1..3 rendern; Seite 4 ist Platzhalter — in echter Größe.
    expect(screen.getByTestId('rendered-2')).toBeInTheDocument()
    const s4 = screen.getByTestId('facing-slot-4')
    expect(s4.getAttribute('data-render')).toBe('0')
    expect(s4).toHaveStyle({ width: '160px', height: '320px' })
    expect(s4).toHaveTextContent('…')
  })
})
