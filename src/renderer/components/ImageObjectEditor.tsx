import { useRef, useState } from 'react'
import { useT } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'
import { updateImageObject, deleteImageObject } from '@/lib/documents'
import type { PdfRect } from '@/lib/pdfCoords'
import { screenDeltaToRotated } from '@/lib/overlayMath'

// Editier-Overlay für eingebettete Bildobjekte (Nutzerwunsch Runde 51): nach dem Einbetten
// per Doppelklick waehlbar — Ecken ziehen (skalieren), Rahmen ziehen (verschieben),
// Drehen um 90°, Loeschen. Alle Aktionen laufen durch die Backend-Objekt-OPs (undo-faehig).
type Drag = { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; sx: number; sy: number; start: PdfRect }

export function ImageObjectEditor(props: { page: number; scale: number; pageH: number; rotation?: number }): JSX.Element | null {
  const t = useT()
  const sel = useUiStore((s) => s.imageSel)
  const setImageSel = useUiStore((s) => s.setImageSel)
  const [rect, setRect] = useState<PdfRect | null>(null)
  const drag = useRef<Drag | null>(null)
  const [busy, setBusy] = useState(false)
  if (!sel || sel.page !== props.page) return null
  const r = rect ?? sel.rect
  const { scale, pageH } = props
  const px = { left: r.x * scale, top: (pageH - r.y - r.height) * scale, width: r.width * scale, height: r.height * scale }

  const begin = (mode: Drag['mode']) => (e: React.PointerEvent): void => {
    e.preventDefault(); e.stopPropagation()
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: { ...r } }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    // R70: Bildschirm-Delta zuerst in die Achsen der gedrehten Overlay-Huelle drehen.
    const rot = screenDeltaToRotated(e.clientX - d.sx, e.clientY - d.sy, props.rotation ?? 0)
    const dx = rot.dx / scale
    const dy = -rot.dy / scale // Bildschirm-y runter == PDF-y runter
    const s = d.start
    let next: PdfRect
    if (d.mode === 'move') next = { ...s, x: s.x + dx, y: s.y + dy }
    else {
      let { x, y, width, height } = s
      if (d.mode.includes('w')) { width = s.width - dx; x = s.x + dx }
      if (d.mode.includes('e')) { width = s.width + dx }
      if (d.mode.includes('n')) { height = s.height + dy; y = s.y }
      if (d.mode.includes('s')) { height = s.height - dy; y = s.y + dy }
      if (width < 8 || height < 8) return
      next = { x, y, width, height }
    }
    setRect(next)
  }
  const commit = async (): Promise<void> => {
    const d = drag.current
    drag.current = null
    if (!d || !rect) return
    setBusy(true)
    const res = await updateImageObject(sel.page, sel.rect, rect)
    setBusy(false)
    if (res) { setRect(null); setImageSel({ ...sel, rect: res.rect, rotation: res.rotation }) }
    else setRect(null)
  }
  const rotate = async (): Promise<void> => {
    setBusy(true)
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2
    const swapped = { x: cx - r.height / 2, y: cy - r.width / 2, width: r.height, height: r.width }
    const res = await updateImageObject(sel.page, sel.rect, swapped, 90)
    setBusy(false)
    if (res) setImageSel({ ...sel, rect: res.rect, rotation: res.rotation })
  }
  const remove = async (): Promise<void> => {
    setBusy(true)
    const ok = await deleteImageObject(sel.page, sel.rect)
    setBusy(false)
    if (ok) { setImageSel(null); setRect(null) }
  }

  const handle = (mode: Drag['mode'], cls: string): JSX.Element => (
    <span
      key={mode}
      data-testid={`imgobj-${mode}`}
      onPointerDown={begin(mode)}
      onPointerMove={onMove}
      onPointerUp={() => void commit()}
      className={`absolute h-3 w-3 rounded-full border-2 border-sky-600 bg-white ${cls}`}
    />
  )

  return (
    <>
      <div
        data-testid={`imgobj-frame-${props.page}`}
        className="pointer-events-none absolute border-2 border-sky-600"
        style={px}
      >
        <span
          data-testid="imgobj-move"
          onPointerDown={begin('move')}
          onPointerMove={onMove}
          onPointerUp={() => void commit()}
          className="pointer-events-auto absolute inset-0 cursor-move"
        />
        {handle('nw', '-left-1.5 -top-1.5 cursor-nwse-resize')}
        {handle('ne', '-right-1.5 -top-1.5 cursor-nesw-resize')}
        {handle('sw', '-left-1.5 -bottom-1.5 cursor-nesw-resize')}
        {handle('se', '-right-1.5 -bottom-1.5 cursor-nwse-resize')}
      </div>
      <div data-testid="imgobj-bar" className="pointer-events-auto absolute z-20 flex gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-1 shadow-md dark:border-slate-600 dark:bg-slate-800"
        style={{ left: px.left, top: Math.max(0, px.top - 34) }}>
        <button type="button" data-testid="imgobj-rotate" disabled={busy} onClick={() => void rotate()} title={t('imgobj.rotate')} className="rounded px-2 py-0.5 text-xs hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-700">{t('imgobj.rotate')}</button>
        <button type="button" data-testid="imgobj-delete" disabled={busy} onClick={() => void remove()} title={t('imgobj.delete')} className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-slate-700">{t('imgobj.delete')}</button>
        <button type="button" data-testid="imgobj-close" onClick={() => { setImageSel(null); setRect(null) }} title={t('common.close')} className="rounded px-2 py-0.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-700">✕</button>
      </div>
    </>
  )
}
