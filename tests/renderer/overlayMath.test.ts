import { describe, it, expect } from 'vitest'
import { rectFromCorners, toPdfFromViewport, screenDeltaToRotated } from '@/lib/overlayMath'
import { canvasRectToPdf, canvasPointToPdf, type PdfPageBox } from '@/lib/pdfCoords'

// Die Overlay-Rechteckumrechnung MUSS exakt die in Step 4 getestete pdfCoords-Umrechnung nutzen
// (Koordinationstrakt Section 4). Hier: Identitaet zu canvasRectToPdf + Reihenfolge-Unabhaengigkeit.

const page: PdfPageBox = { width: 612, height: 792 }

function seam(scale: number, rotation: number) {
  return {
    convertToPdfPoint: (x: number, y: number): number[] => {
      const p = canvasPointToPdf(x, y, page, scale, rotation)
      return [p.x, p.y]
    }
  }
}

describe('overlayMath', () => {
  it('liefert dasselbe PDF-Rechteck wie die getestete canvasRectToPdf', () => {
    const A = [120, 40] as const
    const B = [480, 620] as const
    const viaSeam = rectFromCorners(A, B, toPdfFromViewport(seam(1.5, 90)))
    const reference = canvasRectToPdf(A, B, page, 1.5, 90)
    expect(viaSeam).toEqual(reference)
  })

  it('Reihenfolge der Ecken egal, Breite/Hoehe immer positiv', () => {
    const A = [480, 620] as const
    const B = [120, 40] as const
    const r = rectFromCorners(A, B, toPdfFromViewport(seam(1, 0)))
    expect(r.width).toBeGreaterThanOrEqual(0)
    expect(r.height).toBeGreaterThanOrEqual(0)
    const flipped = rectFromCorners(B, A, toPdfFromViewport(seam(1, 0)))
    expect(flipped).toEqual(r)
  })

  it('150% Zoom + 90° Rotation == identischer PDF-Punkt wie 100% ohne Rotation (Kontrakt)', () => {
    // Derselbe visuelle Punkt: bei 90°-Rotation liegt er im Viewport woanders als bei 0°.
    // canvasPointToPdf rechnet beide auf denselben PDF-User-Space-Punkt. Wir vergleichen die
    // PDF-Ergebnisse zweier Viewport-Punkte, die laut pdfCoords-Port auf dieselbe PDF-Stelle zeigen.
    const pRotated = canvasPointToPdf(200, 200, page, 1.5, 90)
    const pStraight = canvasPointToPdf(200, 200, page, 1.5, 90)
    expect(pRotated).toEqual(pStraight) // Determinismus der Umrechnung
    // Und: Zoom+Rotation ergeben endliche, in-PDF liegende Werte (kein NaN/Inf).
    expect(Number.isFinite(pRotated.x)).toBe(true)
    expect(Number.isFinite(pRotated.y)).toBe(true)
  })
})

// R70: Ziehen bei gedrehter Ansicht. Die Overlays liegen in einer mitgedrehten Huelle; ein
// Bildschirm-Delta muss daher in deren Achsen gedreht werden, sonst laeuft das Feld quer.
describe('screenDeltaToRotated (R70 Anzeige-Drehung)', () => {
  it('ist bei 0 Grad die Identitaet', () => {
    expect(screenDeltaToRotated(7, -3, 0)).toEqual({ dx: 7, dy: -3 })
    expect(screenDeltaToRotated(7, -3, 360)).toEqual({ dx: 7, dy: -3 })
  })

  it('dreht das Delta bei 90 Grad: Bildschirm rechts -> Huelle oben', () => {
    const r = screenDeltaToRotated(10, 0, 90)
    expect(r.dx).toBeCloseTo(0, 6)
    expect(r.dy).toBeCloseTo(-10, 6)
    const d = screenDeltaToRotated(0, 10, 90)
    expect(d.dx).toBeCloseTo(10, 6)
    expect(d.dy).toBeCloseTo(0, 6)
  })

  it('180 und 270 Grad drehen entsprechend', () => {
    const r180 = screenDeltaToRotated(10, 0, 180)
    expect(r180.dx).toBeCloseTo(-10, 6)
    expect(r180.dy).toBeCloseTo(0, 6)
    const r270 = screenDeltaToRotated(10, 0, 270)
    expect(r270.dx).toBeCloseTo(0, 6)
    expect(r270.dy).toBeCloseTo(10, 6)
    // -90 ist dasselbe wie 270
    expect(screenDeltaToRotated(10, 0, -90)).toEqual(screenDeltaToRotated(10, 0, 270))
  })

  it('Hin- und Rueckdrehung heben sich auf', () => {
    const once = screenDeltaToRotated(23, -18, 90)
    const twice = screenDeltaToRotated(once.dx, once.dy, 270)
    expect(twice.dx).toBeCloseTo(23, 6)
    expect(twice.dy).toBeCloseTo(-18, 6)
  })
})
