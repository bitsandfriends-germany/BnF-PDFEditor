import { useEffect, useRef, useState } from 'react'
import { ShieldCheck, Trash2 } from 'lucide-react'
import { useT } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'
import { screenDeltaToRotated } from '@/lib/overlayMath'

// Frei positionierbares Signaturfeld VOR dem Signieren. R60-Verhalten wie die
// Bildobjekte: Rahmen zum Verschieben, 4 Eckgriffe zum Skalieren, Loeschen-
// Knopf mit Papierkorb-Icon + Text. WICHTIG (Nutzerbefund R59/60 'nicht
// movable'): Drag laeuft ueber WINDOW-Listener, nicht ueber Pointer-Capture —
// Capture schlug in der gebauten App fehl bzw. der Zeiger verliess das kleine
// Feld und der Drag starb. Erst der Signierklick macht das Feld fest.

export function SigFieldOverlay(props: { page: number; scale: number; pageH: number; rotation?: number }): JSX.Element | null {
  const t = useT()
  const sigField = useUiStore((s) => s.sigField)
  const moveSigField = useUiStore((s) => s.moveSigField)
  const clearSigField = useUiStore((s) => s.clearSigField)
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; corner?: string | undefined; w?: number | undefined; h?: number | undefined } | null>(null)
  const [dragging, setDragging] = useState(false)

  // Window-Listener leben am Fiber (useEffect): waehrend eines Drags werden
  // move/up UNABHAENGIG vom Ziel-Element empfangen — der Zeiger darf das Feld
  // verlassen, der Drag laeuft trotzdem weiter bis 'up'.
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const d = drag.current
      if (!d) return
      e.preventDefault()
      // R70: Bei gedrehter Ansicht erst das Bildschirm-Delta in die Achsen der gedrehten
      // Overlay-Huelle drehen — sonst laeuft das Feld beim Ziehen in die falsche Richtung.
      const rot = screenDeltaToRotated(e.clientX - d.sx, e.clientY - d.sy, props.rotation ?? 0)
      const dx = rot.dx / props.scale
      const dy = rot.dy / props.scale
      if (!d.corner || d.w === undefined || d.h === undefined) {
        const cur = useUiStore.getState().sigField
        if (!cur) return
        moveSigField(props.page, { x: Math.max(0, d.ox + dx), y: Math.max(0, d.oy - dy), width: cur.rect.width, height: cur.rect.height })
        return
      }
      let w = d.w
      let h = d.h
      let x = d.ox
      let y = d.oy
      if (d.corner.includes('e')) w = Math.max(60, d.w + dx)
      if (d.corner.includes('w')) { w = Math.max(60, d.w - dx); x = d.ox + (d.w - w) }
      // 'n'/'s' = Bildschirmkanten; PDF-y zeigt nach oben.
      if (d.corner.includes('n')) h = Math.max(28, d.h - dy)
      if (d.corner.includes('s')) { h = Math.max(28, d.h + dy); y = d.oy - (h - d.h) }
      moveSigField(props.page, { x: Math.max(0, x), y: Math.max(0, y), width: w, height: h })
    }
    const onUp = (): void => {
      if (drag.current !== null) { drag.current = null; setDragging(false) }
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [props.page, props.scale, moveSigField])

  if (!sigField || sigField.page !== props.page) return null
  const { rect } = sigField
  const { scale, pageH } = props

  const begin = (e: React.PointerEvent, corner?: string): void => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    e.stopPropagation()
    drag.current = { sx: e.clientX, sy: e.clientY, ox: rect.x, oy: rect.y, corner, w: corner ? rect.width : undefined, h: corner ? rect.height : undefined }
    setDragging(true)
  }

  // Bewaffneter Zustand (arm): Der Platzierungs-Overlay liegt bewusst AUSERHALB
  // (Default-Rect 4000,4000) und darf Zeiger nicht fangen — sonst klaut er genau
  // die Geste, mit der der Nutzer das Feld setzen will (R56/58 Root-Cause #2).
  if (sigField.arm) return null

  return (
    <div
      data-testid={`sigfield-${props.page}`}
      className={`absolute z-10 border-2 border-dashed border-emerald-600/80 bg-emerald-50/50 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{
        left: rect.x * scale,
        top: (pageH - rect.y - rect.height) * scale,
        width: rect.width * scale,
        height: rect.height * scale,
        touchAction: 'none',
      }}
      onPointerDown={(e) => begin(e)}
    >
      <div className="flex h-full min-h-0 flex-col justify-center gap-0.5 overflow-hidden px-2 text-[9px] leading-tight text-emerald-900/90 select-none">
        <span className="flex items-center gap-1 font-semibold"><ShieldCheck size={14} className="shrink-0" /> {t('sigfield.previewTitle')}</span>
        <span className="truncate opacity-75">{t('sigfield.previewBody')}</span>
      </div>
      {/* Werkzeugleiste WIE die Bildobjekte (Nutzer R60): Papierkorb + Text.
          Innerhalb des Rahmens, damit nichts abgeschnitten wird. */}
      <div
        className="absolute -top-7 right-0 flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-1 shadow dark:border-slate-600 dark:bg-slate-800"
        data-testid="sigfield-toolbar"
      >
        <button
          type="button"
          data-testid="sigfield-remove"
          title={t('sigfield.remove')}
          aria-label={t('sigfield.remove')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => clearSigField()}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-slate-700"
        >
          <Trash2 size={13} /> {t('sigfield.remove')}
        </button>
      </div>
      <span className="absolute bottom-0.5 right-1 text-[8px] text-emerald-800/70 select-none">{t('sigfield.dragHint')}</span>
      {(['nw','ne','sw','se'] as const).map((corner) => (
        <span
          key={corner}
          data-testid={`sigfield-resize-${corner}`}
          title={t('sigfield.resize')}
          onPointerDown={(e) => begin(e, corner)}
          className={`absolute h-2.5 w-2.5 rounded-sm border border-emerald-700 bg-white ${corner.includes('n') ? '-top-1.5' : '-bottom-1.5'} ${corner.includes('w') ? '-left-1.5' : '-right-1.5'} ${corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'}`}
          style={{ touchAction: 'none' }}
        />
      ))}
    </div>
  )
}
