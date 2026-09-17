import { describe, it, expect } from 'vitest'
import {
  buildPdfViewportTransform,
  canvasPointToPdf,
  canvasRectToPdf,
  pdfPointToCanvas
} from '@/lib/pdfCoords'

// Koordinaten-Contract (Spec Section 4): eine Platzierung bei 150 % Zoom auf einem um 90°
// gedrehten Blatt muss dieselben PDF-Koordinaten liefern wie dieselbe visuelle Stelle bei
// 100 % ohne Drehung. "Dieselbe visuelle Stelle" = derselbe PDF-Inhaltspunkt.

const PAGE = { width: 595, height: 842 } // A4 in Punkten

function close(a: number, b: number): void {
  expect(a).toBeCloseTo(b, 6)
}

describe('pdfCoords — Konvertierung über Zoom und Rotation', () => {
  it('liefert denselben PDF-Punkt bei 150%+90° wie bei 100%+0° (Contract-Test)', () => {
    const content: [number, number] = [120, 300] // ein Punkt in PDF-User-Space

    // Referenz: 100 %, unrotiert.
    const canvasRef = pdfPointToCanvas(content[0], content[1], PAGE, 1.0, 0)
    const pdfRef = canvasPointToPdf(canvasRef.x, canvasRef.y, PAGE, 1.0, 0)

    // Fall: 150 % Zoom auf um 90° gedrehtem Blatt.
    const canvasRot = pdfPointToCanvas(content[0], content[1], PAGE, 1.5, 90)
    const pdfRot = canvasPointToPdf(canvasRot.x, canvasRot.y, PAGE, 1.5, 90)

    // Beide Rekonstruktionen treffen exakt denselben PDF-Punkt.
    close(pdfRef.x, content[0])
    close(pdfRef.y, content[1])
    close(pdfRot.x, content[0])
    close(pdfRot.y, content[1])

    // ...und die beiden Canvas-Positionen sind bewusst verschieden (Zoom+Rotation wirken).
    expect(canvasRef.x).not.toBeCloseTo(canvasRot.x, 3)
  })

  it('round-trippt PDF<->Canvas für alle vier Rotationen', () => {
    const points: Array<[number, number]> = [
      [10, 10],
      [120, 300],
      [500, 700]
    ]
    for (const rot of [0, 90, 180, 270]) {
      for (const scale of [0.5, 1, 1.5, 2]) {
        for (const [px, py] of points) {
          const c = pdfPointToCanvas(px, py, PAGE, scale, rot)
          const back = canvasPointToPdf(c.x, c.y, PAGE, scale, rot)
          close(back.x, px)
          close(back.y, py)
        }
      }
    }
  })

  it('Rechteck bleibt geometrisch invariant über Zoom/Rotation (unten-links, positive Kanten)', () => {
    // Zwei PDF-Ecken eines Auswahlrechtecks.
    const p1: [number, number] = [100, 200]
    const p2: [number, number] = [260, 320]

    const ref = pdfPointToCanvas(p1[0], p1[1], PAGE, 1.0, 0)
    const ref2 = pdfPointToCanvas(p2[0], p2[1], PAGE, 1.0, 0)
    const rectRef = canvasRectToPdf([ref.x, ref.y], [ref2.x, ref2.y], PAGE, 1.0, 0)

    const r1 = pdfPointToCanvas(p1[0], p1[1], PAGE, 1.5, 90)
    const r2 = pdfPointToCanvas(p2[0], p2[1], PAGE, 1.5, 90)
    const rectRot = canvasRectToPdf([r1.x, r1.y], [r2.x, r2.y], PAGE, 1.5, 90)

    // unten-links-Ursprung + Kanten: identisch in beiden Szenarien.
    expect(rectRot.x).toBeCloseTo(rectRef.x, 6)
    expect(rectRot.y).toBeCloseTo(rectRef.y, 6)
    expect(rectRot.width).toBeCloseTo(rectRef.width, 6)
    expect(rectRot.height).toBeCloseTo(rectRef.height, 6)
    expect(rectRef.x).toBeCloseTo(100, 6)
    expect(rectRef.y).toBeCloseTo(200, 6)
    expect(rectRef.width).toBeCloseTo(160, 6)
    expect(rectRef.height).toBeCloseTo(120, 6)
  })

  it('lehnt Nicht-90°-Rotationen ab (Backend-Contract: Vielfache von 90)', () => {
    expect(() => buildPdfViewportTransform(PAGE, 1, 45)).toThrow()
  })
})
