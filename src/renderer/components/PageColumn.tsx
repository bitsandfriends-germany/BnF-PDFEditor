import type { ReactNode } from 'react'
import { buildColumn, type PageDims } from '@/lib/viewerLayout'

// PART 3 §4 — Modell-getriebene Einspalten-Spalte. JEDER Slot wird exakt aus den REALEN Seiten-
// maßen (viewport*scale) groß gemacht: nie ein größerer Wrapper. Nicht sichtbare Seiten (außerhalb
// center±2) sind gleich große Platzhalter -> Gesamt-Scrollhöhe und Sprungziele stimmen. Auswahl-
// rahmen sitzt AUF dem seitengroßen Slot, Seitenzahl darunter (im Abstand, erhöht die Scrollhöhe
// nicht). Absolute Positionierung mit exakten Offsets, damit die Höhe == buildColumn.totalHeight.

export interface PageColumnProps {
  dims: PageDims[] // index 0 = Seite 1
  scale: number
  center: number // 0-basierter Index der Fokusseite
  gap: number
  current: number // 1-basiert, für Auswahl-Rahmen
  window?: number // gerenderte Seiten je Seite (Standard 2)
  renderItem: (page: number, w: number, h: number) => ReactNode
  labelFor?: (page: number) => string // optionaler Dokument-Seitenlabel (z. B. römisch)
}

export function PageColumn({ dims, scale, center, gap, current, window = 2, renderItem, labelFor }: PageColumnProps): JSX.Element {
  const col = buildColumn(dims, scale, center, window, gap)
  return (
    <div data-testid="page-column" style={{ position: 'relative', width: '100%', height: col.totalHeight }}>
      {col.entries.map((e, i) => (
        <div
          key={e.page}
          data-testid={`page-slot-${e.page}`}
          data-render={e.render ? '1' : '0'}
          tabIndex={0}
          aria-label={`Seite ${e.page}`}
          className={`relative bg-white outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${e.page === current ? 'ring-2 ring-sky-500' : 'ring-1 ring-black/10'}`}
          style={{ position: 'absolute', left: '50%', top: col.offsets[i], transform: 'translateX(-50%)', width: e.w, height: e.h, overflow: 'visible' }}
        >
          {e.render ? (
            renderItem(e.page, e.w, e.h)
          ) : (
            <div className="absolute inset-0 grid place-items-center border border-slate-200 bg-slate-50 text-xs text-slate-400">…</div>
          )}
          <div
            data-testid={`page-label-${e.page}`}
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-slate-500"
            style={{ top: e.h + 2 }}
          >
            {labelFor ? labelFor(e.page) : String(e.page)}
          </div>
        </div>
      ))}
    </div>
  )
}
