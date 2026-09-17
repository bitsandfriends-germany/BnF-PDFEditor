import { useEffect, useRef } from 'react'
import { pdfjs, type PDFDocumentProxy, type PDFPageProxy } from '@/lib/pdfjs'

type PageViewport = ReturnType<PDFPageProxy['getViewport']>

// PDF.js-Textebene ueber der gerenderten Seite (Section 5): nativauswahlbarer, unsichtbarer Text.
// Copy (Strg+C) uebernimmt der Browser; das Interaktions-Overlay liegt darueber und blockiert nur,
// wenn ein Zeichen-Werkzeug aktiv ist — so kollidiert Selektion nie mit Rechteck-Ziehen.

export interface PageTextLayerProps {
  doc: PDFDocumentProxy | null
  pageNumber: number // 1-basiert
  viewport: PageViewport | null
}

export function PageTextLayer({ doc, pageNumber, viewport }: PageTextLayerProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = ref.current
    if (!container) return
    container.textContent = ''
    if (!doc || !viewport) return

    let cancelled = false
    let layer: { cancel?: () => void } | null = null
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled || !ref.current) return
        const tl = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container: ref.current,
          viewport: viewport as never
        })
        layer = tl
        await tl.render()
      } catch {
        // Abbruch/leere Seite: Textebene bleibt leer, Seite bleibt rendert. Kein Absturz.
      }
    })()

    return () => {
      cancelled = true
      try {
        layer?.cancel?.()
      } catch {
        /* egal */
      }
      if (ref.current) ref.current.textContent = ''
    }
  }, [doc, pageNumber, viewport])

  return <div ref={ref} data-testid="text-layer" data-page={pageNumber} className="text-layer" aria-hidden />
}
