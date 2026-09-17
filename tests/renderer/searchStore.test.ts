import { describe, it, expect, beforeEach } from 'vitest'
import { useSearchStore } from '@/store/useSearchStore'
import { useAppStore } from '@/store/useAppStore'

// Der reine Matcher ist separat getestet; hier die Store-Reduktion: Treffer, Reihenfolge,
// noTextPages, next/prev mit Wrap und Navigation zur Trefferseite.

beforeEach(() => {
  useSearchStore.setState({ query: '', opts: { caseSensitive: false, wholeWord: false, diacriticInsensitive: true }, matches: [], activeIndex: -1, noTextPages: [], texts: {}, docVersion: 5 })
  useAppStore.setState({ currentPage: 1, pageCount: 5 })
})

describe('useSearchStore.runSearch', () => {
  it('findet Grundstueck -> Grundstueck und springt zur Seite', async () => {
    useSearchStore.setState({ query: 'grundstuck', texts: { 1: 'nichts', 3: 'ein Grundstück' } })
    await useSearchStore.getState().runSearch()
    const st = useSearchStore.getState()
    expect(st.matches).toHaveLength(1)
    expect(st.matches[0]?.page).toBe(3)
    expect(st.activeIndex).toBe(0)
    expect(useAppStore.getState().currentPage).toBe(3)
  })
  it('meldet Seiten ohne Textebene', async () => {
    useSearchStore.setState({ query: 'x', texts: { 1: null, 2: 'x', 3: '   ' } })
    await useSearchStore.getState().runSearch()
    expect(useSearchStore.getState().noTextPages).toEqual([1, 3])
    expect(useSearchStore.getState().matches).toHaveLength(1)
  })
  it('leere Query loescht Treffer', async () => {
    useSearchStore.setState({ query: '', matches: [{ page: 1, start: 0, end: 1 }], activeIndex: 0, texts: { 1: 'a' } })
    await useSearchStore.getState().runSearch()
    expect(useSearchStore.getState().matches).toHaveLength(0)
    expect(useSearchStore.getState().activeIndex).toBe(-1)
  })
  it('next/prev wickelt und traegt aktive Index', async () => {
    useSearchStore.setState({ query: 'a', texts: { 1: 'a b a' } })
    await useSearchStore.getState().runSearch()
    expect(useSearchStore.getState().matches).toHaveLength(2)
    expect(useSearchStore.getState().activeIndex).toBe(0)
    useSearchStore.getState().next()
    expect(useSearchStore.getState().activeIndex).toBe(1)
    useSearchStore.getState().next()
    expect(useSearchStore.getState().activeIndex).toBe(0)
    useSearchStore.getState().prev()
    expect(useSearchStore.getState().activeIndex).toBe(1)
  })
})
