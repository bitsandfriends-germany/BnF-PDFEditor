import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { searchPages, type Match, type SearchOptions } from '@/lib/search'
import type { PDFDocumentProxy } from '@/lib/pdfjs'
import { useAppStore } from '@/store/useAppStore'

// Textsuche im geoeffneten Dokument ueber die PDF.js-Textebene (Section 5). Der Kern ist der
// reine Matcher in lib/search; dieser Store haelt Query/Optionen/Treffer und laedt Seitentexte.

interface SearchState {
  open: boolean
  query: string
  opts: SearchOptions
  matches: Match[]
  activeIndex: number // -1 = kein Treffer
  noTextPages: number[]
  docVersion: number // auf welchen Dokumentstand sich texts/matches beziehen (-1 = keiner)
  loading: boolean
  texts: Record<number, string | null>

  setOpen: (v: boolean) => void
  setQuery: (q: string) => void
  toggleOpt: (k: keyof SearchOptions) => void
  reset: () => void
  ensureTexts: (doc: PDFDocumentProxy | null, pageCount: number, docVersion: number) => Promise<void>
  runSearch: () => Promise<void>
  next: () => void
  prev: () => void
}

export const useSearchStore = create<SearchState>()(
  immer((set, get) => ({
    open: false,
    query: '',
    opts: { caseSensitive: false, wholeWord: false, diacriticInsensitive: true },
    matches: [],
    activeIndex: -1,
    noTextPages: [],
    docVersion: -1,
    loading: false,
    texts: {},

    setOpen: (v) => set((s) => { s.open = v }),
    setQuery: (query) => set((s) => { s.query = query }),
    toggleOpt: (k) => set((s) => { s.opts[k] = !(s.opts[k] ?? false) }),
    reset: () => set((s) => { s.matches = []; s.activeIndex = -1; s.noTextPages = [] }),

    async ensureTexts(doc, pageCount, docVersion) {
      if (!doc || pageCount <= 0) return
      if (get().docVersion === docVersion && Object.keys(get().texts).length >= pageCount) return
      set((s) => { s.loading = true; s.docVersion = docVersion; s.texts = {} })
      const texts: Record<number, string | null> = {}
      for (let p = 1; p <= pageCount; p++) {
        try {
          const page = await doc.getPage(p)
          const tc = await page.getTextContent()
          const str = tc.items.map((it) => ('str' in it ? (it as { str: string }).str : '')).join(' ')
          texts[p] = str
          page.cleanup()
        } catch {
          texts[p] = null
        }
        if (p % 16 === 0) set((s) => { s.texts = { ...s.texts, ...texts } })
      }
      set((s) => { s.texts = texts; s.loading = false })
    },

    async runSearch() {
      const { texts, query, opts, docVersion } = get()
      if (query === '') {
        set((s) => { s.matches = []; s.activeIndex = -1; s.noTextPages = [] })
        return
      }
      const pages = Object.entries(texts)
        .map(([p, t]) => ({ page: Number(p), text: t }))
        .sort((a, b) => a.page - b.page)
      const hit = searchPages(pages, query, opts)
      set((s) => {
        s.matches = hit.matches
        s.noTextPages = hit.noTextPages
        s.activeIndex = hit.matches.length > 0 ? 0 : -1
        s.docVersion = docVersion
      })
      const first = hit.matches[0]
      if (first) useAppStore.getState().setCurrentPage(first.page)
    },

    next() {
      const { matches, activeIndex } = get()
      if (matches.length === 0) return
      const idx = (activeIndex + 1) % matches.length
      set((s) => { s.activeIndex = idx })
      const m = matches[idx]
      if (m) useAppStore.getState().setCurrentPage(m.page)
    },

    prev() {
      const { matches, activeIndex } = get()
      if (matches.length === 0) return
      const idx = (activeIndex - 1 + matches.length) % matches.length
      set((s) => { s.activeIndex = idx })
      const m = matches[idx]
      if (m) useAppStore.getState().setCurrentPage(m.page)
    }
  }))
)
