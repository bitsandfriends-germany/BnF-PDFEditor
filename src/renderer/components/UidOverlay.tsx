import { useEffect, useState } from 'react'
import { useDebugStore } from '@/store/useDebugStore'

// Dev-only UID-Overlay: blendet über jedem Element mit data-testid (der UID) ein kleines,
// nicht anklickbares Label ein, damit der Nutzer die UID direkt in der GUI ablesen und dem
// Assistenten nennen kann. Wird ausschliesslich im Dev-Build montiert (AppShell gate't auf
// import.meta.env.DEV) und per debug.showUids im Debug-Panel ein-/ausgeschaltet.
//
// Design:
//  - Erfasst alle [data-testid]-Knoten inkl. Void-Elemente (input/img/...), positioniert über
//    getBoundingClientRect — kein ::after, deshalb funktionieren auch Elemente ohne Inhalt.
//  - Erfasst dynamische UID-Muster (thumb-item-${i}) automatisch, weil zur Laufzeit abgelesen.
//  - Der eigene Overlay-Container traegt data-uid-overlay und wird beim Scan ausgenommen.
//  - pointer-events:none → die App bleibt voll bedienbar.
//  - Alle Listener/Observer leben in diesem Effect und werden beim Ausschalten/Unmount entfernt.

interface Label {
  id: string
  x: number
  y: number
}

export function UidOverlay(): JSX.Element | null {
  const showUids = useDebugStore((s) => s.showUids)
  const [labels, setLabels] = useState<Label[]>([])

  useEffect(() => {
    if (!showUids) {
      setLabels([])
      return
    }
    let raf = 0
    const collect = (): void => {
      const out: Label[] = []
      const nodes = document.querySelectorAll<HTMLElement>('[data-testid]')
      nodes.forEach((n) => {
        if (n.closest('[data-uid-overlay]')) return
        const id = n.getAttribute('data-testid')
        if (!id) return
        const r = n.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return // ausgeblendete/leere Knoten ueberspringen
        out.push({ id, x: r.left, y: Math.max(0, r.top - 15) })
      })
      setLabels(out)
    }
    const schedule = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        collect()
      })
    }
    collect()
    const obs = new MutationObserver(schedule)
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-testid', 'class', 'style']
    })
    // scroll bubble't nicht → capture:true erwischt auch interne Scroll-Container (Canvas, Sidebar).
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    // Preisnetz: pdfjs-Zeichnung/Layout aendert Geometrie ohne DOM-Strukturwechsel.
    const iv = window.setInterval(schedule, 800)
    return () => {
      obs.disconnect()
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.clearInterval(iv)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [showUids])

  if (!showUids) return null

  return (
    <div
      data-uid-overlay=""
      aria-hidden
      style={{ position: 'fixed', inset: 0, zIndex: 2147483000, pointerEvents: 'none', overflow: 'hidden' }}
    >
      {labels.map((l, i) => (
        <span
          key={`${l.id}-${i}`}
          style={{
            position: 'absolute',
            left: l.x + 1,
            top: l.y,
            maxWidth: 260,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: '0 4px',
            borderRadius: 3,
            fontSize: 10,
            lineHeight: '14px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            background: 'rgba(180, 83, 9, 0.92)',
            color: '#fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.25)'
          }}
        >
          {l.id}
        </span>
      ))}
    </div>
  )
}
