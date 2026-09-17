import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { PdfRect } from '@/lib/pdfCoords'
import { rectFromCorners, toPdfFromViewport, type ViewportSeam } from '@/lib/overlayMath'

// Die EINZELE geteilte Interaktions-Overlay-Schicht (Section 4). Signaturplatzierung, Redaction
// und die VLM-Auswahlbox (Step 9/10) nutzen genau diese Komponente — NIE einen PDF.js-internen
// Layer. Koordination laeuft ausschliesslich ueber die oeffentliche Naht viewport.convertToPdfPoint.
//
// Pointer-Events (Section 4): Root traegt pointer-events:none, solange kein Tool aktiv ist, damit
// die native Textauswahl der Textschicht darunter ungestoert bleibt. Ein aktives Tool schaltet auf
// auto + Crosshair; Esc bricht ab. Kinder (z.B. Griffe einer platzierten Signatur) behalten
// pointer-events:auto permanent und bleiben damit greifbar, auch ohne aktives Tool.

export type OverlayTool = 'none' | 'select-rect'

export interface InteractionOverlayProps {
  viewport: ViewportSeam | null
  activeTool: OverlayTool
  onRect?: ((rect: PdfRect) => void) | undefined
  onToolCancel?: (() => void) | undefined
  children?: ReactNode
}

export function InteractionOverlay({ viewport, activeTool, onRect, onToolCancel, children }: InteractionOverlayProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<[number, number] | null>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const active = activeTool !== 'none'

  // Esc bricht das aktive Tool ab (Section 4) und stellt den Auswahlmodus wieder her.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        startRef.current = null
        setDrag(null)
        onToolCancel?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onToolCancel])

  const localPoint = (e: ReactPointerEvent<HTMLDivElement>): [number, number] => {
    const box = rootRef.current?.getBoundingClientRect()
    return [e.clientX - (box?.left ?? 0), e.clientY - (box?.top ?? 0)]
  }

  const finish = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!startRef.current || !viewport) return
    const [x, y] = localPoint(e)
    const [sx, sy] = startRef.current
    startRef.current = null
    setDrag(null)
    const rect = rectFromCorners([sx, sy], [x, y], toPdfFromViewport(viewport))
    onRect?.(rect)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (activeTool !== 'select-rect' || !viewport) return
    // preventDefault: ohne Startet der Browser beim Ziehen eine native Text-Auswahl
    // bzw. ein HTML5-Drag und bricht unsere Geste mit pointercancel ab (R56 —
    // genau das machte 'Platzieren' nach Bild-Edit unbedienbar).
    e.preventDefault()
    const el = e.currentTarget
    if (typeof el.setPointerCapture === 'function') el.setPointerCapture(e.pointerId)
    const [x, y] = localPoint(e)
    startRef.current = [x, y]
    setDrag({ x0: x, y0: y, x1: x, y1: y })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!startRef.current) return
    const [x, y] = localPoint(e)
    setDrag((d) => (d ? { ...d, x1: x, y1: y } : d))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => { finish(e) }

  // pointercancel/lostpointercapture: Geste sauber abschliessen statt haengen
  // lassen — der Nutzer sieht sonst ein Feld, das 'nie entsteht'.
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>): void => { finish(e) }
  const onLostPointerCapture = (e: ReactPointerEvent<HTMLDivElement>): void => { finish(e) }

  const selStyle = drag
    ? {
        left: Math.min(drag.x0, drag.x1),
        top: Math.min(drag.y0, drag.y1),
        width: Math.abs(drag.x1 - drag.x0),
        height: Math.abs(drag.y1 - drag.y0)
      }
    : null

  return (
    <div
      ref={rootRef}
      data-tool={activeTool}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      className="absolute inset-0 select-none"
      style={{ pointerEvents: active ? 'auto' : 'none', cursor: active ? 'crosshair' : 'default', touchAction: 'none' }}
    >
      {selStyle ? (
        <div className="pointer-events-none absolute border-2 border-sky-400 bg-sky-400/15" style={selStyle} aria-hidden />
      ) : null}
      {/* Kinder (Griffe etc.) behalten pointer-events:auto permanent. */}
      <div style={{ pointerEvents: 'auto' }}>{children}</div>
    </div>
  )
}
