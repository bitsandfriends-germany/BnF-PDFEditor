// PART 3 §4 — Reines Viewer-Layout-Modell (einzige Quelle der Geometrie, der das DOM folgt).
//
// Warum rein: die §4-Akzeptanz ("kein Container größer als seine Seite", "Breite füllt bei
// Fit-Width ±2 px", "Gesamt-Scrollhöhe == Summe Seitenhöhen + Abstände ±2 px", "hin- und
// zurück-scrollen liefert identische Offsets") ist deterministische Mathematik aus den REALEN
// Seitenmaßen (getViewport). Diese lässt sich ohne Browser exakt testen; die DOM-Realisierung
// (Playwright gegen die laufende App) misst dieselben Größen.
//
// Seitenmaße sind IMMER die Anzeigemaße: getViewport({scale:1}) enthält bereits die Seiten-
// rotation (/Rotate), also das, was der Nutzer sieht. Die zusaetzliche ANZEIGE-Drehung
// (viewRotation, Drehpfeile) wechselt die Orientierung: fuer Layout-Rechnungen sind dann
// Breite/Hoehe vertauscht — genau das leistet layoutDimsForView() unten.

export interface PageDims {
  w: number // pts bei scale=1 (anzeigenrelevant)
  h: number
}

// R70: Layout-Masse fuer die ANZEIGE-Drehung. Die Seitenmasse aus getViewport enthalten bereits
// die Seitenrotation (/Rotate); die Anzeige-Drehung (viewRotation) kommt zusaetzlich. Bei 90/270
// sind Breite und Hoehe vertauscht — sonst rechnen Fit-Modus, Spaltenhoehen und Scrollanker mit
// der falschen Orientierung, und die gedrehte Seite wird beschnitten (Nutzerbefund: "es zoomt nur").
export function layoutDimsForView(dims: PageDims[], viewRotation: number): PageDims[] {
  const deg = ((Math.round(viewRotation / 90) * 90) % 360 + 360) % 360
  if (deg !== 90 && deg !== 270) return dims
  return dims.map((d) => ({ w: d.h, h: d.w }))
}

// Fit-Width: die BREITESTE Seite füllt die verfügbare Breite. Schmalere Seiten bleiben
// proportional kleiner (Größenunterschied A4/A3 ist Information). Kein Dehnen.
export function fitWidthScale(dims: PageDims[], availableWidthPx: number): number {
  if (dims.length === 0 || availableWidthPx <= 0) return 1
  const maxW = dims.reduce((m, d) => Math.max(m, d.w), 0)
  if (maxW <= 0) return 1
  return availableWidthPx / maxW
}

// CSS-Größe eines Seiten-Slots bei gegebenem Zoom — exakt viewport*scale (auf ganze px).
export function slotCss(d: PageDims, scale: number): { w: number; h: number } {
  return { w: Math.round(d.w * scale), h: Math.round(d.h * scale) }
}

export interface ColumnEntry {
  page: number // 1-basiert
  w: number
  h: number
  render: boolean // true = echte Seite rendern, false = Platzhalter realer Größe
}

export interface ColumnLayout {
  entries: ColumnEntry[]
  offsets: number[] // kumulative Top-Offsets je Seite (innerhalb der Spalte)
  totalHeight: number // Summe aller Slot-Höhen + Abstände (ohne Seitenlabels)
}

// Baut die (virtuelle) Spalte: JEDIE Seite bekommt einen Slot aus ihren REALEN Maßen, damit die
// Gesamt-Scrollhöhe und die Sprung-Ziele stimmen; nur center±window werden gerendert, der Rest
// sind gleich große Platzhalter. Offsets hängen NICHT vom center ab -> hin-/zurück identisch.
export function buildColumn(dims: PageDims[], scale: number, center: number, windowSize: number, gap: number): ColumnLayout {
  const n = dims.length
  const entries: ColumnEntry[] = []
  const offsets: number[] = []
  let y = 0
  for (let i = 0; i < n; i++) {
    const css = slotCss(dims[i] as PageDims, scale)
    const render = Math.abs(i - center) <= windowSize
    entries.push({ page: i + 1, w: css.w, h: css.h, render })
    offsets.push(y)
    y += css.h + gap
  }
  const totalHeight = n === 0 ? 0 : y - gap // letzter überzähliger Abstand abziehen
  return { entries, offsets, totalHeight }
}

// Seite mit dem größten Anteil am Viewport (für die Aktuelle-Seite-Anzeige) — rein.
// viewports: je Seite [topPx, bottomPx] relativ zum Scrollcontainer; viewTop/viewBottom der Rahmen.
export function pageWithLargestShare(viewTop: number, viewBottom: number, tops: number[], bottoms: number[]): number {
  let best = 1
  let bestShare = -1
  for (let i = 0; i < n(tops); i++) {
    const top = Math.max(tops[i] ?? 0, viewTop)
    const bottom = Math.min(bottoms[i] ?? 0, viewBottom)
    const share = Math.max(0, bottom - top)
    if (share > bestShare) {
      bestShare = share
      best = i + 1
    }
  }
  return best
}

function n(arr: number[]): number {
  return arr.length
}

// §4 "Zoom preserves the anchor": der Punkt in Viewport-MITTE bleibt nach dem Zoomen in der Mitte.
// Identifiziert wird der Mittenpunkt als (Seite p, Bruch frac) in der ALTEN Spalte; in der NEUEN
// Spalte (anderer Zoom => andere Offsets/Höhen) wird genau dieser Punkt wieder in die Mitte gerollt.
// Bei unverändertem Zoom (old==new) und ohne Anstieg liefert das exakt denselben scrollTop (Identität,
// kein Reset nach oben).
export interface ZoomAnchorInput {
  offsetsOld: number[]
  heightsOld: number[]
  offsetsNew: number[]
  heightsNew: number[]
  scrollTop: number
  viewHeight: number
}

export function anchorScrollForZoom(inp: ZoomAnchorInput): number {
  const { offsetsOld, heightsOld, offsetsNew, heightsNew, scrollTop, viewHeight } = inp
  const len = offsetsOld.length
  if (len === 0) return 0
  const centerCol = scrollTop + viewHeight / 2
  let p = len - 1
  for (let i = 0; i < len; i++) {
    const bottom = (offsetsOld[i] ?? 0) + (heightsOld[i] ?? 0)
    if (centerCol < bottom) {
      p = i
      break
    }
  }
  const hOld = heightsOld[p] ?? 0
  const frac = hOld > 0 ? (centerCol - (offsetsOld[p] ?? 0)) / hOld : 0
  const centerColNew = (offsetsNew[p] ?? 0) + frac * (heightsNew[p] ?? 0)
  const totalNew = (offsetsNew[len - 1] ?? 0) + (heightsNew[len - 1] ?? 0)
  const max = Math.max(0, totalNew - viewHeight)
  const next = centerColNew - viewHeight / 2
  return Math.min(max, Math.max(0, next))
}

// §4 "Entering a page number scrolls that page's top edge to just below the top padding".
// In der Spalte (padding liegt OBERHALB der Spalten-Koordinaten) liegt der Seitenanfang von Seite p
// bei offsets[p-1]; dieser scrollTop setzt ihn direkt unter das obere Padding.
export function pageTopScroll(offsets: number[], page: number): number {
  if (offsets.length === 0) return 0
  const idx = Math.min(Math.max(page, 1), offsets.length) - 1
  return Math.max(0, offsets[idx] ?? 0)
}

// --- §7.4 Doppelseiten: gleiche Regeln, nur andere Anordnung. Zeilen aus allRows(); jeder Slot
// aus REALen Maßen, Zeilenhöhe = max der Seiten, Lücken gleich, virtueller Render-Fenster
// center±window (Seiten), Offsets unabhängig vom center -> Scrollhöhe stabil, Sprünge exakt.
export interface FacingCell {
  page: number
  w: number
  h: number
  render: boolean
}

export interface FacingRowLayout {
  top: number
  height: number
  render: boolean
  cells: FacingCell[]
}

export interface FacingLayout {
  rows: FacingRowLayout[]
  totalHeight: number
}

export function buildFacingColumn(rowsOfPages: readonly (readonly number[])[], dims: PageDims[], scale: number, gap: number, center: number, windowSize: number): FacingLayout {
  const rows: FacingRowLayout[] = []
  let y = 0
  for (const row of rowsOfPages) {
    const cells: FacingCell[] = []
    let h = 0
    for (const p of row) {
      const d = dims[p - 1]
      if (d === undefined) continue
      const css = slotCss(d, scale)
      cells.push({ page: p, w: css.w, h: css.h, render: Math.abs(p - center) <= windowSize })
      h = Math.max(h, css.h)
    }
    if (cells.length === 0) continue
    const render = cells.some((c) => c.render)
    rows.push({ top: y, height: h, render, cells })
    y += h + gap
  }
  const totalHeight = rows.length === 0 ? 0 : y - gap
  return { rows, totalHeight }
}

// --- R73: Navigations-Geometrie fuer ALLE Layout-Modi (Scroll-Spy, Seitenzahl-Sprung, Anker-Zoom).
// Nutzerbefund: in den Doppelseiten-Modi blieben nach den ersten Seiten nur Platzhalter ("…"),
// weil der Scroll-Spy nur fuer Einspalten-Modi berechnet wurde — die Fokusseite (und damit das
// Render-Fenster) blieb auf Seite 1 stehen. Diese Struktur beschreibt beide Faelle gleich:
//   offsetsByPage[p-1]  = Scroll-Offset der Seite p (Sprungziele)
//   groupOffsets/Heights = Sichtbarkeits-Gruppen (Einzelspalte: je Seite; Doppelseite: je Zeile)
//   groups[g]           = 1-basierte Seiten dieser Gruppe
export interface NavGeometry {
  offsetsByPage: number[]
  groupOffsets: number[]
  groupHeights: number[]
  groups: number[][]
}

export function navGeometryForColumn(dims: PageDims[], scale: number, gap: number): NavGeometry {
  const col = buildColumn(dims, scale, 0, Number.MAX_SAFE_INTEGER, gap)
  return {
    offsetsByPage: col.entries.map((_, i) => col.offsets[i] ?? 0),
    groupOffsets: col.offsets.slice(),
    groupHeights: col.entries.map((e) => e.h),
    groups: col.entries.map((e) => [e.page])
  }
}

export function navGeometryForFacing(rowsOfPages: readonly (readonly number[])[], dims: PageDims[], scale: number, gap: number): NavGeometry {
  const layout = buildFacingColumn(rowsOfPages, dims, scale, gap, 1, 0)
  const offsetsByPage: number[] = []
  const groups: number[][] = []
  layout.rows.forEach((r, i) => {
    groups.push(r.cells.map((c) => c.page))
    for (const c of r.cells) offsetsByPage[c.page - 1] = layout.rows[i]?.top ?? 0
  })
  return {
    offsetsByPage,
    groupOffsets: layout.rows.map((r) => r.top),
    groupHeights: layout.rows.map((r) => r.height),
    groups
  }
}

// Gruppe (0-basiert) mit dem groessten Anteil am sichtbaren Bereich; -1 wenn nichts sichtbar.
export function groupIndexWithLargestShare(viewTop: number, viewBottom: number, tops: number[], bottoms: number[]): number {
  let best = -1
  let bestShare = 0
  for (let i = 0; i < tops.length; i++) {
    const t = tops[i] ?? 0
    const b = bottoms[i] ?? t
    const share = Math.max(0, Math.min(viewBottom, b) - Math.max(viewTop, t))
    if (share > bestShare) {
      bestShare = share
      best = i
    }
  }
  return best
}

// Seite innerhalb einer Gruppe: die zuletzt sichtbare Seite bevorzugen, sonst die erste der Gruppe —
// verhindert Flackern zwischen linker/rechter Seite einer Doppelseite beim Scrollen.
export function pageForGroup(groups: number[][], groupIndex: number, previousPage: number): number {
  const g = groups[groupIndex]
  if (!g || g.length === 0) return previousPage
  return g.includes(previousPage) ? previousPage : g[0] ?? previousPage
}

// §4 Seitenlabels: eigener Document-Label (z. B. römisch "iv" für Vorspann) wo definiert, sonst
// die laufende Nummer. Leere/nicht existierende Einträge -> Nummer allein. Rein, 1-basierte Seite.
export function pageLabelFor(ownLabels: readonly (string | null | undefined)[], page: number): string {
  const own = ownLabels[page - 1]
  if (own === undefined || own === null || own.trim() === '') return String(page)
  return `${own.trim()} (${page})`
}

// §4: verfügbare Breite/Höhe des Scrollbereichs = Client-Box ABZÜGLICH Innenabstand (Gutter).
// Fallback-Messung muss denselben Inhalt wie ResizeObserver.contentRect liefern, sonst ist der
// erste Frame zu breit -> Horizontal-Scrollbar bei Fit-Width. Rein.
export function innerBox(clientW: number, clientH: number, padX: number, padY: number): { w: number; h: number } {
  return { w: Math.max(0, clientW - padX), h: Math.max(0, clientH - padY) }
}
