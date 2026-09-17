import { describe, it, expect } from 'vitest'
import { fitWidthScale, slotCss, buildColumn, pageWithLargestShare, anchorScrollForZoom, pageTopScroll, layoutDimsForView, navGeometryForColumn, navGeometryForFacing, groupIndexWithLargestShare, pageForGroup, type PageDims } from '@/lib/viewerLayout'

// PART 3 §4 Akzeptanz-Kriterien, geprüft am reinen Modell (deterministisch, ohne Browser).
// Misgrößen-Fixture (Anzeigemaße, rotationsbereinigt): A4-hoch, A4-quere, A3, eine um 90°
// gedrehte A4 (angezeigt 842x595).

const MIXED: PageDims[] = [
  { w: 595, h: 842 }, // A4 Hochformat
  { w: 842, h: 595 }, // A4 Querformat
  { w: 842, h: 1191 }, // A3
  { w: 842, h: 595 } // A4 um 90° gedreht -> Anzeige 842x595
]
const GAP = 20

describe('fitWidthScale (§4)', () => {
  it('nutzt die BREITESTE Seite, nicht die erste', () => {
    const avail = 760
    const s = fitWidthScale(MIXED, avail)
    // breiteste Breite ist 842 -> scale = 760/842, NICHT 760/595 (erste Seite).
    expect(s).toBeCloseTo(760 / 842, 6)
    expect(s).not.toBeCloseTo(760 / 595, 6)
  })
  it('leere Liste / keine Breite -> 1 (kein Kollaps)', () => {
    expect(fitWidthScale([], 800)).toBe(1)
    expect(fitWidthScale(MIXED, 0)).toBe(1)
  })
})

describe('buildColumn — Slotgrößen (§4)', () => {
  const avail = 760
  const scale = fitWidthScale(MIXED, avail)
  const col = buildColumn(MIXED, scale, 0, 2, GAP)

  it('kein Slot größer als seine eigene Seite (== viewport*scale, exakt)', () => {
    col.entries.forEach((e, i) => {
      const d = MIXED[i] as PageDims
      const css = slotCss(d, scale)
      expect(e.w).toBe(css.w)
      expect(e.h).toBe(css.h)
    })
  })

  it('breiteste Seite füllt die verfügbare Breite ±2 px', () => {
    const widest = Math.max(...col.entries.map((e) => e.w))
    expect(Math.abs(widest - avail)).toBeLessThanOrEqual(2)
  })

  it('schmalere Seite bleibt proportional kleiner (nicht gedehnt)', () => {
    const a4Portrait = col.entries[0]?.w ?? 0 // 595 pts
    const widest = col.entries[2]?.w ?? 0 // A3 = breiteste 842 pts
    expect(a4Portrait).toBeLessThan(widest)
    expect(Math.abs(a4Portrait - Math.round(595 * scale))).toBeLessThanOrEqual(1)
  })

  it('Abstände zwischen Seiten sind gleich', () => {
    for (let i = 1; i < col.offsets.length; i++) {
      const prev = col.entries[i - 1] as { h: number }
      const diff = (col.offsets[i] as number) - (col.offsets[i - 1] as number)
      expect(diff).toBe((prev.h as number) + GAP)
    }
  })

  it('Gesamt-Scrollhöhe == Summe Seitenhöhen + Abstände (±2 px)', () => {
    const sumH = col.entries.reduce((a, e) => a + e.h, 0)
    const expected = sumH + GAP * (col.entries.length - 1)
    expect(Math.abs(col.totalHeight - expected)).toBeLessThanOrEqual(2)
  })
})

describe('buildColumn — Virtualisierung (§4)', () => {
  const dims: PageDims[] = Array.from({ length: 8 }, (_, i) => ({ w: 600, h: 800 + i * 10 }))
  const scale = 0.5
  const col = buildColumn(dims, scale, 4, 2, GAP)

  it('rendert center±window, Rest Platzhalter realer Größe', () => {
    const rendered = col.entries.filter((e) => e.render).map((e) => e.page)
    expect(rendered).toEqual([3, 4, 5, 6, 7]) // center=4 (0-basiert) ±2
    const ph = col.entries.filter((e) => !e.render)
    expect(ph.length).toBe(3)
    // jeder Platzhalter trägt die REALE Größe seiner Seite (kein Einheitsschätzwert)
    ph.forEach((e) => {
      const d = dims[e.page - 1] as PageDims
      expect(e.h).toBe(Math.round(d.h * scale))
      expect(e.w).toBe(Math.round(d.w * scale))
      expect(e.h).toBeGreaterThan(0)
    })
  })

  it('hin- und zurückscrollen liefert identische Offsets und Höhen', () => {
    const atStart = buildColumn(dims, scale, 0, 2, GAP)
    const atEnd = buildColumn(dims, scale, dims.length - 1, 2, GAP)
    expect(atStart.offsets).toEqual(atEnd.offsets)
    expect(atStart.totalHeight).toBe(atEnd.totalHeight)
    expect(atStart.entries.map((e) => [e.w, e.h])).toEqual(atEnd.entries.map((e) => [e.w, e.h]))
  })
})

describe('pageWithLargestShare (§4 Aktuelle-Seite)', () => {
  it('wählt die Seite mit dem größten Sichtbarkeitsanteil', () => {
    // Scrollraster 100..200; Seite 3 (160..260) hat 40 px Anteil, Seite 2 (60..160) nur 60? -> rechne aus.
    const tops = [0, 100, 160, 260]
    const bottoms = [100, 160, 260, 360]
    // Viewport 120..220: Seite1 0, Seite2 120..160=40, Seite3 160..220=60, Seite4 0.
    expect(pageWithLargestShare(120, 220, tops, bottoms)).toBe(3)
  })
})

describe('anchorScrollForZoom (§4 Zoom behält Anker)', () => {
  const scaleOld = 1
  const scaleNew = 2
  const old = buildColumn(MIXED, scaleOld, 0, 99, GAP) // alle rendern (irrelevant, nur Offsets/Höhen)
  const neu = buildColumn(MIXED, scaleNew, 0, 99, GAP)
  const hOld = old.entries.map((e) => e.h)
  const hNew = neu.entries.map((e) => e.h)
  const viewH = 1000

  it('Mittenpunkt derselben Seite bleibt nach dem Zoomen mittig (Mischgrößen)', () => {
    // Mittenpunkt = Mitte von Seite 3 (index 2) bei altem Zoom.
    const centerCol = old.offsets[2]! + hOld[2]! / 2
    const scrollTop = centerCol - viewH / 2
    const next = anchorScrollForZoom({ offsetsOld: old.offsets, heightsOld: hOld, offsetsNew: neu.offsets, heightsNew: hNew, scrollTop, viewHeight: viewH })
    const centerColNew = next + viewH / 2
    // liegt wieder mittig auf Seite 3 der NEUEN Spalte?
    expect(centerColNew).toBeCloseTo(neu.offsets[2]! + hNew[2]! / 2, 3)
    expect(centerColNew).toBeGreaterThanOrEqual(neu.offsets[2]!)
    expect(centerColNew).toBeLessThanOrEqual(neu.offsets[2]! + hNew[2]!)
  })

  it('unveränderter Zoom => identischer scrollTop (kein Reset nach oben)', () => {
    const scrollTop = 1000 // klar innerhalb [0, totalHeight - viewHeight]
    const same = anchorScrollForZoom({ offsetsOld: old.offsets, heightsOld: hOld, offsetsNew: old.offsets, heightsNew: hOld, scrollTop, viewHeight: viewH })
    expect(same).toBe(scrollTop)
  })

  it('randnaher Zoom bleibt im gültigen Bereich (kein Überschießen)', () => {
    const next = anchorScrollForZoom({ offsetsOld: old.offsets, heightsOld: hOld, offsetsNew: neu.offsets, heightsNew: hNew, scrollTop: 0, viewHeight: viewH })
    expect(next).toBeGreaterThanOrEqual(0)
  })
})

describe('pageTopScroll (§4 Seitenzahl -> Sprung)', () => {
  const col = buildColumn(MIXED, 1, 0, 99, GAP)
  it('Seite 1 -> 0', () => expect(pageTopScroll(col.offsets, 1)).toBe(0))
  it('Seite p -> offsets[p-1] (Seitenanfang)', () => {
    expect(pageTopScroll(col.offsets, 3)).toBe(col.offsets[2])
    expect(pageTopScroll(col.offsets, 2)).toBe(col.offsets[1])
  })
  it('bereichsüberschreitend -> geklemmt auf letzte Seite', () => {
    expect(pageTopScroll(col.offsets, 999)).toBe(col.offsets[col.offsets.length - 1])
    expect(pageTopScroll(col.offsets, 0)).toBe(0)
  })
})

describe('Akzeptanz-Sweep (§4): Fensterbreiten 400/800/1600, Gutter abgezogen', () => {
  // p-6 beidseitig = 48 px Gutter (identisch innerBox aus der AppShell-Messung).
  const GUTTER = 48
  for (const clientWidth of [400, 800, 1600]) {
    it(`${clientWidth}px Fenster: einfaches Einpassen ohne Horizontal-Overflow`, () => {
      const avail = clientWidth - GUTTER
      const scale = fitWidthScale(MIXED, avail)
      const col = buildColumn(MIXED, scale, 0, 99, GAP)
      const widest = Math.max(...col.entries.map((e) => e.w))
      expect(Math.abs(widest - avail)).toBeLessThanOrEqual(2)          // füllt die Breite ±2 px
      expect(widest).toBeLessThanOrEqual(avail + 1)                    // kein Overflow -> keine H-Scrollbar
      expect(col.entries.every((e) => e.render)).toBe(true)            // alle sichtbar/gerendert
      // Slot == eigene Seite, exakt:
      col.entries.forEach((e, i) => {
        const d = MIXED[i] as PageDims
        const css = slotCss(d, scale)
        expect(e.w).toBe(css.w); expect(e.h).toBe(css.h)
      })
      // gleiche Abstände + Gesamtsumme:
      for (let i = 1; i < col.offsets.length; i++) {
        expect((col.offsets[i] as number) - (col.offsets[i - 1] as number))
          .toBe(((col.entries[i - 1] as { h: number }).h) + GAP)
      }
      const sumH = col.entries.reduce((a, e) => a + e.h, 0)
      expect(Math.abs(col.totalHeight - (sumH + GAP * (col.entries.length - 1)))).toBeLessThanOrEqual(2)
    })
  }
  it('Layout ist dpr-frei (logische CSS-Pixel); dpr skaliert nur den Backing Store (pageRenderDpr.test)', () => {
    const avail = 800 - GUTTER
    // derselbe Scale für dpr 1 und 2, weil dpr in kein Layout-Modell eingeht:
    expect(fitWidthScale(MIXED, avail)).toBe(fitWidthScale(MIXED, avail))
  })
})

// R70 (Nutzerbefund "Drehpfeile zoomt nur"): Die Anzeige-Drehung vertauscht Breite/Hoehe.
// Ohne diese Umschaltung rechnen Fit-Modus, Spaltenhoehen und Scrollanker mit der falschen
// Orientierung — die gedrehte Seite wird beschnitten und sieht wie ein Zoom aus.
describe('layoutDimsForView (R70 Anzeige-Drehung)', () => {
  it('laesst die Masse bei 0 und 180 Grad unveraendert', () => {
    expect(layoutDimsForView(MIXED, 0)).toEqual(MIXED)
    expect(layoutDimsForView(MIXED, 180)).toEqual(MIXED)
  })

  it('vertauscht Breite und Hoehe bei 90 und 270 Grad', () => {
    for (const deg of [90, 270]) {
      const out = layoutDimsForView(MIXED, deg)
      expect(out).toHaveLength(MIXED.length)
      MIXED.forEach((d, i) => {
        expect(out[i]).toEqual({ w: d.h, h: d.w })
      })
    }
  })

  it('normalisiert krumme Winkel (450 -> 90, -90 -> 270) und kopiert nichts unnoetig', () => {
    expect(layoutDimsForView(MIXED, 450)).toEqual(layoutDimsForView(MIXED, 90))
    expect(layoutDimsForView(MIXED, -90)).toEqual(layoutDimsForView(MIXED, 270))
    expect(layoutDimsForView(MIXED, 360)).toEqual(MIXED)
  })

  it('Fit-Page einer gedrehten Seite rechnet gegen die GEDREHTEN Masse', () => {
    const portrait: PageDims[] = [{ w: 595, h: 842 }]
    const rotated = layoutDimsForView(portrait, 90)
    expect(rotated[0]).toEqual({ w: 842, h: 595 })
    // Breite 900, Hoehe 600: gedreht passt die Seite in der Breite (900/842), ungedreht nicht.
    const fitRotated = Math.min(900 / Math.max(...rotated.map((d) => d.w)), 600 / Math.max(...rotated.map((d) => d.h)))
    const fitPortrait = Math.min(900 / 595, 600 / 842)
    expect(fitRotated).toBeCloseTo(600 / 595, 5)
    expect(fitPortrait).toBeCloseTo(600 / 842, 5)
    expect(fitRotated).toBeGreaterThan(fitPortrait)
  })
})

// R73 Nutzerbefund ("facing pages liefert nur die ersten Seiten, danach nur '…'"): Die
// Navigations-Geometrie gab es nur fuer Einspalten-Modi. Dadurch blieb der Scroll-Spy (und damit
// das Render-Fenster der Doppelseiten) auf Seite 1 stehen. Diese Helfer beschreiben beide Modi.
describe('Navigations-Geometrie fuer alle Layout-Modi (R73)', () => {
  const DIMS: PageDims[] = Array.from({ length: 5 }, () => ({ w: 600, h: 800 }))
  const GAP = 20

  it('Einspalte: eine Gruppe pro Seite, offsetsByPage == Gruppen-Offsets', () => {
    const g = navGeometryForColumn(DIMS, 0.5, GAP)
    expect(g.groups).toEqual([[1], [2], [3], [4], [5]])
    expect(g.offsetsByPage).toEqual(g.groupOffsets)
    expect(g.groupHeights).toEqual([400, 400, 400, 400, 400])
    expect(g.groupOffsets[1]).toBe(420)
  })

  it('Doppelseiten: Gruppen sind Zeilen, offsetsByPage zeigt beide Seiten auf den Zeilenanfang', () => {
    const rows = [[1], [2, 3], [4, 5]]
    const g = navGeometryForFacing(rows, DIMS, 0.5, GAP)
    expect(g.groups).toEqual([[1], [2, 3], [4, 5]])
    expect(g.groupOffsets).toEqual([0, 420, 840])
    expect(g.offsetsByPage).toEqual([0, 420, 420, 840, 840])
    expect(g.groupHeights).toEqual([400, 400, 400])
  })

  it('groupIndexWithLargestShare findet die sichtbare Zeile (und -1 ohne Ueberdeckung)', () => {
    const tops = [24, 444, 864]
    const bottoms = [424, 844, 1264]
    expect(groupIndexWithLargestShare(500, 900, tops, bottoms)).toBe(1)
    expect(groupIndexWithLargestShare(900, 1200, tops, bottoms)).toBe(2)
    expect(groupIndexWithLargestShare(2000, 2100, tops, bottoms)).toBe(-1)
  })

  it('pageForGroup bevorzugt die schon sichtbare Seite der Zeile (kein Flackern)', () => {
    const groups = [[1], [2, 3], [4, 5]]
    expect(pageForGroup(groups, 1, 3)).toBe(3) // rechte Seite bleibt rechts
    expect(pageForGroup(groups, 1, 1)).toBe(2)
    expect(pageForGroup(groups, 99, 3)).toBe(3)
  })

  it('Doppelseiten mit Titelblatt: Zeile 1 nur Seite 1, danach Paare', () => {
    const rows = [[1], [2, 3], [4, 5], [6]]
    const dims6: PageDims[] = Array.from({ length: 6 }, () => ({ w: 600, h: 800 }))
    const g = navGeometryForFacing(rows, dims6, 0.5, GAP)
    expect(g.groups).toEqual([[1], [2, 3], [4, 5], [6]])
    expect(g.offsetsByPage[5]).toBe(g.groupOffsets[3])
  })
})
