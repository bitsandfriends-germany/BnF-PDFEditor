import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePdfPageRender } from '@/hooks/usePdfPageRender'
import type { PDFDocumentProxy } from '@/lib/pdfjs'

// R70 Nutzerbefund ("Drehpfeile zoomt nur"): pdfjs laesst pro Canvas nur EINEN laufenden
// render()-Auftrag zu (WeakSet; "Cannot use the same canvas during multiple render()
// operations"). Eine Drehung loest zwei Effekt-Laeufe aus (Drehung + Fit-Neuberechnung). Der
// zweite Lauf brach ab, die Geometrie blieb auf dem alten Stand -> gestauchte Seite.
// Dieser Test bildet das pdfjs-Verhalten exakt nach: die Canvas ist waehrend eines Auftrags
// "belegt", cancel() gibt sie frei — und prueft, dass der Hook Auftraege serialisiert und die
// Geometrie der letzten Drehung/Skalierung veroeffentlicht.
const inUse = new WeakSet<HTMLCanvasElement>()

function fakePage(delayMs = 10, gateMs = 0, pageRotate = 0): PDFDocumentProxy extends never ? never : {
  getViewport: (o: { scale: number; rotation?: number }) => { width: number; height: number }
  getAnnotations: () => Promise<never[]>
  render: (o: { canvasContext: { canvas: HTMLCanvasElement }; viewport: { width: number; height: number } }) => { promise: Promise<void>; cancel: () => void }
} {
  return {
    rotate: pageRotate,
    // pdfjs: getViewport({rotation}) ERSETZT die Seitenrotation — genau hier lag der R71-Fehler.
    getViewport: ({ scale, rotation }) => {
      const eff = rotation === undefined ? pageRotate : rotation
      const base = Math.round(eff / 90) % 2 === 0 ? { w: 600, h: 800 } : { w: 800, h: 600 }
      return { width: base.w * scale, height: base.h * scale }
    },
    // pdfjs liefert die Operatorliste asynchron (Makrotask) — genau dieses Fenster
    // zwischen Effekt-Cleanup und render() ist die Luecke, in der zwei Auftraege
    // gleichzeitig auf derselben Canvas landen.
    getAnnotations: async () => {
      if (gateMs > 0) await new Promise((r) => setTimeout(r, gateMs))
      return []
    },
    render: ({ canvasContext }) => {
      const canvas = canvasContext.canvas
      let settle: { resolve: () => void; reject: (e: unknown) => void } | null = null
      const promise = new Promise<void>((resolve, reject) => {
        settle = { resolve, reject }
      })
      const start = (): void => {
        // pdfjs: initializeGraphics wirft, wenn die Canvas schon belegt ist.
        if (inUse.has(canvas)) {
          renderErrors.push('Cannot use the same canvas during multiple render() operations.')
          settle?.reject(Object.assign(new Error('Cannot use the same canvas during multiple render() operations.'), { name: 'Error' }))
          return
        }
        inUse.add(canvas)
        setTimeout(() => {
          inUse.delete(canvas)
          settle?.resolve()
        }, delayMs)
      }
      setTimeout(start, 5)
      return {
        promise,
        cancel: () => {
          inUse.delete(canvas)
          settle?.reject(Object.assign(new Error('Rendering cancelled'), { name: 'RenderingCancelledException' }))
        }
      }
    }
  }
}

let renderErrors: string[] = []

function setup(initial: { scale: number; rotation: number }, delayMs = 10, gateMs = 0, pageRotate = 0) {
  const page = fakePage(delayMs, gateMs, pageRotate)
  const doc = { getPage: async () => page } as unknown as PDFDocumentProxy
  const canvas = document.createElement('canvas')
  // pdfjs liest den Canvas-Rueckverweis aus dem 2D-Kontext -> Stub muss ihn mitliefern.
  ;(canvas as unknown as { getContext: () => unknown }).getContext = () => ({ canvas })
  const canvasRef = { current: canvas }
  return renderHook(
    (props: { scale: number; rotation: number }) =>
      usePdfPageRender({ doc, pageNumber: 1, scale: props.scale, rotation: props.rotation, canvasRef }),
    { initialProps: initial }
  )
}

describe('usePdfPageRender (R70 Anzeige-Drehung)', () => {
  it('veroeffentlicht die Geometrie der Drehung — Folgeauftrag startet erst nach dem Vorgaenger', async () => {
    renderErrors = []
    // Langer Render (60 ms): der Auftrag HAELT die Canvas, waehrend der Nutzerklick die
    // Drehung (und die Fit-Neuberechnung) ausloest — genau die Lage aus dem echten Viewer.
    const { result, rerender } = setup({ scale: 1, rotation: 0 }, 60, 20)
    // Nutzerklick: Drehung 90, danach (eigener Tick, wie der Fit-Effekt im echten Viewer)
    // die neue Zoom-Skalierung. Beide Laeufe stecken beim Aufraeumen noch in den pdfjs-Awaits,
    // es gibt also KEINEN registrierten Auftrag zum Abbrechen — die reale Ausgangslage.
    await new Promise((r) => setTimeout(r, 5))
    rerender({ scale: 1, rotation: 90 })
    await new Promise((r) => setTimeout(r, 5))
    rerender({ scale: 0.75, rotation: 90 })

    await waitFor(() => expect(result.current.status).toBe('done'), { timeout: 3000 })
    // Geometrie der LETZTEN Anfrage (gedreht + neue Skalierung) — vorher blieb sie stale.
    expect(result.current.cssWidth).toBeCloseTo(800 * 0.75, 5)
    expect(result.current.cssHeight).toBeCloseTo(600 * 0.75, 5)
    expect(renderErrors, 'kein "same canvas"-Abbruch').toEqual([])
  })

  it('zurueck auf 0 Grad liefert wieder die ungedrehte Geometrie', async () => {
    renderErrors = []
    const { result, rerender } = setup({ scale: 1, rotation: 90 })
    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.cssWidth).toBe(800)
    expect(result.current.cssHeight).toBe(600)

    rerender({ scale: 1, rotation: 0 })
    await waitFor(() => expect(result.current.status).toBe('done'), { timeout: 3000 })
    expect(result.current.cssWidth).toBe(600)
    expect(result.current.cssHeight).toBe(800)
    expect(renderErrors).toEqual([])
  })

  it('meldet echte Render-Fehler weiter als status=error', async () => {
    const doc = {
      getPage: async () => ({
        getViewport: () => ({ width: 100, height: 100 }),
        // pdfjs liefert die Operatorliste asynchron (Makrotask) — genau dieses Fenster
    // zwischen Effekt-Cleanup und render() ist die Luecke, in der zwei Auftraege
    // gleichzeitig auf derselben Canvas landen.
    getAnnotations: async () => {
      if (gateMs > 0) await new Promise((r) => setTimeout(r, gateMs))
      return []
    },
        render: () => ({
          promise: Promise.reject(new Error('kaputt')),
          cancel: () => {}
        })
      })
    } as unknown as PDFDocumentProxy
    const canvas = document.createElement('canvas')
    ;(canvas as unknown as { getContext: () => unknown }).getContext = () => ({ canvas })
    const canvasRef = { current: canvas }
    const { result } = renderHook(() => usePdfPageRender({ doc, pageNumber: 1, scale: 1, rotation: 0, canvasRef }))
    await waitFor(() => expect(result.current.status).toBe('error'))
  })

  it('laesst einen abgebrochenen Auftrag nicht als Fehler stehen (Unmount waehrend des Renderns)', async () => {
    renderErrors = []
    // Langer Render (80 ms): der Unmount trifft sicher WAEHREND des Auftrags ein.
    const { result, unmount } = setup({ scale: 1, rotation: 0 }, 80)
    await waitFor(() => expect(result.current.status).toBe('rendering'))
    unmount()
    await new Promise((r) => setTimeout(r, 120))
    expect(renderErrors).toEqual([])
  })

  it('ohne Dokument bleibt der Zustand idle', async () => {
    const canvas = document.createElement('canvas')
    const canvasRef = { current: canvas }
    const { result } = renderHook(() => usePdfPageRender({ doc: null, pageNumber: 1, scale: 1, rotation: 0, canvasRef }))
    expect(result.current.status).toBe('idle')
    expect(result.current.cssWidth).toBe(0)
  })
})


// R71 Nutzerbefund (Drehpfeile der Seitenleiste "zoomt nur"): pdfjs ersetzt bei
// getViewport({rotation}) die im Dokument gespeicherte Seitenrotation. Wurde viewRotation=0
// explizit uebergeben, blieb die Seite ungedreht, waehrend Fit/Zoom schon fuer die gedrehte
// Seite rechneten. Erwartet: die Anzeige ist die SUMME aus Seitenrotation und Anzeige-Drehung.
describe('usePdfPageRender (R71 Seitenrotation /Rotate)', () => {
  it('wendet die Seitenrotation an, wenn keine Anzeige-Drehung gesetzt ist', async () => {
    const { result } = setup({ scale: 1, rotation: 0 }, 5, 0, 90)
    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.totalRotation).toBe(90)
    expect(result.current.cssWidth).toBe(800) // gedreht: quer
    expect(result.current.cssHeight).toBe(600)
    // Ungedrehte Masse bleiben fuer PDF-Raum-Overlays verfuegbar.
    expect(result.current.flatWidth).toBe(600)
    expect(result.current.flatHeight).toBe(800)
  })

  it('addiert Seitenrotation und Anzeige-Drehung (90 + 90 = 180)', async () => {
    const { result } = setup({ scale: 1, rotation: 90 }, 5, 0, 90)
    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.totalRotation).toBe(180)
    expect(result.current.cssWidth).toBe(600) // 180 Grad: wieder hochkant
    expect(result.current.cssHeight).toBe(800)
  })

  it('270 Grad Seitenrotation bleibt quer, unabhaengig von der Anzeige-Drehung 0', async () => {
    const { result } = setup({ scale: 1, rotation: 0 }, 5, 0, 270)
    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.totalRotation).toBe(270)
    expect(result.current.cssWidth).toBe(800)
    expect(result.current.cssHeight).toBe(600)
  })
})

// vi wird fuer spaetere Erweiterungen importiert gehalten (Spy auf console.error o. ae.).
void vi
