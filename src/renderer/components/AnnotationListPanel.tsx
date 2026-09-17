import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { parsePageRange } from '@/lib/pageRange'
import { listAnnotations, removeAnnotations, type Annotation } from '@/lib/documents'
import type { MarkupType } from '@/store/useUiStore'
import { AnnotationEditor } from '@/components/AnnotationEditor'
import { AnnotationContextMenu, type AnnotationMenuRequest } from '@/components/AnnotationContextMenu'

// Annotationen-Liste (Section 8): das Rueckgrat eines brauchbaren Review-Werkzeugs. Jede
// Annotation mit Seite/Typ/Autor/Datum/Text; Klick navigiert; Filter nach Typ und Autor;
// Sortierung nach Seite oder Datum. "Alle entfernen" wirkt auf einen Seitenbereich und ist
// ein bestaetigter, rueckgaengiger Command (Snapshot + Signatur-Gate in mutate()).

const select = 'rounded border border-slate-300 px-1.5 py-1 text-xs dark:border-slate-600'
const input = 'w-full rounded border border-slate-300 px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-600'
const NO_AUTHOR = '__none__'

export function AnnotationListPanel(): JSX.Element {
  const t = useT()
  const docOpen = useAppStore((s) => s.docOpen)
  const docVersion = useAppStore((s) => s.docVersion)
  const readOnly = useAppStore((s) => s.readOnly)
  const mutationLock = useAppStore((s) => s.mutationLock)
  const setCurrentPage = useAppStore((s) => s.setCurrentPage)
  const pageCount = useAppStore((s) => s.pageCount)
  const addToast = useAppStore((s) => s.addToast)
  const requestConfirm = useUiStore((s) => s.requestConfirm)
  const armMarkup = useUiStore((s) => s.armMarkup)
  const selectedId = useUiStore((s) => s.selectedAnnotationId)
  const setSelectedId = useUiStore((s) => s.setSelectedAnnotationId)

  const [items, setItems] = useState<Annotation[]>([])
  const [typeFilter, setTypeFilter] = useState('all')
  const [authorFilter, setAuthorFilter] = useState('all')
  const [sort, setSort] = useState<'page' | 'date'>('page')
  const [expr, setExpr] = useState('all')
  const [busy, setBusy] = useState(false)
  // §6: Rechtsklick-Menü auf einer Annotations-Zeile.
  const [menu, setMenu] = useState<AnnotationMenuRequest | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    if (!docOpen) {
      setItems([])
      return
    }
    try {
      setItems(await listAnnotations())
    } catch {
      setItems([])
    }
  }, [docOpen])

  useEffect(() => {
    void reload()
  }, [reload, docVersion])

  const types = useMemo(() => Array.from(new Set(items.map((a) => a.type))).sort(), [items])
  const authors = useMemo(() => Array.from(new Set(items.map((a) => a.author || NO_AUTHOR))).sort(), [items])

  const shown = useMemo(() => {
    let list = items.filter((a) => (typeFilter === 'all' || a.type === typeFilter) && (authorFilter === 'all' || (a.author || NO_AUTHOR) === authorFilter))
    list = [...list].sort((a, b) => (sort === 'page' ? a.page - b.page : (a.date || '').localeCompare(b.date || '')))
    return list
  }, [items, typeFilter, authorFilter, sort])

  const rangeOk = useMemo(() => parsePageRange(expr, pageCount).ok, [expr, pageCount])
  const canRemove = docOpen && !readOnly && !mutationLock && rangeOk && items.length > 0 && !busy

  const onRemove = async (): Promise<void> => {
    const ok = await requestConfirm(t('annotations.removeConfirmTitle'), t('annotations.removeConfirmBody'))
    if (!ok) return
    setBusy(true)
    const before = items.length
    try {
      const done = await removeAnnotations(expr.trim() === '' ? 'all' : expr.trim())
      if (done) {
        const next = await listAnnotations()
        setItems(next)
        addToast({ kind: 'success', message: t('annotations.removed', { count: Math.max(0, before - next.length) }) })
      }
    } finally {
      setBusy(false)
    }
  }

  // E2E-Fund: die Platzier-Leiste verschwand bei leerer Liste — damit konnte die ERSTE
  // Annotation nicht per Panel angelegt werden. Sie haengt an docOpen, nie an items.length.
  const placeBar = (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 p-2 dark:border-slate-700">
      <select className={select} data-testid="ann-new-type" defaultValue="Highlight">
        {(['Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Text', 'FreeText'] as MarkupType[]).map((ty) => (
          <option key={ty} value={ty}>{t('annotations.type.' + ty)}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={!docOpen || readOnly || mutationLock}
        data-testid="ann-place"
        onClick={() => {
          const el = document.querySelector('[data-testid="ann-new-type"]') as HTMLSelectElement | null
          armMarkup((el?.value ?? 'Highlight') as MarkupType)
        }}
        className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-700 disabled:opacity-40"
      >
        {t('annotations.place')}
      </button>
    </div>
  )

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col text-sm">
        {placeBar}
        <p className="p-3 text-sm text-slate-500">{t('annotations.empty')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col text-sm">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 p-2 dark:border-slate-700">
        <select className={select} data-testid="ann-filter-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">{t('annotations.filterType')}: {t('annotations.all')}</option>
          {types.map((ty) => (
            <option key={ty} value={ty}>{ty}</option>
          ))}
        </select>
        <select className={select} data-testid="ann-filter-author" value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)}>
          <option value="all">{t('annotations.filterAuthor')}: {t('annotations.all')}</option>
          {authors.map((au) => (
            <option key={au} value={au}>{au === NO_AUTHOR ? t('annotations.noAuthor') : au}</option>
          ))}
        </select>
        <select className={select} data-testid="ann-sort" value={sort} onChange={(e) => setSort(e.target.value === 'date' ? 'date' : 'page')}>
          <option value="page">{t('annotations.sort.page')}</option>
          <option value="date">{t('annotations.sort.date')}</option>
        </select>
      </div>

      {placeBar}

      <ul className="min-h-0 flex-1 overflow-auto">
        {shown.map((a, i) => (
          <li key={a.id}>
            <button
              type="button"
              data-testid={`ann-item-${i}`}
              data-ann-id={a.id}
              onClick={() => { setCurrentPage(a.page); setSelectedId(selectedId === a.id ? null : a.id) }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ id: a.id, label: `${a.type} · ${t('annotations.page', { n: a.page })}`, x: e.clientX, y: e.clientY })
              }}
              className="block w-full border-b border-slate-100 px-2 py-1.5 text-left hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{a.type}</span>
                <span className="shrink-0 text-xs text-slate-400">{t('annotations.page', { n: a.page })}</span>
              </div>
              {a.author ? <div className="truncate text-xs text-slate-500">{a.author}</div> : null}
              {a.text ? <div className="line-clamp-2 text-xs">{a.text}</div> : null}
            </button>
          </li>
        ))}
      </ul>

      {selectedId ? <AnnotationEditor id={selectedId} /> : null}
      {menu ? <AnnotationContextMenu menu={menu} onClose={() => setMenu(null)} /> : null}

      <div className="flex items-end gap-2 border-t border-slate-200 p-2 dark:border-slate-700">
        <label className="min-w-0 flex-1 text-xs">
          <span className="mb-0.5 block text-slate-500">{t('annotations.removeExpr')}</span>
          <input className={input} data-testid="ann-remove-expr" value={expr} onChange={(e) => setExpr(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={!canRemove}
          data-testid="ann-remove"
          onClick={() => void onRemove()}
          className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1.5 text-xs text-white hover:bg-red-700 disabled:opacity-40"
        >
          <Trash2 size={14} /> {t('annotations.remove')}
        </button>
      </div>
    </div>
  )
}
