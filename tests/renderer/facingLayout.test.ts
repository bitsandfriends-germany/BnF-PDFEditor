import { describe, it, expect } from 'vitest'
import { buildFacingColumn, type PageDims } from '@/lib/viewerLayout'
import { allRows } from '@/lib/layout'

// §7.4 Doppelseiten-Parität: gleiche Modellregeln wie buildColumn — reale Slot-Größen,
// Zeilenhöhe = max, gleiche Lücken, center±window Render-Fenster, center-unabhängige Offsets.

const dims: PageDims[] = [
  { w: 100, h: 200 }, // S1
  { w: 50, h: 100 }, // S2 schmaler/kürzer
  { w: 100, h: 200 }, // S3
  { w: 80, h: 160 } // S4
]

describe('buildFacingColumn (§7.4)', () => {
  it('Zeilen aus allRows(facing): Höhe = max der Seiten, Zellen aus REALen Maßen', () => {
    const rows = allRows('facing', 4)
    expect(rows).toEqual([[1, 2], [3, 4]])
    const L = buildFacingColumn(rows, dims, 2, 20, 1, 2)
    const r0 = L.rows[0]
    expect(r0?.height).toBe(400) // max(200*2, 100*2)
    expect(r0?.cells.map((c) => [c.page, c.w, c.h])).toEqual([[1, 200, 400], [2, 100, 200]])
  })

  it('Gesamthöhe = Σ Zeilenmax + gleiche Lücken; Offsets kumulativ und center-unabhängig', () => {
    const rows = allRows('facing', 4)
    const a = buildFacingColumn(rows, dims, 1, 20, 1, 0)
    const b = buildFacingColumn(rows, dims, 1, 20, 4, 0)
    expect(a.rows.map((r) => r.top)).toEqual([0, 220]) // 200 + 20
    expect(a.totalHeight).toBe(420) // max(200,100)=200, max(200,160)=200, je +20 Abstand
    expect(b.rows.map((r) => r.top)).toEqual(a.rows.map((r) => r.top))
    expect(b.totalHeight).toBe(a.totalHeight)
  })

  it('Render-Fenster center±2 Seiten: ferne Zeile = Platzhalter, Zeilencontainment wirkt', () => {
    const many: PageDims[] = Array.from({ length: 20 }, () => ({ w: 10, h: 10 }))
    const rows = allRows('facing', 20)
    const L = buildFacingColumn(rows, many, 1, 10, 10, 2)
    // center=10: Zeile [9,10],[11,12] gerendert (Seiten 8..12), [1,2] nicht — aber reale Größe da.
    expect(L.rows[0]?.render).toBe(false)
    expect(L.rows[0]?.cells.every((c) => !c.render)).toBe(true)
    const row9 = L.rows.find((r) => r.cells.some((c) => c.page === 9))
    expect(row9?.render).toBe(true)
    expect(row9?.cells.every((c) => c.render)).toBe(true)
    const row7 = L.rows.find((r) => r.cells.some((c) => c.page === 7))
    // [7,8]: Seite 8 liegt noch im Fenster (|8-10|=2) -> Zeile teilweise sichtbar, Seite 7 Platzhalter.
    expect(row7?.render).toBe(true)
    expect(row7?.cells.find((c) => c.page === 7)?.render).toBe(false)
    expect(row7?.cells.find((c) => c.page === 8)?.render).toBe(true)
  })

  it('ungerade letzte Seite bleibt Einzelzelle; facing-cover startet mit 1er-Zeile', () => {
    const rowsOdd = allRows('facing', 5)
    expect(rowsOdd[2]).toEqual([5])
    const L = buildFacingColumn(rowsOdd, [...dims, { w: 10, h: 10 }], 1, 0, 1, 9)
    expect(L.rows[2]?.cells.length).toBe(1)
    const cover = allRows('facing-cover', 4)
    expect(cover[0]).toEqual([1])
  })
})
