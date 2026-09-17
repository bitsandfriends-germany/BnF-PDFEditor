import { useEffect, useRef, useState } from 'react'
import { Search as SearchIcon, ChevronUp, ChevronDown, X } from 'lucide-react'
import { useT } from '@/i18n'
import { useSearchStore } from '@/store/useSearchStore'
import { useAppStore } from '@/store/useAppStore'
import { api } from '@/lib/apiClient'
import type { PDFDocumentProxy } from '@/lib/pdfjs'

// Dokument-Suche (Section 5): Ctrl+F, inkrementell, Trefferzahl "k von n", next/prev
// (Enter/Shift+Enter, F3/Shift+F3 global). Seiten ohne Textebene werden explizit gemeldet und
// bieten OCR an, statt still 0 Treffer zu zeigen.

export interface SearchPanelProps {
  doc: PDFDocumentProxy | null
}

export function SearchPanel({ doc }: SearchPanelProps): JSX.Element | null {
  const t = useT()
  const open = useSearchStore((s) => s.open)
  const query = useSearchStore((s) => s.query)
  const opts = useSearchStore((s) => s.opts)
  const matches = useSearchStore((s) => s.matches)
  const activeIndex = useSearchStore((s) => s.activeIndex)
  const noTextPages = useSearchStore((s) => s.noTextPages)
  const loading = useSearchStore((s) => s.loading)
  const setOpen = useSearchStore((s) => s.setOpen)
  const setQuery = useSearchStore((s) => s.setQuery)
  const toggleOpt = useSearchStore((s) => s.toggleOpt)
  const ensureTexts = useSearchStore((s) => s.ensureTexts)
  const runSearch = useSearchStore((s) => s.runSearch)
  const next = useSearchStore((s) => s.next)
  const prev = useSearchStore((s) => s.prev)

  const pageCount = useAppStore((s) => s.pageCount)
  const docVersion = useAppStore((s) => s.docVersion)
  const addToast = useAppStore((s) => s.addToast)

  const inputRef = useRef<HTMLInputElement>(null)
  const [docling, setDocling] = useState<boolean | null>(null)

  const optsKey = `${opts.caseSensitive}|${opts.wholeWord}|${opts.diacriticInsensitive}`

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Inkrementell: bei Query-/Option-/Dokument-Aenderung Texte laden (cached) und neu suchen.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => {
      void (async () => {
        await ensureTexts(doc, pageCount, docVersion)
        await runSearch()
      })()
    }, 150)
    return () => clearTimeout(id)
  }, [open, query, optsKey, doc, pageCount, docVersion, ensureTexts, runSearch])

  // OCR-Verfuegbarkeit nur abfragen, wenn sie relevant wird (Seiten ohne Textebene).
  useEffect(() => {
    if (!open || noTextPages.length === 0 || docling !== null) return
    api
      .get('/debug/versions')
      .then((r) => setDocling(Boolean((r as { doclingAvailable?: boolean }).doclingAvailable)))
      .catch(() => setDocling(false))
  }, [open, noTextPages.length, docling])

  if (!open) return null

  const total = matches.length
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) prev()
      else next()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-30 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" role="search" data-testid="search-panel">
      <div className="flex items-center gap-1">
        <SearchIcon size={16} className="shrink-0 text-slate-400" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={t('search.placeholder')}
          aria-label={t('sc.search')}
          data-testid="search-input"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-600"
        />
        <button type="button" title={t('search.prev')} aria-label={t('search.prev')} data-testid="search-prev" onClick={prev} disabled={total === 0} className="rounded p-1 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-700"><ChevronUp size={16} /></button>
        <button type="button" title={t('search.next')} aria-label={t('search.next')} data-testid="search-next" onClick={next} disabled={total === 0} className="rounded p-1 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-700"><ChevronDown size={16} /></button>
        <button type="button" title={t('search.close')} aria-label={t('search.close')} data-testid="search-close" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700"><X size={16} /></button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-1"><input data-testid="search-opt-case" type="checkbox" checked={!!opts.caseSensitive} onChange={() => toggleOpt('caseSensitive')} /> {t('search.case')}</label>
        <label className="inline-flex items-center gap-1"><input data-testid="search-opt-whole" type="checkbox" checked={!!opts.wholeWord} onChange={() => toggleOpt('wholeWord')} /> {t('search.whole')}</label>
        <label className="inline-flex items-center gap-1"><input data-testid="search-opt-diacritic" type="checkbox" checked={opts.diacriticInsensitive ?? true} onChange={() => toggleOpt('diacriticInsensitive')} /> {t('search.diacritic')}</label>
      </div>

      <div className="mt-2 text-sm" aria-live="polite">
        {query === '' ? (
          <span className="text-slate-400">…</span>
        ) : loading ? (
          <span className="text-slate-400">…</span>
        ) : total === 0 ? (
          <span data-testid="search-status-none" className="text-slate-500">{t('search.none')}</span>
        ) : (
          <span data-testid="search-status-count">{t('search.count', { k: activeIndex + 1, n: total })}</span>
        )}
      </div>

      {query !== '' && total === 0 && noTextPages.length > 0 ? (
        <div className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" data-testid="search-notext">
          <p>{t('search.noText')}</p>
          <button
            type="button"
            className="mt-1 rounded border border-amber-400 px-2 py-0.5 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-600"
            data-testid="search-ocr"
            disabled={docling !== true}
            title={docling === true ? undefined : t('search.ocrNote')}
            onClick={() => addToast({ kind: 'info', message: t('search.ocr') })}
          >
            {t('search.ocr')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
