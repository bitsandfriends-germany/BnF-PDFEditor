import type { PdfRect } from './pdfCoords'

// Overlay-Koordinaten (Section 4, Koordinationstrakt). Das laufende Overlay nutzt die
// OEFFENTLICHE pdfjs-Naht viewport.convertToPdfPoint (kein PDF.js-Interaktionlayer). Diese reine
// Funktion nimmt eine `toPdf`-Callback-Form, damit sie ohne pdfjs-Runtime getestet werden kann.

export type ToPdfPoint = (cssX: number, cssY: number) => { x: number; y: number }

// Minimalform des pdfjs-Viewport-Seams, das das Overlay benoetigt.
export interface ViewportSeam {
  convertToPdfPoint(x: number, y: number): number[]
}

export function toPdfFromViewport(vp: ViewportSeam): ToPdfPoint {
  return (x, y) => {
    const p = vp.convertToPdfPoint(x, y)
    return { x: p[0] ?? 0, y: p[1] ?? 0 }
  }
}

// Zwei gegenueberliegende Ecken eines in CSS-Pixeln gezogenen Rechtecks -> PDF-User-Space-Rechteck
// (unten-links Ursprung, positive Breite/Hoehe). Zoom/DPR/Rotation stecken bereits in `toPdf`.
export function rectFromCorners(
  cornerA: readonly [number, number],
  cornerB: readonly [number, number],
  toPdf: ToPdfPoint
): PdfRect {
  const a = toPdf(cornerA[0], cornerA[1])
  const b = toPdf(cornerB[0], cornerB[1])
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

// R70 (Anzeige-Drehung): Die PDF-Raum-Overlays (Signaturfeld, Bildobjekt) liegen bei gedrehter
// Ansicht in einer Huelle, die per CSS `rotate(viewRotation)` gedreht wird. Ein Zeigerdelta auf
// dem Bildschirm entspricht dann NICHT mehr den Achsen des Overlays: es muss um -viewRotation
// gedreht werden, sonst zieht der Nutzer ein gedrehtes Feld in die falsche Richtung.
// CSS rotiert mit y nach unten; R(θ) bildet Kind-Deltas auf Bildschirm-Deltas ab, hier also die
// Umkehrung R(-θ).
export function screenDeltaToRotated(dx: number, dy: number, viewRotation: number): { dx: number; dy: number } {
  const deg = ((Math.round(viewRotation / 90) * 90) % 360 + 360) % 360
  if (deg === 0) return { dx, dy }
  const rad = (-deg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return { dx: dx * c - dy * s, dy: dx * s + dy * c }
}
