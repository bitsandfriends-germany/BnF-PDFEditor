import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { pageLabelFor } from '@/lib/viewerLayout'
import { PageColumn } from '@/components/PageColumn'
import { FacingColumn } from '@/components/FacingColumn'
import { allRows } from '@/lib/layout'

// §4: eigener Seitenlabel NUR wo definiert; sonst laufende Nummer. Spalten rendern labelFor.

describe('pageLabelFor (§4)', () => {
  it('eigener Label (römisch) mit arabischer Ergänzung; fehlend/leer -> Nummer', () => {
    expect(pageLabelFor(['i', 'ii', null, ''], 1)).toBe('i (1)')
    expect(pageLabelFor(['i', 'ii', null, 'iv'], 4)).toBe('iv (4)')
    expect(pageLabelFor(['i', 'ii', null, ''], 3)).toBe('3')
    expect(pageLabelFor([], 7)).toBe('7')
    expect(pageLabelFor(['  iv  '], 1)).toBe('iv (1)')
  })
})

describe('labelFor in beiden Spalten (§4)', () => {
  const dims = [{ w: 100, h: 100 }, { w: 100, h: 100 }, { w: 100, h: 100 }, { w: 100, h: 100 }]
  const label = (p: number): string => (p === 1 ? 'i (1)' : String(p))

  it('PageColumn zeigt eigenen Label unter der Seite', () => {
    render(
      <PageColumn dims={dims} scale={1} center={0} gap={20} current={1} renderItem={() => <span />} labelFor={label} />
    )
    expect(screen.getByTestId('page-label-1').textContent).toBe('i (1)')
    expect(screen.getByTestId('page-label-2').textContent).toBe('2')
  })

  it('FacingColumn zeigt eigenen Label je Seite', () => {
    render(
      <FacingColumn dims={dims} rows={allRows('facing', 4)} scale={1} gap={20} innerGap={8} current={1} center={1} renderItem={() => <span />} labelFor={label} />
    )
    expect(screen.getByTestId('facing-label-1').textContent).toBe('i (1)')
    expect(screen.getByTestId('facing-label-3').textContent).toBe('3')
  })
})
