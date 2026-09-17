import { useMemo, useRef, useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useT, getLang } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'
import { SHORTCUTS, formatShortcut, type ShortcutGroup } from '@/lib/shortcuts'

// Durchsuchbarer Tastatur-Referenz-Dialog (Section 5). Die Liste ist DIREKT die Bindungs-Tabelle
// (SHORTCUTS) — dadurch kann der Dialog niemals von den real gebundenen Tasten abweichen.

const GROUPS: ShortcutGroup[] = ['file', 'edit', 'view', 'app']

export function ShortcutReferenceModal(): JSX.Element | null {
  const t = useT()
  const open = useUiStore((s) => s.shortcutsOpen)
  const close = useUiStore((s) => s.closeShortcuts)
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      inputRef.current?.focus()
    }
  }, [open])

  const modName = getLang() === 'de' ? 'Strg' : 'Ctrl'
  const shiftName = getLang() === 'de' ? 'Umschalt' : 'Shift'

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return GROUPS.map((g) => ({
      g,
      items: SHORTCUTS.filter((s) => s.group === g).filter((s) => {
        if (!needle) return true
        const hay = `${t(s.labelKey)} ${formatShortcut(s, modName, shiftName)}`.toLowerCase()
        return hay.includes(needle)
      })
    })).filter((grp) => grp.items.length > 0)
  }, [q, t, modName, shiftName])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t('shortcuts.title')} onClick={close}>
      <div className="max-h-[80vh] w-[32rem] overflow-auto rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('shortcuts.title')}</h2>
          <button type="button" aria-label={t('common.close')} data-testid="sc-close" onClick={close} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>
        <input
          ref={inputRef}
          className="mb-3 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
          placeholder={t('shortcuts.search')}
          value={q}
          data-testid="sc-search"
          onChange={(e) => setQ(e.target.value)}
        />
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">{t('shortcuts.empty')}</p>
        ) : (
          <div className="space-y-3">
            {rows.map(({ g, items }) => (
              <section key={g}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t(`group.${g}`)}</h3>
                <ul className="divide-y divide-slate-100">
                  {items.map((s) => (
                    <li key={s.id} className="flex items-center justify-between py-1.5 text-sm">
                      <span>{t(s.labelKey)}</span>
                      <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-600">{formatShortcut(s, modName, shiftName)}</kbd>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
