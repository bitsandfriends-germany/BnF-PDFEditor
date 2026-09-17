import { useMemo, useState } from 'react'
import { useT } from '@/i18n'
import { useDebugStore, filterEntries, type LevelFilter, type SourceFilter } from '@/store/useDebugStore'
import { buildDebugDump } from '@/lib/dumpBuilder'
import { notifyError, notifySuccess } from '@/store/useAppStore'

const LEVELS: LevelFilter[] = ['all', 'error', 'warn', 'info', 'verbose', 'debug', 'silly']
const SOURCES: SourceFilter[] = ['all', 'main', 'renderer', 'backend']

export function DebugPanel(): JSX.Element | null {
  const t = useT()
  const open = useDebugStore((s) => s.open)
  const entries = useDebugStore((s) => s.entries)
  const level = useDebugStore((s) => s.level)
  const source = useDebugStore((s) => s.source)
  const focus = useDebugStore((s) => s.focusCorrelationId)
  const setLevel = useDebugStore((s) => s.setLevel)
  const setSource = useDebugStore((s) => s.setSource)
  const close = useDebugStore((s) => s.closePanel)
  const clearFocus = useDebugStore((s) => s.clearFocus)
  const showUids = useDebugStore((s) => s.showUids)
  const toggleUids = useDebugStore((s) => s.toggleUids)
  const [busy, setBusy] = useState(false)

  const shown = useMemo(() => filterEntries(entries, level, source, focus).slice(-200), [entries, level, source, focus])

  if (!open) return null

  const exportDump = async (): Promise<void> => {
    setBusy(true)
    try {
      const md = await buildDebugDump()
      const path = await window.pdfEditor.writeDebugDump(md)
      if (path) notifySuccess(t('debug.exported'))
    } catch (err) {
      notifyError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex max-h-72 flex-col border-t border-slate-300 bg-slate-900 text-slate-100" aria-label={t('debug.title')}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-3 py-1.5 text-xs">
        <span className="font-semibold">{t('debug.title')}</span>
        {focus ? (
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-200">
            {t('debug.focus', { id: focus })}
            <button data-testid="debug-clear-focus" type="button" onClick={clearFocus} className="ml-2 underline">{t('debug.clear')}</button>
          </span>
        ) : null}
        <label className="ml-auto flex items-center gap-1">
          {t('debug.level')}
          <select data-testid="debug-level" value={level} aria-label={t('debug.level')} onChange={(e) => setLevel(e.target.value as LevelFilter)} className="rounded bg-slate-800 px-1 py-0.5">
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">
          {t('debug.source')}
          <select data-testid="debug-source" value={source} aria-label={t('debug.source')} onChange={(e) => setSource(e.target.value as SourceFilter)} className="rounded bg-slate-800 px-1 py-0.5">
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {import.meta.env.DEV ? (
          <button data-testid="debug-show-uids" type="button" onClick={toggleUids} aria-pressed={showUids} className={`rounded px-2 py-1 hover:bg-slate-700 ${showUids ? 'bg-amber-600 text-white' : ''}`}>
            {t('debug.showUids')}
          </button>
        ) : null}
        <button data-testid="debug-dump" type="button" onClick={() => void exportDump()} disabled={busy} className="rounded bg-sky-600 px-2 py-1 hover:bg-sky-700 disabled:opacity-50">
          {busy ? t('common.busy') : t('debug.export')}
        </button>
        <button data-testid="debug-close" type="button" onClick={close} aria-label={t('debug.close')} className="rounded px-2 py-1 hover:bg-slate-700">✕</button>
      </div>
      <div className="flex-1 overflow-auto px-3 py-1 font-mono text-[11px] leading-relaxed" role="log" aria-live="off">
        {shown.length === 0 ? <p className="text-slate-500">{t('debug.empty')}</p> : null}
        {shown.map((e, i) => (
          <div key={`${e.ts}-${i}`} className={e.level === 'error' ? 'text-red-300' : e.level === 'warn' ? 'text-amber-300' : 'text-slate-200'}>
            <span className="text-slate-500">{e.ts}</span> [{e.source}/{e.level}] {e.action}{e.correlationId ? ` cid=${e.correlationId}` : ''}{e.error?.message ? ` — ${e.error.message}` : ''}
          </div>
        ))}
      </div>
    </section>
  )
}
