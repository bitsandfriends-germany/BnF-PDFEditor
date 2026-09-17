import { useEffect, useRef, useState } from 'react'
import { RotateCw, Trash2 } from 'lucide-react'
import { thumbnailWindow } from '@/lib/thumbnailWindow'
import { moveBlockOrder } from '@/lib/reorder'
import { rotatePage, deletePage } from '@/lib/documents'
import { useAppStore } from '@/store/useAppStore'
import { useT } from '@/i18n'
import type { SelectMode } from '@/store/useUiStore'
import type { PDFDocumentProxy } from '@/lib/pdfjs'
import { ContextMenu } from '@/components/ContextMenu'
import { pageScopeLabel, type CommandContext } from '@/lib/commands'

// Virtualisierte Thumbnail-Leiste (Section 4B Tab1): nur das Sichtbare (+ Overscan) wird gerendert,
// sonst brechen Dokumente mit 500+ Seiten den Renderer. Die Fensterlogik ist die reine, getestete
// thumbnailWindow()-Funktion; hier nur noch DOM + Lazy-Render je Kachel.

function ThumbnailTile({
  doc,
  index,
  targetWidth,
  maxHeight,
  selected,
  onSelect
}: {
  doc: PDFDocumentProxy
  index: number
  targetWidth: number
  maxHeight: number
  selected: boolean
  onSelect: (index: number, mode: SelectMode) => void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const t = useT()
  const readOnly = useAppStore((s) => s.readOnly)
  const mutationLock = useAppStore((s) => s.mutationLock)
  const [busy, setBusy] = useState(false)
  const disabled = readOnly || mutationLock || busy
  const guard = (fn: () => Promise<boolean>): void => {
    if (disabled) return
    setBusy(true)
    void fn().finally(() => setBusy(false))
  }
  useEffect(() => {
    let cancelled = false
    let task: { promise: Promise<void>; cancel: () => void } | null = null
    void (async () => {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        const page = await doc.getPage(index + 1)
        if (cancelled) return
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
        // getViewport() ohne rotations-Aarg liefert bei pdf.js die Seite bereits ROTIERT
        // (Default rotation = page.rotate) -> base.width/height sind das reale Format.
        // Contain-Skalierung: Seitenformat bleibt erhalten, und keins Seite — ob A3 oder
        // quer — ragt ueber die Zelle hinaus (Nutzerbefund: uiberbreite/uebergrosse Kacheln).
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(targetWidth > 0 ? targetWidth / base.width : 1, maxHeight > 0 ? maxHeight / base.height : 1)
        const vp = page.getViewport({ scale })
        canvas.width = Math.floor(vp.width * dpr)
        canvas.height = Math.floor(vp.height * dpr)
        canvas.style.width = `${vp.width}px`
        canvas.style.height = `${vp.height}px`
        const ctx = canvas.getContext('2d')
        if (!ctx || cancelled) return
        task = page.render({ canvasContext: ctx, viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] })
        await task.promise
      } catch (err) {
        if (err instanceof Error && err.name === 'RenderingCancelledException') return
        // Renderfehler einzelner Kacheln sind nicht fatal fuer die Leiste; Kachel bleibt leer.
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, index, targetWidth, maxHeight])

  return (
    <div className="group relative h-full w-full">
      <button data-testid={`thumb-item-${index}`}
        type="button"
        role="listitem"
        aria-label={`Seite ${index + 1}`}
        aria-current={selected ? 'true' : undefined}
        aria-selected={selected}
        onClick={(e) => onSelect(index, e.shiftKey ? 'shift' : e.ctrlKey || e.metaKey ? 'ctrl' : 'click')}
        className="flex h-full w-full items-center justify-center" 
      >
        {/* Auswahl als ring (Layout-neutral) statt Border+Padding — der Rahmen hat nur Breite gekostet. */}
        <canvas ref={canvasRef} className={`shadow-sm ${selected ? 'ring-2 ring-sky-500' : 'ring-1 ring-black/10 hover:ring-slate-300'}`} />
      </button>
      {/* Hover-/Fokus-Steuerelemente (Section 4B Tab1): Drehen 90 deg + Loeschen. pointer-events
          permanent aktiv, damit sie greifbar bleiben; read-only / Mutationssperde deaktiviert sie. */}
      <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          title={t('thumb.rotate', { page: index + 1 })}
          aria-label={t('thumb.rotate', { page: index + 1 })}
          data-testid={`thumb-rotate-${index}`}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            guard(() => rotatePage(index, 90))
          }}
          className="rounded bg-white/90 p-1 text-slate-700 shadow ring-1 ring-black/10 hover:bg-white disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
        >
          <RotateCw size={14} />
        </button>
        <button
          type="button"
          title={t('thumb.delete', { page: index + 1 })}
          aria-label={t('thumb.delete', { page: index + 1 })}
          data-testid={`thumb-delete-${index}`}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            guard(() => deletePage(index))
          }}
          className="rounded bg-white/90 p-1 text-red-600 shadow ring-1 ring-black/10 hover:bg-white disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

export interface ThumbnailListProps {
  doc: PDFDocumentProxy | null
  pageCount: number
  itemHeight: number
  targetWidth: number
  selectedIndex: number // 0-basiert, aktuelle Seite (aria-current)
  selected: number[] // 0-basierte Multi-Select-Indizes (Section 6)
  onSelect: (index: number, mode: SelectMode) => void
  onSelectAll: () => void
  onReorder?: (order: number[]) => void // 0-basierte Ziel-Permutation (Section 6 Drag&Drop)
}

export function ThumbnailList({ doc, pageCount, itemHeight, targetWidth, selectedIndex, selected, onSelect, onSelectAll, onReorder }: ThumbnailListProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewHeight, setViewHeight] = useState(0)
  const readOnly = useAppStore((s) => s.readOnly)
  const mutationLock = useAppStore((s) => s.mutationLock)
  const canReorder = !readOnly && !mutationLock && !!onReorder
  // 1-basierte Seiten der Auswahl (Block, der beim Ziehen wandert).
  const selectedPages = selected.map((i) => i + 1)
  const t = useT()
  // §6: Rechtsklick auf ein Thumbnail öffnet das Seiten-Kontextmenü (aus der Command-Registry).
  const [menu, setMenu] = useState<{ page: number; x: number; y: number } | null>(null)
  // §6 Tastatur: Context-Menü-Taste (oder Shift+F10) öffnet das Menü für das fokussierte Thumbnail.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
      const el = document.activeElement as HTMLElement | null
      const item = el?.closest('[data-testid^="thumb-item-"]') as HTMLElement | null
      if (!item) return
      const idx = parseInt((item.getAttribute('data-testid') ?? '').slice('thumb-item-'.length), 10)
      if (Number.isNaN(idx)) return
      const r = item.getBoundingClientRect()
      setMenu({ page: idx + 1, x: r.left + 12, y: r.top + 12 })
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Scope = ganze Auswahl, wenn die angeklickte Seite Teil der Auswahl ist; sonst nur diese Seite.
  const cmdCtx = (page: number): CommandContext => {
    const inSel = selectedPages.includes(page)
    return { docOpen: true, readOnly, mutationLock, signedDoc: useAppStore.getState().signedDoc, currentPage: page, pageCount, selected: inSel ? selectedPages : [page], textSelected: false, stamping: false }
  }
  const [dragSet, setDragSet] = useState<number[] | null>(null)
  const [dropAt, setDropAt] = useState<{ index: number; after: boolean } | null>(null)

  const clearDrag = (): void => {
    setDragSet(null)
    setDropAt(null)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el) setViewHeight(el.clientHeight)
  }, [pageCount])

  const win = thumbnailWindow(pageCount, scrollTop, viewHeight, itemHeight, 4)
  const indices: number[] = []
  for (let i = win.start; i < win.end; i++) indices.push(i)

  if (!doc || pageCount <= 0) {
    return <div ref={scrollRef} role="list" aria-label="Seiten-Miniaturen" className="h-full overflow-auto" />
  }

  return (
    <div
      ref={scrollRef}
      role="list"
      aria-label="Seiten-Miniaturen"
      aria-multiselectable="true"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault()
          onSelectAll()
        }
      }}
      className="h-full overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500"
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <div style={{ height: pageCount * itemHeight, position: 'relative' }}>
        {indices.map((i) => {
          const indicator = dropAt && dropAt.index === i ? (dropAt.after ? 'after' : 'before') : null
          return (
            <div
              key={i}
              style={{ position: 'absolute', top: i * itemHeight, height: itemHeight, left: 0, right: 0 }}
              draggable={canReorder}
              data-testid={`thumb-wrap-${i}`}
              tabIndex={0}
              onDragStart={(e) => {
                if (!canReorder) {
                  e.preventDefault()
                  return
                }
                const page = i + 1
                const set = selectedPages.includes(page) ? selectedPages : [page]
                setDragSet(set)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (!dragSet) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                const after = e.clientY - rect.top > rect.height / 2
                setDropAt((prev) => (prev && prev.index === i && prev.after === after ? prev : { index: i, after }))
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (!dragSet || !onReorder) return clearDrag()
                const order = moveBlockOrder(pageCount, dragSet, i + 1, dropAt?.after ?? false)
                if (order) onReorder(order)
                clearDrag()
              }}
              onDragEnd={clearDrag}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ page: i + 1, x: e.clientX, y: e.clientY })
              }}
            >
              {indicator ? <div className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-sky-500 ${indicator === 'before' ? 'top-0' : 'bottom-0'}`} data-testid={`drop-indicator-${i}`} /> : null}
              <ThumbnailTile doc={doc} index={i} targetWidth={targetWidth} maxHeight={itemHeight - 8} selected={selected.includes(i) || (selected.length === 0 && i === selectedIndex)} onSelect={onSelect} />
            </div>
          )
        })}
      </div>
      {menu ? (
        <ContextMenu
          target="thumbnail"
          ctx={cmdCtx(menu.page)}
          x={menu.x}
          y={menu.y}
          scopeLabel={pageScopeLabel(t, menu.page, selectedPages)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}
