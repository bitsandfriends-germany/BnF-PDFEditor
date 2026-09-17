import { useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { RotateCcw, RotateCw, RefreshCw, Copy, Trash2, CheckSquare, X, Scissors, FileOutput, PlusSquare, Hash, Droplets, Stamp, ImagePlus, Image, Layers, MoreHorizontal } from 'lucide-react'
import { useT, getLang } from '@/i18n'
import { SHORTCUTS, formatShortcut } from '@/lib/shortcuts'
import { commandTooltipKey } from '@/lib/tooltips'
import { Tooltip } from '@/components/Tooltip'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { COMMANDS, TOOLBAR_GROUPS, type CommandContext, type CommandDef, type ToolbarGroup } from '@/lib/commands'
import { toolbarLayout, overflowMenuModel } from '@/lib/toolbarOverflow'
import { ContextMenu } from '@/components/ContextMenu'

// Pages-Werkzeugleiste: wird AUS DER COMMAND-REGISTRY gerendert (§7.6 — keine eigene Aktion-Kopie).
// §5: Gruppen in fester Reihenfolge mit Separator; Gruppen brechen NIE intern um und die Zeile
// bricht NIE um — passt eine Gruppe nicht mehr, zieht sie vollständig in den Überlauf-Knopf (⋯),
// der dasselbe getestete Menü (ContextMenu) nutzt. Zerstörerisches (Löschen) mit Abstand; Tooltip
// = labelKey. Read-only/Lock deaktiviert sichtbar (gültige, gerade nicht ausführbare Aktion).

const ICONS: Record<string, LucideIcon> = { RotateCcw, RotateCw, RefreshCw, Copy, Trash2, CheckSquare, X, Scissors, FileOutput, PlusSquare, Hash, Droplets, Stamp, ImagePlus, Image, Layers, MoreHorizontal }

function activeByGroup(ctx: CommandContext): Map<ToolbarGroup, CommandDef[]> {
  const m = new Map<ToolbarGroup, CommandDef[]>()
  for (const g of TOOLBAR_GROUPS) {
    const items = COMMANDS.filter((c) => c.group === g && isRenderable(c, ctx)).sort((a, b) => a.order - b.order)
    m.set(g, items)
  }
  return m
}

export function PagesToolbar(): JSX.Element {
  const t = useT()
  // §5: Tooltip nennt Aktion + Shortcut (einzige Quelle: Registry-Eintrag + SHORTCUTS-Tabelle).
  const modName = getLang() === 'de' ? 'Strg' : 'Ctrl'
  const shiftName = getLang() === 'de' ? 'Umschalt' : 'Shift'
  // R75: Label + Kurzbeschreibung ("was macht das") + Shortcut.
  const tipFor = (c: CommandDef): string => {
    const s = c.shortcutId !== undefined ? SHORTCUTS.find((x) => x.id === c.shortcutId) : undefined
    const desc = t(commandTooltipKey(c.id))
    const shortcut = s === undefined ? '' : ` (${formatShortcut(s, modName, shiftName)})`
    return desc === commandTooltipKey(c.id) ? `${t(c.labelKey)}${shortcut}` : `${desc}${shortcut}`
  }
  const docOpen = useAppStore((s) => s.docOpen)
  const readOnly = useAppStore((s) => s.readOnly)
  const mutationLock = useAppStore((s) => s.mutationLock)
  const pageCount = useAppStore((s) => s.pageCount)
  const currentPage = useAppStore((s) => s.currentPage)
  const selected = useUiStore((s) => s.selected)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [anchor, setAnchor] = useState({ x: 0, y: 0 })
  const moreRef = useRef<HTMLButtonElement>(null)

  const ctx: CommandContext = { docOpen, readOnly, mutationLock, currentPage, pageCount, selected, textSelected: false, stamping: false }
  const groups = activeByGroup(ctx)

  // Breite des Zeilencontainers; ohne ResizeObserver (jsdom/alt) alles inline — der flex-Zeilen-
  // Container bricht wegen flex-nowrap trotzdem nie um.
  const barRef = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState(Number.POSITIVE_INFINITY)
  useEffect(() => {
    const el = barRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setAvail(e.contentRect.width)
    })
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [])

  const layout = toolbarLayout(groups, avail)
  const btn = 'rounded-md p-1.5 text-slate-600 hover:bg-slate-200 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500'
  const renderBtn = (c: CommandDef): JSX.Element => {
    const Icon = ICONS[c.icon]
    return (
      <span key={c.id} className="inline-flex items-center">
        {c.destructive ? <span className="w-2" aria-hidden="true" /> : null}
        {/* R75: Hover-Tooltip nennt WAS die Funktion tut (Registry-Text + Shortcut). */}
        <Tooltip text={tipFor(c)} testid={`tip-${c.testid}`}>
          <button
            type="button"
            className={`${btn}${c.destructive ? ' text-red-600' : ''}`}
            aria-label={t(c.labelKey)}
            data-testid={c.testid}
            disabled={!c.isEnabled(ctx)}
            onClick={() => c.run(ctx)}
          >
            {Icon ? <Icon size={16} /> : null}
          </button>
        </Tooltip>
      </span>
    )
  }

  const overflowModel = overflowMenuModel(layout.overflow, (g) => groups.get(g) ?? [])
  const overflowCount = overflowModel.primary.length + overflowModel.destructive.length

  return (
    <div ref={barRef} className="flex flex-nowrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1.5" data-testid="pages-toolbar">
      <span className="mr-1 shrink-0 text-xs font-medium text-slate-500" data-testid="pages-count">
        {selected.length > 0 ? t('pages.selected', { count: selected.length }) : t('pages.title')}
      </span>
      {layout.inline.map((group, gi) => {
        const items = groups.get(group) ?? []
        if (items.length === 0) return null
        return (
          <span key={group} className="flex shrink-0 items-center gap-1">
            {gi > 0 ? <span className="mx-1 h-5 w-px bg-slate-200" /> : null}
            {items.map(renderBtn)}
          </span>
        )
      })}
      {overflowCount > 0 ? (
        <button
          ref={moreRef}
          type="button"
          className={`${btn} ml-auto shrink-0`}
          title={t('pages.more')}
          aria-label={t('pages.more')}
          aria-haspopup="menu"
          aria-expanded={overflowOpen}
          data-testid="pages-more"
          onClick={() => {
            const r = moreRef.current?.getBoundingClientRect()
            setAnchor({ x: r?.left ?? 0, y: r?.bottom ?? 0 })
            setOverflowOpen(true)
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      ) : null}
      {overflowOpen && overflowCount > 0 ? (
        <ContextMenu target="thumbnail" ctx={ctx} x={anchor.x} y={anchor.y} scopeLabel="" header="" menu={overflowModel} onClose={() => setOverflowOpen(false)} />
      ) : null}
    </div>
  )
}

function isRenderable(c: CommandDef, ctx: CommandContext): boolean {
  // Kontrollen mit dokumentbezogener Grundlage zeigen, wenn ein Dokument offen ist; reine
  // Auswahl-Aktionen zeigen nur mit Auswahl. Tote Kontrollen (nie ausführbar) zeigen nicht.
  if (c.id === 'pg.clear') return ctx.selected.length > 0
  return ctx.docOpen
}
