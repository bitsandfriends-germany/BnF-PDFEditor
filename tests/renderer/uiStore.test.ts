import { describe, it, expect } from 'vitest'
import { clampZoom, clampPage, stepZoom, ZOOM_MIN, ZOOM_MAX } from '@/store/useUiStore'

describe('Zoom & Paginierung (Section 4A)', () => {
  it('klemmt den Zoom hart auf 10 %–800 %', () => {
    expect(clampZoom(0.02)).toBe(ZOOM_MIN)
    expect(clampZoom(50)).toBe(ZOOM_MAX)
    expect(clampZoom(NaN)).toBe(1)
    expect(clampZoom(1.5)).toBe(1.5)
  })

  it('klemmt die Seitenzahl auf den gueltigen Bereich', () => {
    expect(clampPage(0, 10)).toBe(1)
    expect(clampPage(99, 10)).toBe(10)
    expect(clampPage(4, 0)).toBe(1)
    expect(clampPage(3.7, 10)).toBe(3)
  })

  it('stepZoom bleibt innerhalb der Grenzen und ist multiplikativ', () => {
    expect(stepZoom(1, 1)).toBeCloseTo(1.2, 5)
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
  })
})
