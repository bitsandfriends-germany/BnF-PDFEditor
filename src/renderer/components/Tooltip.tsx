import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useUiStore } from '@/store/useUiStore'

// R75 Nutzerwunsch: "gib den einstellungen und ALLEN Funktionen on Hover Tooltips was die
// Funktion macht. Auch in den Settings an- und ausschaltbar."
//
// Zwei im Browser gemessene Fallen bestimmen die Umsetzung:
//  1. Ein Wrapper-Element (span) verschiebt Toolbar-Layouts und aendert den DOM-Baum — die
//     bestehenden Struktur-Tests schlugen fehl. Deshalb werden die Ereignis-Handler per
//     cloneElement DIREKT auf das Kind gelegt (kein zusaetzliches Element).
//  2. Die Hinweisbox liegt `position: fixed` (aus dem Rechteck des Kindes berechnet), damit sie
//     nicht vom Elternteil abgeschnitten wird oder das Layout schiebt.
const DELAY_MS = 300

export function Tooltip(props: {
  /** Fertig uebersetzter Hilfetext; leer = kein Tooltip. */
  text: string
  children: ReactNode
  side?: 'top' | 'bottom'
  testid?: string
  className?: string
  /**
   * 'box' (Default) = eigene Ueberlagerung direkt am Element (DOM-strukturneutral).
   * 'native'        = title-Attribut (fuer Menues/Flyouts, in denen eine Box abgeschnitten wuerde).
   * Beide respektieren die Einstellung 'tooltips'.
   */
  variant?: 'box' | 'native'
}): JSX.Element {
  const enabled = useUiStore((s) => s.tooltips)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchor = useRef<HTMLElement>(null)
  const id = useRef(`tip-${Math.random().toString(36).slice(2, 9)}`)

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])

  const child = Children.count(props.children) === 1 && isValidElement(props.children) ? props.children : null
  const off = !enabled || props.text.trim() === ''

  if (off) return <>{props.children}</>
  if (props.variant === 'native' || child === null) {
    return (
      <span title={props.text} className={props.className ?? ''}>
        {props.children}
      </span>
    )
  }

  const show = (): void => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const el = anchor.current
      if (el === null) return
      const r = el.getBoundingClientRect()
      const above = props.side !== 'bottom'
      setPos({ left: Math.min(Math.max(r.left + r.width / 2, 8), window.innerWidth - 8), top: above ? r.top - 6 : r.bottom + 6 })
    }, DELAY_MS)
  }
  const hide = (): void => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    setPos(null)
  }

  const cloned = cloneElement(child as ReactElement<Record<string, unknown>>, {
    ref: anchor,
    // mouseover/mouseout statt enter/leave: diese Events bubbeln zuverlaessig vom Kind aus.
    onMouseOver: show,
    onMouseOut: hide,
    onFocusCapture: show,
    onBlurCapture: hide,
    ...(pos !== null ? { 'aria-describedby': id.current } : {})
  })

  return (
    <>
      {cloned}
      {pos !== null ? (
        <span
          role="tooltip"
          id={id.current}
          data-testid={props.testid ?? 'tooltip'}
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            transform: props.side === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)'
          }}
          className="pointer-events-none z-50 w-max max-w-xs rounded bg-slate-900 px-2 py-1 text-center text-xs leading-snug text-white shadow-lg"
        >
          {props.text}
        </span>
      ) : null}
    </>
  )
}

/** Bequeme Variante fuer Elemente, die selbst schon einen Tooltip-Text liefern. */
export function tooltipText(maybe: string | undefined | null): string {
  return typeof maybe === 'string' ? maybe : ''
}
