import { useCallback, useEffect, useState } from 'react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { getOutline, type OutlineItem } from '@/lib/documents'

// Outline-/Lesezeichen-Panel (Section 5): zeigt die bestehende Gliederung, Klick navigiert.
// Read-only in V1; Ebenen werden ueber Einzug dargestellt.

export function OutlinePanel(): JSX.Element {
  const t = useT()
  const docOpen = useAppStore((s) => s.docOpen)
  const docVersion = useAppStore((s) => s.docVersion)
  const setCurrentPage = useAppStore((s) => s.setCurrentPage)
  const [items, setItems] = useState<OutlineItem[]>([])

  const reload = useCallback(async (): Promise<void> => {
    if (!docOpen) {
      setItems([])
      return
    }
    try {
      setItems(await getOutline())
    } catch {
      setItems([])
    }
  }, [docOpen])

  useEffect(() => {
    void reload()
  }, [reload, docVersion])

  if (items.length === 0) {
    return <p className="p-3 text-sm text-slate-500">{t('outline.empty')}</p>
  }

  const baseLevel = items[0]?.level ?? 1

  return (
    <nav className="p-2 text-sm" aria-label={t('sidebar.tab.outline')}>
      <p className="px-1 pb-1 text-xs text-slate-500">{t('outline.hint')}</p>
      <ul>
        {items.map((it, i) => (
          <li key={i}>
            <button
              type="button"
              data-testid={`outline-item-${i}`}
              onClick={() => setCurrentPage(it.page)}
              className="block w-full truncate rounded px-1.5 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
              style={{ paddingLeft: `${Math.max(0, it.level - baseLevel) * 14 + 6}px` }}
              title={it.title}
            >
              {it.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
