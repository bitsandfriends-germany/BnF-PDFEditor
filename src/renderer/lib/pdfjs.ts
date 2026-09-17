import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
// Worker lokal bundlen (kein CDN, Section 1). Vite emittiert die .mjs als Asset und liefert
// eine URL, die der Renderer als Worker laedt — offline, same-origin, CSP-tauglich.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
export type { PDFDocumentProxy, PDFPageProxy }

// pdfjs gibt den uebergebenen Buffer per Transfer an den Worker — das wuerde das Array des
// Aufrufers detachieren. Pro Aufruf eine frische Kopie, damit der Caller weiter damit arbeiten kann.
export function openDocumentFromBytes(bytes: ArrayBuffer) {
  const copy = bytes.slice(0)
  // isEvalSupported:false — CSP ohne unsafe-eval (Section 2) respektieren.
  return pdfjs.getDocument({ data: copy, isEvalSupported: false })
}

// Ziel-Skalierung fuer eine Seite in einem Zielcontainer (Einpassung). Reine Funktion -> testbar.
export function fitScale(pageWidthPts: number, pageHeightPts: number, boxWidthPx: number, boxHeightPx: number): number {
  if (pageWidthPts <= 0 || pageHeightPts <= 0 || boxWidthPx <= 0 || boxHeightPx <= 0) return 1
  return Math.min(boxWidthPx / pageWidthPts, boxHeightPx / pageHeightPts)
}

// Geraetepixel-Groesse einer Seite bei gegebenem Zoom und devicePixelRatio.
export function canvasSizeFor(pageWidthPts: number, pageHeightPts: number, scale: number, dpr: number): { width: number; height: number } {
  return { width: Math.round(pageWidthPts * scale * dpr), height: Math.round(pageHeightPts * scale * dpr) }
}
