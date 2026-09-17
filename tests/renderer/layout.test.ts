import { describe, it, expect } from 'vitest'
import { pageRowsFor, allRows, isSideBySide } from '@/lib/layout'
import { useUiStore } from '@/store/useUiStore'

// Section 5: Page-Layout-Modi. Reine Fenster-/Gruppenlogik.

describe('allRows Gruppierung', () => {
  it('continuous: jede Seite eigene Zeile', () => {
    expect(allRows('continuous', 4)).toEqual([[1], [2], [3], [4]])
  })
  it('facing: Paare ab Seite 1', () => {
    expect(allRows('facing', 5)).toEqual([[1, 2], [3, 4], [5]])
  })
  it('facing-cover: Seite 1 allein, dann Paare', () => {
    expect(allRows('facing-cover', 6)).toEqual([[1], [2, 3], [4, 5], [6]])
  })
  it('single: eine Zeile', () => {
    expect(allRows('single', 10)).toEqual([[1]])
  })
})

describe('pageRowsFor Fenster um Fokusseite', () => {
  it('single zeigt genau die Fokusseite', () => {
    expect(pageRowsFor('single', 10, 7)).toEqual([[7]])
  })
  it('continuous: Fenster von +/- window Seiten', () => {
    expect(pageRowsFor('continuous', 20, 5, 2)).toEqual([[3], [4], [5], [6], [7]])
  })
  it('clamp an den Raendern (Anfang)', () => {
    expect(pageRowsFor('continuous', 20, 1, 2)).toEqual([[1], [2], [3]])
  })
  it('clamp an den Raendern (Ende)', () => {
    expect(pageRowsFor('continuous', 5, 5, 2)).toEqual([[3], [4], [5]])
  })
  it('facing: Fenster mit ganzen Paaren', () => {
    // center 3 liegt in [3,4]; window 1 -> [1,2],[3,4],[5,6]
    expect(pageRowsFor('facing', 7, 3, 1)).toEqual([[1, 2], [3, 4], [5, 6]])
  })
  it('leeres Dokument -> keine Zeilen', () => {
    expect(pageRowsFor('continuous', 0, 1)).toEqual([])
  })
})

describe('isSideBySide', () => {
  it('nur bei Doppelseiten', () => {
    expect(isSideBySide('facing')).toBe(true)
    expect(isSideBySide('facing-cover')).toBe(true)
    expect(isSideBySide('continuous')).toBe(false)
    expect(isSideBySide('single')).toBe(false)
  })
})

describe('useUiStore layoutMode', () => {
  it('Default ist continuous', () => {
    expect(useUiStore.getState().layoutMode).toBe('continuous')
  })
  it('setLayoutMode setzt', () => {
    useUiStore.getState().setLayoutMode('facing-cover')
    expect(useUiStore.getState().layoutMode).toBe('facing-cover')
    useUiStore.getState().setLayoutMode('continuous')
  })
})
