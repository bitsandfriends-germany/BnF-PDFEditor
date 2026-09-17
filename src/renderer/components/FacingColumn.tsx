import type { ReactNode } from 'react'
import { buildFacingColumn, type PageDims } from '@/lib/viewerLayout'

// §7.4 Doppelseiten — gleiche Regeln wie PageColumn, nur seitliche Anordnung je Paar.
// JEDER Slot exakt aus REALen Seitenmaßen (viewport*scale); Zeilenhöhe = max der Seiten; Lücken
// gleich; nicht sichtbare Paare sind gleich große Platzhalter -> Scrollhöhe/Sprungziele stimmen.
// Auswahl-Rahmen sitzt AUF dem seitengroßen Slot, Seitenzahl darunter (erhöht Scrollhöhe nicht).

export interface FacingColumnProps {
  dims: PageDims[] // index 0 = Seite 1
  rows: readonly (readonly number[])[] // Paare aus allRows(); 1-basierte Seiten
  scale: number
  gap: number // vertikaler Abstand zwischen Zeilen
  innerGap: number // horizontaler Abstand innerhalb eines Paares
  current: number // 1-basiert, für Auswahl-Rahmen
  center: number // 1-basiert, Fokusseite für den Render-Fenster
  window?: number // gerenderte Seiten je Seite von center
  renderItem: (page: number, w: number, h: number) => ReactNode
  labelFor?: (page: number) => string
}

export function FacingColumn({ dims, rows, scale, gap, innerGap, current, center, window = 2, renderItem, labelFor }: FacingColumnProps): JSX.Element {
  const layout = buildFacingColumn(rows, dims, scale, gap, center, window)
  return (
    <div data-testid="facing-column" style={{ position: 'relative', width: '100%', height: layout.totalHeight }}>
      {layout.rows.map((r) => (
        <div
          key={r.cells[0]?.page ?? r.top}
          data-testid={`facing-row-${r.cells[0]?.page ?? ''}`}
          data-render={r.render ? '1' : '0'}
          style={{ position: 'absolute', left: 0, right: 0, top: r.top, display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: innerGap }}
        >
          {r.cells.map((c) => (
            <div
              key={c.page}
              data-testid={`facing-slot-${c.page}`}
              data-render={c.render ? '1' : '0'}
              className={`relative bg-white ${c.page === current ? 'ring-2 ring-sky-500' : 'ring-1 ring-black/10'}`}
              style={{ position: 'relative', width: c.w, height: c.h, flex: '0 0 auto', overflow: 'visible' }}
            >
              {c.render ? (
                renderItem(c.page, c.w, c.h)
              ) : (
                <div className="absolute inset-0 grid place-items-center border border-slate-200 bg-slate-50 text-xs text-slate-400">…</div>
              )}
              <div
                data-testid={`facing-label-${c.page}`}
                className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-slate-500"
                style={{ top: c.h + 2 }}
              >
                {labelFor ? labelFor(c.page) : String(c.page)}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
