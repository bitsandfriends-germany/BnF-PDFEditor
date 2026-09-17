import { describe, it, expect } from 'vitest'
import { thumbnailWindow } from '@/lib/thumbnailWindow'

describe('thumbnailWindow (Virtualisierung)', () => {
  it('oben: Fenster beginnt bei 0 und endet vor der Gesamtzahl', () => {
    const w = thumbnailWindow(500, 0, 800, 120, 4)
    expect(w.start).toBe(0)
    expect(w.end).toBeGreaterThan(6) // ca. 7 sichtbar + Overscan
    expect(w.end).toBeLessThanOrEqual(500)
  })

  it('gescrollt: das aktuelle Element liegt im Fenster', () => {
    const w = thumbnailWindow(500, 2400, 800, 120, 4)
    const current = Math.floor(2400 / 120) // 20
    expect(w.start).toBeLessThanOrEqual(current)
    expect(w.end).toBeGreaterThan(current)
  })

  it('klemmt an beide Raender (Overscan ueber die Liste hinaus)', () => {
    const nearEnd = thumbnailWindow(10, 5000, 800, 120, 4)
    expect(nearEnd.start).toBeGreaterThanOrEqual(0)
    expect(nearEnd.end).toBeLessThanOrEqual(10)
  })

  it('leer -> leeres Fenster', () => {
    expect(thumbnailWindow(0, 0, 800, 120)).toEqual({ start: 0, end: 0 })
  })
})
