// Koordinaten‑Contract (Spec Section 4): Canvas‑/Overlay‑Punkte -> PDF‑User‑Space
// (Ursprung UNTEN‑LINKS, Einheiten Punkte, 72 dpi). Zoom, devicePixelRatio und Seitenrotation
// werden HIER herausgerechnet; das Backend transformiert nicht.
//
// Port 1:1 aus pdfjs-dist 4.10.38 `PageViewport` (src/display/display_utils.js): identische
// `transform`-Matrix-Konstruktion + kanonische Util.applyTransform/applyInverseTransform.
// convertToPdfPoint === applyInverseTransform([x,y], transform). public API, stabil in 4.x.

export type PdfTransform = readonly [number, number, number, number, number, number]

export interface PdfPageBox {
  /** Blatthöhe/Breite in PDF-Punkten (MediaBox bei userUnit 1, viewBox [0,0,w,h]). */
  width: number
  height: number
}

function rotationMatrix(rotation: number): readonly [number, number, number, number] {
  let r = rotation % 360
  if (r < 0) r += 360
  switch (r) {
    case 180:
      return [-1, 0, 0, 1]
    case 90:
      return [0, 1, 1, 0]
    case 270:
      return [0, -1, -1, 0]
    case 0:
      return [1, 0, 0, -1]
    default:
      throw new Error(`Rotation muss ein Vielfaches von 90° sein, war ${rotation}`)
  }
}

/** Baut exakt die pdfjs-PageViewport-Matrix [a,b,c,d,e,f] (dontFlip=false, offsetX/Y=0, userUnit=1). */
export function buildPdfViewportTransform(page: PdfPageBox, scale: number, rotation: number): PdfTransform {
  const viewBox: readonly [number, number, number, number] = [0, 0, page.width, page.height]
  const centerX = (viewBox[2] + viewBox[0]) / 2
  const centerY = (viewBox[3] + viewBox[1]) / 2
  const [a, b, c, d] = rotationMatrix(rotation)
  let offsetCanvasX: number
  let offsetCanvasY: number
  if (a === 0) {
    offsetCanvasX = Math.abs(centerY - viewBox[1]) * scale
    offsetCanvasY = Math.abs(centerX - viewBox[0]) * scale
  } else {
    offsetCanvasX = Math.abs(centerX - viewBox[0]) * scale
    offsetCanvasY = Math.abs(centerY - viewBox[1]) * scale
  }
  return [
    a * scale,
    b * scale,
    c * scale,
    d * scale,
    offsetCanvasX - a * scale * centerX - c * scale * centerY,
    offsetCanvasY - b * scale * centerX - d * scale * centerY
  ]
}

function applyTransform(x: number, y: number, m: PdfTransform): readonly [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

function inverseTransform(m: PdfTransform): PdfTransform {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

export interface PdfPoint {
  x: number
  y: number
}

/**
 * Ein Punkt im Viewport-/Overlay-Raum (CSS-Pixel, Ursprung oben-links über dem gerenderten Blatt)
 * -> PDF-User-Space (unten-links). `cssX/cssY` müssen bereits devicePixelRatio-bereinigt sein.
 */
export function canvasPointToPdf(
  cssX: number,
  cssY: number,
  page: PdfPageBox,
  scale: number,
  rotation: number
): PdfPoint {
  const inv = inverseTransform(buildPdfViewportTransform(page, scale, rotation))
  const [x, y] = applyTransform(cssX, cssY, inv)
  return { x, y }
}

export interface PdfRect {
  /** linke-x, untere-y (PDF-User-Space, unten-links) + positive Breite/Höhe. */
  x: number
  y: number
  width: number
  height: number
}

/**
 * Ein auf dem Canvas gezogtes Auswahlrechteck (zwei gegenüberliegende Ecken in CSS-Pixel)
 * -> PDF-User-Space-Rechteck mit unten-links-Ursprung. Zoom/DPR/Rotation sind herausgerechnet.
 */
export function canvasRectToPdf(
  cornerA: readonly [number, number],
  cornerB: readonly [number, number],
  page: PdfPageBox,
  scale: number,
  rotation: number
): PdfRect {
  const a = canvasPointToPdf(cornerA[0], cornerA[1], page, scale, rotation)
  const b = canvasPointToPdf(cornerB[0], cornerB[1], page, scale, rotation)
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/** PDF-Punkt -> Viewport-Raum (CSS-Pixel). Nutzt dieselbe Matrix wie oben (pdfjs convertToViewportPoint). */
export function pdfPointToCanvas(
  x: number,
  y: number,
  page: PdfPageBox,
  scale: number,
  rotation: number
): PdfPoint {
  const [cx, cy] = applyTransform(x, y, buildPdfViewportTransform(page, scale, rotation))
  return { x: cx, y: cy }
}
