import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useT } from '@/i18n'
import { Tooltip } from '@/components/Tooltip'
import { commandTooltipKey } from '@/lib/tooltips'
import { contextMenuFor, type CommandContext, type CommandDef, type CommandGroupDef, type ContextTarget } from '@/lib/commands'
import { SHORTCUTS, formatShortcut } from '@/lib/shortcuts'

// PART 3 §6 — Rechtsklick-Kontextmenü, gerendert AUS DER COMMAND-REGISTRY (contextMenuFor).
// Regeln: nicht zutreffende Einträge WEGGLASSEN (nicht ausgegraut); Shortcut rechtsbündig;
// zerstörerische unten nach Separator; Tastatur: Pfeile navigieren, Enter wählt, Esc schließt;
// Menü-Header nennt den Scope explizit. onRun erlaubt das Testen der Auswahl ohne Store-Aufruf.

function shortcutLabel(c: CommandDef): string {
  if (c.shortcutId === undefined) return ''
  const s = SHORTCUTS.find((x) => x.id === c.shortcutId)
  return s ? formatShortcut(s, 'Strg', 'Umschalt') : ''
}

export interface ContextMenuModelLike {
  primary: CommandDef[]
  destructive: CommandDef[]
  groups?: CommandGroupDef[]
}

export interface ContextMenuProps {
  target: ContextTarget
  ctx: CommandContext
  x: number
  y: number
  scopeLabel: string
  onClose: () => void
  onRun?: (c: CommandDef) => void
  /** Vorgebautes Modell (z. B. Toolbar-Überlauf): ersetzt die Scope-Berechnung, Regeln bleiben. */
  menu?: ContextMenuModelLike
  /** Kopfzeile; '' unterdrückt den Header (der Überlauf hat keinen Scope). */
  header?: string
}

export function ContextMenu({ target, ctx, x, y, scopeLabel, onClose, onRun, menu, header }: ContextMenuProps): JSX.Element | null {
  const t = useT()

  // R75: Kurzbeschreibung des Befehls als Hover-Hinweis (Menues: nativer title, wird von der
  // Einstellung 'Tooltips' mitgeschaltet).
  const menuTip = (c: CommandDef): string => t(commandTooltipKey(c.id))

  // R75: Gruppen-Knopf (Untermenue) erklaeren — Label aus der Registry + Hinweis "Untermenue".
  const groupTip = (g: CommandGroupDef): string => `${t(g.labelKey)} – ${t('menu.submenuHint')}`
  const model = menu ?? contextMenuFor(target, ctx)
  const head = header ?? scopeLabel
  const groups: CommandGroupDef[] = menu === undefined ? (model.groups ?? []) : []
  const flat: CommandDef[] = [...model.primary, ...model.destructive]
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [activeSub, setActiveSub] = useState(0)
  // R56/57: Flyout wird VIEWPORT-fixed gerendert — innerhalb des Menues wurde es
  // abgeschnitten (Scrollbalken + 'keine zweite Ebene'). Position: am Gruppenknopf,
  // nach links kippend und oben/unten geklemmt, damit es immer ganz sichtbar ist.
  const [flyPos, setFlyPos] = useState<{ left: number; top: number } | null>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<{ right: number; left: number; top: number } | null>(null)
  // Klick/Hover auf Gruppe oeffnet; ein erneuter Klick schliesst NICHT (Hover+Klick
  // ware sonst ein Selbst-Toggle und das Flyout waere nach einer Mausaktion weg).
  const openGroupAt = (id: string, el: HTMLElement | null): void => {
    if (openGroup === id) return
    const r = el?.getBoundingClientRect()
    anchorRef.current = r ? { right: r.right, left: r.left, top: r.top } : null
    setFlyPos(r ? { left: r.right + 4, top: Math.max(8, Math.min(r.top, window.innerHeight - 300)) } : { left: 8, top: 8 })
    setOpenGroup(id)
    setActiveSub(0)
  }
  useLayoutEffect(() => {
    if (openGroup === null) return
    const el = subRef.current
    const a = anchorRef.current
    if (!el || !a) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = a.right + 4
    if (left + w > window.innerWidth - 8) left = Math.max(8, a.left - w - 4)
    const top = Math.max(8, Math.min(a.top, window.innerHeight - h - 8))
    setFlyPos((p) => (p !== null && p.left === left && p.top === top ? p : { left, top }))
  }, [openGroup])

  useEffect(() => {
    ref.current?.focus()
  }, [])

  if (flat.length === 0) return null

  const runOne = onRun ?? ((c: CommandDef): void => { c.run(ctx) })
  const pick = (c: CommandDef): void => {
    runOne(c)
    onClose()
  }
  const openItems = groups.find((g) => g.id === openGroup)?.items ?? []
  const onKey = (e: React.KeyboardEvent): void => {
    if (openGroup !== null && openItems.length > 0) {
      // Untermenue aktiv: Pfeile navigieren darin, Rechts bleibt, Links/Esc schliesst es.
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSub((a) => (a + 1) % openItems.length) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSub((a) => (a - 1 + openItems.length) % openItems.length) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setOpenGroup(null) }
      else if (e.key === 'Enter') { e.preventDefault(); const c = openItems[activeSub]; if (c) pick(c) }
      else if (e.key === 'Escape') { e.preventDefault(); setOpenGroup(null) }
      return
    }
    const count = flat.length + groups.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % count)
      setOpenGroup(null)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + count) % count)
      setOpenGroup(null)
    } else if (e.key === 'ArrowRight' && active >= flat.length) {
      e.preventDefault()
      const g = groups[active - flat.length]
      if (g) { const btn = ref.current?.querySelector(`[data-testid="ctx-group-${g.id}"]`) as HTMLElement | null; openGroupAt(g.id, btn) }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active < flat.length) { const c = flat[active]; if (c) pick(c) }
      else { const g = groups[active - flat.length]; if (g) { const btn = ref.current?.querySelector(`[data-testid="ctx-group-${g.id}"]`) as HTMLElement | null; openGroupAt(g.id, btn) } }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // Viewport-Clamping: ein Menue, dessen destruktiver Unterbau ueber die Unterkante quillt,
  // waere fuer die Maus unerreichbar (E2E-Fund redactSelection: 'element is outside of the
  // viewport'). Nach Mount gegen die reale Groesse schieben.
  const [pos, setPos] = useState({ left: x, top: y })
  useEffect(() => { setPos({ left: x, top: y }) }, [x, y])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth; const h = el.offsetHeight
    const left = Math.max(8, Math.min(x, window.innerWidth - w - 8))
    const top = Math.max(8, Math.min(y, window.innerHeight - h - 8))
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }))
  }, [x, y])

  const itemCls = 'flex w-full items-center gap-4 px-3 py-1.5 text-left text-sm hover:bg-slate-100 focus:bg-slate-100 dark:hover:bg-slate-700'
  const renderItem = (c: CommandDef): JSX.Element => {
    const sc = shortcutLabel(c)
    return (
      <Tooltip key={c.id} variant="native" text={menuTip(c)} className="w-full">
        <button role="menuitem" type="button" data-testid={`ctx-${c.testid}`} className={`${itemCls}${c.destructive ? ' text-red-600' : ''}`} onClick={() => pick(c)}>
          <span>{t(c.labelKey)}</span>
          {sc ? <span className="ml-auto text-xs text-slate-400" data-testid={`ctx-shortcut-${c.testid}`}>{sc}</span> : null}
        </button>
      </Tooltip>
    )
  }

  return (
    <>
      {/* Outside-Click fängt das Schließen ab (echtes Kontextmenü-Verhalten). */}
      <div data-testid="ctx-backdrop" className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        data-testid="context-menu"
        onKeyDown={onKey}
        style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 60 }}
        className="min-w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      >
        {head !== '' ? <div className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-400" data-testid="ctx-scope">{head}</div> : null}
        {model.primary.map(renderItem)}
        {groups.length > 0 ? <div role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" /> : null}
        {groups.map((g, gi) => (
          <div key={g.id} className="relative" onMouseEnter={() => { setOpenGroup(g.id); setActiveSub(0) }}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openGroup === g.id}
              data-testid={`ctx-group-${g.id}`}
              title={groupTip(g)}
              className={`${itemCls} ${active === flat.length + gi ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
              onClick={(e) => openGroupAt(g.id, e.currentTarget)}
              onMouseEnter={(e) => { setActive(flat.length + gi); if (openGroup !== g.id) openGroupAt(g.id, e.currentTarget) }}
            >
              <span>{t(g.labelKey)}</span>
              <ChevronRight size={14} className="ml-auto text-slate-400" />
            </button>
            {openGroup === g.id && flyPos !== null ? (
              <div ref={subRef} role="menu" data-testid={`ctx-submenu-${g.id}`} className="fixed z-[70] min-w-52 rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800" style={{ left: flyPos.left, top: flyPos.top }}>
                {g.items.map((c, ci) => (
                  <Tooltip key={c.id} variant="native" text={menuTip(c)} className="w-full">
                  <button role="menuitem" type="button" data-testid={`ctx-${c.testid}`}
                    className={`${itemCls}${c.destructive ? ' text-red-600' : ''}${activeSub === ci ? ' bg-slate-100 dark:bg-slate-700' : ''}`}
                    onMouseEnter={() => setActiveSub(ci)}
                    onClick={() => pick(c)}>
                    <span>{t(c.labelKey)}</span>
                    {shortcutLabel(c) !== '' ? <span className="ml-auto text-xs text-slate-400" data-testid={`ctx-shortcut-${c.testid}`}>{shortcutLabel(c)}</span> : null}
                  </button>
                  </Tooltip>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {model.destructive.length > 0 ? <div role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" data-testid="ctx-destructive-separator" /> : null}
        {model.destructive.map(renderItem)}
      </div>
    </>
  )
}
