import { describe, it, expect } from 'vitest'
import { applySelection, selectionExpr, useUiStore, type Selection } from '@/store/useUiStore'

// Multi-Select-Semantik (Section 6): click / ctrl / shift, 1-basiert.

describe('applySelection', () => {
  it('click ersetzt die Auswahl und setzt Anker', () => {
    const r = applySelection({ selected: [1], anchor: 1 }, 4, 'click', 6)
    expect(r.selected).toEqual([4])
    expect(r.anchor).toBe(4)
  })
  it('ctrl fuegt hinzu / entfernt und sortiert', () => {
    let r: Selection = applySelection({ selected: [3], anchor: 3 }, 1, 'ctrl', 6)
    expect(r.selected).toEqual([1, 3])
    r = applySelection(r, 3, 'ctrl', 6)
    expect(r.selected).toEqual([1])
  })
  it('shift waehlt Bereich vom Anker (beide Richtungen)', () => {
    const down = applySelection({ selected: [2], anchor: 2 }, 5, 'shift', 8)
    expect(down.selected).toEqual([2, 3, 4, 5])
    const up = applySelection({ selected: [5], anchor: 5 }, 2, 'shift', 8)
    expect(up.selected).toEqual([2, 3, 4, 5])
    expect(up.anchor).toBe(5) // Anker bleibt
  })
  it('shift ohne Anker verhaelt sich wie click', () => {
    const r = applySelection({ selected: [], anchor: null }, 3, 'shift', 6)
    expect(r.selected).toEqual([3])
  })
  it('klemmt Seiten in den gueltigen Bereich', () => {
    expect(applySelection({ selected: [], anchor: null }, 99, 'click', 5).selected).toEqual([5])
  })
})

describe('selectionExpr', () => {
  it('komprimiert aufsteigend zu Komma-/Bereichsliste', () => {
    expect(selectionExpr([1, 2, 3, 7, 9, 10])).toBe('1-3,7,9-10')
    expect(selectionExpr([])).toBe('')
    expect(selectionExpr([5])).toBe('5')
  })
})

describe('useUiStore selection actions', () => {
  it('selectAllPages und clearSelection', () => {
    useUiStore.getState().selectAllPages(4)
    expect(useUiStore.getState().selected).toEqual([1, 2, 3, 4])
    useUiStore.getState().clearSelection()
    expect(useUiStore.getState().selected).toEqual([])
    expect(useUiStore.getState().anchor).toBeNull()
  })
})
