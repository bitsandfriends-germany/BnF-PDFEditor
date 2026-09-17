import { useEffect, useRef, useState, type RefObject } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from '@/lib/pdfjs'

type PageViewport = ReturnType<PDFPageProxy['getViewport']>

// Drehungen auf 0/90/180/270 normalisieren (auch negative/krumme Werte).
function normalizeDeg(deg: number): number {
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360
}

export interface PageRenderState {
  cssWidth: number
  cssHeight: number
  viewport: PageViewport | null // reale pdfjs-Viewport -> das Overlay nutzt convertToPdfPoint
  status: 'idle' | 'rendering' | 'done' | 'error'
  /** Gesamtdrehung der Anzeige in Grad: Seitenrotation (/Rotate) + Anzeige-Drehung. */
  totalRotation: number
  /** Groesse der UNGEDREHTEN Seite in CSS-Pixeln bei aktuellem Zoom (PDF-Raum-Overlays). */
  flatWidth: number
  flatHeight: number
}

// Rendert eine Seite in ein Canvas bei gegebenem Zoom, geraetepixelgenau (dpr), und liefert die
// exakt verwendete Viewport-Instanz zurueck — Overlay und Canvas teilen damit denselben Massstab.
//
// R70 Nutzerbefund ("Drehpfeile: es zoomt nur"): pdfjs erlaubt pro Canvas nur EINEN laufenden
// render()-Auftrag (internes WeakSet; Fehler "Cannot use the same canvas during multiple
// render() operations"). Schon eine einzelne Drehung loest zwei Effekt-Laeufe aus (Drehung plus
// Fit-Neuberechnung des Zooms). Der zweite Lauf brach ab, und weil nur der abgebrochene Lauf die
// Geometrie zurueckschrieb, blieb cssWidth/cssHeight auf dem alten Stand: die gedrehte Bitmap lag
// gestaucht in der alten Box — fuer den Nutzer sah das aus wie "nur Zoom".
// Darum: Auftraege pro Canvas streng serialisieren (vorherigen Auftrag abbrechen UND auf sein
// Ende warten) und die Geometrie sofort nach getViewport veroeffentlichen.
export function usePdfPageRender(args: {
  doc: PDFDocumentProxy | null
  pageNumber: number // 1-basiert
  scale: number
  rotation?: number
  canvasRef: RefObject<HTMLCanvasElement>
}): PageRenderState {
  const { doc, pageNumber, scale, rotation, canvasRef } = args
  const IDLE: PageRenderState = { cssWidth: 0, cssHeight: 0, viewport: null, status: 'idle', totalRotation: 0, flatWidth: 0, flatHeight: 0 }
  const [state, setState] = useState<PageRenderState>(IDLE)
  const taskRef = useRef<{ promise: Promise<void>; cancel: () => void } | null>(null)
  const queueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const canvas = canvasRef.current
    if (!doc || !canvas) {
      setState(IDLE)
      return
    }
    let cancelled = false

    const run = async (): Promise<void> => {
      // 1) Laufenden Auftrag dieser Canvas erst WIRKLICH beenden — cancel() allein genuegt
      //    nicht, weil pdfjs den Auftrag asynchron abbaut.
      const prev = taskRef.current
      if (prev !== null) {
        try {
          prev.cancel()
        } catch {
          /* bereits beendet */
        }
        try {
          await prev.promise
        } catch {
          /* Abbruch ist der Normalfall */
        }
        if (taskRef.current === prev) taskRef.current = null
      }
      if (cancelled) return
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
        // R71 Nutzerbefund (Drehpfeile in der Seitenleiste "zoomt nur"): pdfjs ersetzt bei
        // getViewport({rotation}) die im Dokument gespeicherte Seitenrotation (/Rotate) — mit
        // einem expliziten viewRotation=0 wurde die Seite also IMMER ungedreht gezeichnet,
        // waehrend Fit/Zoom schon fuer die gedrehte Seite rechneten. Richtig ist die SUMME:
        // Seitenrotation + Anzeige-Drehung.
        const pageRot = normalizeDeg((page as unknown as { rotate?: number }).rotate ?? 0)
        const viewRot = normalizeDeg(rotation ?? 0)
        const totalRot = normalizeDeg(pageRot + viewRot)
        const viewport = page.getViewport({ scale, rotation: totalRot })
        // Ungedrehte Seite (PDF-Raum): Formularfelder und PDF-Overlays rechnen in User-Space.
        const flat = page.getViewport({ scale, rotation: 0 })
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        const ctx = canvas.getContext('2d')
        if (!ctx || cancelled) return
        // 2) Geometrie SOFORT veroeffentlichen: Box und Overlay folgen der aktuellen
        //    Drehung/Skalierung auch dann, wenn ein spaeterer Lauf diesen hier abloest.
        const geom = {
          cssWidth: viewport.width,
          cssHeight: viewport.height,
          viewport,
          totalRotation: totalRot,
          flatWidth: flat.width,
          flatHeight: flat.height
        }
        setState((s) => (s.viewport === viewport ? { ...s, status: 'rendering' } : { ...geom, status: 'rendering' }))
        // R66: pdfjs rendert Signatur-Feldansichten (Bild/Name/Zeit) NUR bei
        // Render-Intent 'print' in das Canvas — beim normalen 'display'-Intent
        // bliebe das unterzeichnete Feld leer. Der Viewer ist eine Anzeige, kein
        // Formular-Editor (Formulare zeichnet unsere eigene Formularschicht),
        // daher: Seiten MIT Signaturfeldern im Print-Intent rendern. Seiten ohne
        // Sig-Felder bleiben beim Standard-Intent (kein Verhaltenwechsel).
        let intent: 'display' | 'print' = 'display'
        try {
          const anns = await page.getAnnotations()
          if (anns.some((a) => a.subtype === 'Widget' && a.fieldType === 'Sig')) intent = 'print'
        } catch {
          /* Annotationen unlesbar -> Standard-Render */
        }
        if (cancelled) return
        const task = page.render({ canvasContext: ctx, viewport, transform: [dpr, 0, 0, dpr, 0, 0], intent })
        taskRef.current = task
        try {
          await task.promise
        } catch (err) {
          const name = err instanceof Error ? err.name : ''
          if (cancelled || name === 'RenderingCancelledException') return // absichtlicher Abbruch
          setState((s) => ({ ...s, status: 'error' }))
          return
        } finally {
          if (taskRef.current === task) taskRef.current = null
        }
        if (!cancelled) setState({ ...geom, status: 'done' })
      } catch (err) {
        if (cancelled) return
        const name = err instanceof Error ? err.name : ''
        if (name === 'RenderingCancelledException') return
        setState((s) => ({ ...s, status: 'error' }))
      }
    }

    queueRef.current = queueRef.current.then(run, run)

    return () => {
      cancelled = true
      try {
        taskRef.current?.cancel()
      } catch {
        /* bereits beendet */
      }
    }
  }, [doc, pageNumber, scale, rotation, canvasRef])

  return state
}
