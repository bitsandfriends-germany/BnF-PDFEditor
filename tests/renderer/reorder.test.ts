import { describe, it, expect } from 'vitest'
import { moveBlockOrder } from '@/lib/reorder'

// Section 6: mehrseitige Auswahl als Block verschieben -> 0-basierte Permutation fuer /pages/reorder.
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i)
const valid = (o: number[] | null, n: number): boolean => !!o && o.length === n && [...o].sort((a, b) => a - b).join() === range(n).join()

describe('moveBlockOrder', () => {
  it('einfache Seite vor Zielseite', () => {
    expect(moveBlockOrder(5, [2], 4, false)).toEqual([0, 2, 1, 3, 4]) // [1,3,2,4,5]
  })
  it('einfache Seite hinter Zielseite', () => {
    expect(moveBlockOrder(5, [2], 4, true)).toEqual([0, 2, 3, 1, 4]) // [1,3,4,2,5]
  })
  it('Block (mehrere Seiten) wandert zusammen', () => {
    const o = moveBlockOrder(5, [1, 2], 4, false)
    expect(o).toEqual([2, 0, 1, 3, 4]) // [3,1,2,4,5]
    expect(valid(o, 5)).toBe(true)
  })
  it('Drop ans Ende (dropTarget null)', () => {
    expect(moveBlockOrder(5, [2], null, false)).toEqual([0, 2, 3, 4, 1]) // [1,3,4,5,2]
  })
  it('Drop auf eigene Seite -> null (No-Op)', () => {
    expect(moveBlockOrder(5, [2, 3], 3, false)).toBeNull()
  })
  it('alles ausgewaehlt -> null (nichts zu verschieben)', () => {
    expect(moveBlockOrder(3, [1, 2, 3], null, false)).toBeNull()
  })
  it('Ergebnis ist stets gueltige Permutation', () => {
    for (const mv of [[1], [3], [1, 2, 3], [2, 4]]) {
      for (const tgt of [1, 2, 3, 4, 5, null]) {
        for (const after of [true, false]) {
          const o = moveBlockOrder(5, mv, tgt as number | null, after)
          if (o) expect(valid(o, 5)).toBe(true)
        }
      }
    }
  })
  it('leeres Dokument / leere Auswahl -> null', () => {
    expect(moveBlockOrder(0, [1], 1, false)).toBeNull()
    expect(moveBlockOrder(5, [], 2, false)).toBeNull()
  })
})
