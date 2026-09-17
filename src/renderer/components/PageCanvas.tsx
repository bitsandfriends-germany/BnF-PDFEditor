import { useEffect, useRef } from 'react'
import { usePdfPageRender } from '@/hooks/usePdfPageRender'
import { InteractionOverlay, type OverlayTool } from '@/components/InteractionOverlay'
import { PageTextLayer } from '@/components/PageTextLayer'
import { FormLayer } from '@/components/FormLayer'
import { rectFromCorners, toPdfFromViewport } from '@/lib/overlayMath'
import type { PDFDocumentProxy } from '@/lib/pdfjs'
import type { FormField } from '@/lib/documents'
import { useUiStore } from '@/store/useUiStore'
import type { PdfRect } from '@/lib/pdfCoords'

// Hauptseite: Canvas unten, (optionale) Textschicht, darueber das geteilte Interaktions-Overlay
// (Stapelreihenfolge Section 4). Canvas und Overlay teilen dieselbe Viewport-Instanz aus
// usePdfPageRender — damit sitzt die Overlay-Koordinatenumrechnung exakt auf dem gerenderten Massstab.

export interface PageCanvasProps {
  doc: PDFDocumentProxy | null
  pageNumber: number // 1-basiert
  scale: number
  rotation?: number
  activeTool?: OverlayTool
  invert?: boolean // rein visuelle invertierte Darstellung (Section 5), veraendert NICHT das Dokument
  onRect?: (rect: PdfRect) => void
  onToolCancel?: () => void
  formFields?: FormField[] | undefined
  highlightFormFields?: boolean | undefined
  formReadOnly?: boolean | undefined
  onFieldCommit?: ((name: string, value: string | boolean) => void) | undefined
  /** §6: Rechtsklick auf die Seite öffnet das Canvas-Kontextmenü (Seite unter dem Cursor). */
  onRequestMenu?: ((page: number, x: number, y: number) => void) | undefined
  onDblClickPdf?: ((page: number, gx: number, gyBottomLeft: number) => void) | undefined
  /** R64: einfacher Klick auf die Seite (PDF-Koordinaten, y unten-links) — fuer Signaturfeld-Infos. */
  onPdfClick?: ((page: number, gx: number, gyBottomLeft: number, screen: { x: number; y: number }) => void) | undefined
  /** §6: Textauswahl in DIESER Seitentextschicht (null = keine Auswahl mehr). */
  onSelection?: ((page: number, sel: { text: string; rect: PdfRect } | null) => void) | undefined
}

export function PageCanvas({ doc, pageNumber, scale, rotation, activeTool = 'none', invert = false, onRect, onToolCancel, formFields, highlightFormFields = true, formReadOnly = false, onFieldCommit, onRequestMenu, onSelection, onDblClickPdf, onPdfClick }: PageCanvasProps): JSX.Element {
  // R60: Modi aus dem Store — 'pan' faengt Zeiger (Container scrollt, AppShell),
  // 'text' erzwingt Text-Cursor + Auswahl auch wenn ein Werkzeug passiv waere.
  const viewerMode = useUiStore((s) => s.viewerMode)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const render = usePdfPageRender({ doc, pageNumber, scale, ...(rotation !== undefined ? { rotation } : {}), canvasRef })

  // §6: Auswahl-Fänger. Nutzt dieselbe Viewport-Naht (convertToPdfPoint) wie der Drag des
  // Interaktions-Overlays -> Zoom/DPR/Rotation sind herausgerechnet, identische Koordinaten.
  useEffect(() => {
    if (!onSelection) return
    const report = (): void => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { onSelection(pageNumber, null); return }
      const anchor = sel.anchorNode
      const el = anchor instanceof Element ? anchor : anchor?.parentElement
      if (!el?.closest(`[data-testid="text-layer"][data-page="${pageNumber}"]`)) return // andere Seite
      const text = sel.toString()
      const vp = render.viewport
      const box = boxRef.current
      if (text.trim() === '' || !vp || !box) { onSelection(pageNumber, null); return }
      const rangeRect = sel.getRangeAt(0).getBoundingClientRect()
      const boxRect = box.getBoundingClientRect()
      if (rangeRect.width === 0 && rangeRect.height === 0) { onSelection(pageNumber, null); return }
      const rect = rectFromCorners(
        [rangeRect.left - boxRect.left, rangeRect.top - boxRect.top],
        [rangeRect.right - boxRect.left, rangeRect.bottom - boxRect.top],
        toPdfFromViewport(vp)
      )
      onSelection(pageNumber, { text, rect })
    }
    document.addEventListener('selectionchange', report)
    return () => document.removeEventListener('selectionchange', report)
  }, [pageNumber, onSelection, render.viewport])

  // R71: Formularfelder rechnen in PDF-User-Space (ungedrehter Seitenkasten). Sie liegen daher in
  // einer Huelle in ungedrehter Groesse, die um die Gesamtdrehung (Seitenrotation + Anzeige-
  // Drehung) gedreht wird — damit sitzen sie auch auf gedrehten Seiten exakt auf dem Feld.
  const showForm = formFields && formFields.length > 0 && render.flatWidth > 0
  const pageWidthPts = scale > 0 ? render.flatWidth / scale : 0
  const pageHeightPts = scale > 0 ? render.flatHeight / scale : 0

  return (
    <div
      ref={boxRef}
      className="relative mx-auto shadow-sm ring-1 ring-black/10"
      style={{ width: render.cssWidth || undefined, height: render.cssHeight || undefined, userSelect: (activeTool === 'none' && viewerMode !== 'pan') || viewerMode === 'text' ? 'text' : 'none', cursor: viewerMode === 'pan' ? 'grab' : viewerMode === 'text' ? 'text' : undefined, backgroundColor: invert ? '#111' : '#fff' }}
      onContextMenu={(e) => {
        if (!onRequestMenu) return
        e.preventDefault()
        onRequestMenu(pageNumber, e.clientX, e.clientY)
      }}
      onClick={(e) => {
        if (!onPdfClick) return
        const b = e.currentTarget.getBoundingClientRect()
        const gx = (e.clientX - b.left) / scale
        const gy = (e.clientY - b.top) / scale
        onPdfClick(pageNumber, gx, (render.cssHeight / (scale || 1)) - gy, { x: e.clientX, y: e.clientY })
      }}
      onDoubleClick={(e) => {
        if (!onDblClickPdf) return
        const b = e.currentTarget.getBoundingClientRect()
        const gx = (e.clientX - b.left) / scale
        const gy = (e.clientY - b.top) / scale
        onDblClickPdf(pageNumber, gx, (render.cssHeight / (scale || 1)) - gy)
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" style={invert ? { filter: 'invert(1) hue-rotate(180deg)' } : undefined} aria-label={`Seite ${pageNumber}`} />
      <PageTextLayer doc={doc} pageNumber={pageNumber} viewport={render.viewport} />
      <InteractionOverlay viewport={render.viewport} activeTool={activeTool} onRect={onRect} onToolCancel={onToolCancel}>
        {showForm ? (
          <div
            className="absolute left-1/2 top-1/2"
            data-testid={`form-rot-layer-${pageNumber}`}
            style={{
              width: render.flatWidth,
              height: render.flatHeight,
              transform: `translate(-50%, -50%) rotate(${render.totalRotation}deg)`
            }}
          >
            <FormLayer
              fields={formFields}
              pageWidth={pageWidthPts}
              pageHeight={pageHeightPts}
              scale={scale}
              rotation={0}
              highlight={highlightFormFields}
              readOnly={formReadOnly}
              onCommit={onFieldCommit ?? (() => {})}
            />
          </div>
        ) : null}
      </InteractionOverlay>
      {render.status === 'rendering' ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/5 text-xs text-slate-600">…</div>
      ) : null}
    </div>
  )
}
