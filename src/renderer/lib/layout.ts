// Page-Layout-Modi (Section 5). Reine Funktion: berechnet die sichtbaren Zeilen (je Zeile die
// seitig nebeneinander gestellten Seiten) fuer einen Fenster-Ausschnitt um die Fokusseite.
// Rendert bewusst ein Fenster (nicht alle 200 Seiten), damit auch grosse Dokumente fluessig bleiben.

export type LayoutMode = 'single' | 'continuous' | 'facing' | 'facing-cover'

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// Alle Seiten in Zeilen gruppiert (facing = Paare, facing-cover = Seite 1 allein, dann Paare).
export function allRows(mode: LayoutMode, pageCount: number): number[][] {
  if (pageCount <= 0) return []
  if (mode === 'single') return [[1]]
  if (mode === 'continuous') {
    const rows: number[][] = []
    for (let p = 1; p <= pageCount; p++) rows.push([p])
    return rows
  }
  const rows: number[][] = []
  let start = 1
  if (mode === 'facing-cover') {
    rows.push([1])
    start = 2
  }
  for (let p = start; p <= pageCount; p += 2) {
    rows.push(p + 1 <= pageCount ? [p, p + 1] : [p])
  }
  return rows
}

// Sichtbarer Zeilen-Fenster um die Zeile, die `center` enthaelt. `window` Zeilen je Seite.
export function pageRowsFor(mode: LayoutMode, pageCount: number, center: number, window = 2): number[][] {
  if (pageCount <= 0) return []
  const c = clamp(center, 1, pageCount)
  if (mode === 'single') return [[c]]
  const rows = allRows(mode, pageCount)
  let idx = rows.findIndex((r) => r.includes(c))
  if (idx < 0) idx = 0
  const lo = Math.max(0, idx - window)
  const hi = Math.min(rows.length - 1, idx + window)
  return rows.slice(lo, hi + 1)
}

// Fortlaufender Scroll-Modus zeigt die Seiten untereinander; Doppelseite seitlich.
export function isSideBySide(mode: LayoutMode): boolean {
  return mode === 'facing' || mode === 'facing-cover'
}
