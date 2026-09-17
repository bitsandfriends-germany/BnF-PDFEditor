import { useState } from 'react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore, selectionExpr } from '@/store/useUiStore'
import { stampText } from '@/lib/documents'

// Freie Textstempel-Platzierung (Section 7): Dialog ueber dem per Overlay gezogenen Rechteck.
// Der Anker ist die linke-untere Ecke des Rechtecks (PDF-User-Space). Platzhalter ({page},
// {pages}, {filename}, {date}, {time}, {user}) werden zur Anwendungszeit im Backend geloest.

const input = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500'

type Scope = 'page' | 'selection' | 'all'

export function StampTextDialog(): JSX.Element | null {
  const t = useT()
  const target = useUiStore((s) => s.stampTarget)
  const cancel = useUiStore((s) => s.cancelStamp)
  const currentPage = useAppStore((s) => s.currentPage)
  const selected = useUiStore((s) => s.selected)
  const [text, setText] = useState('')
  const [scope, setScope] = useState<Scope>('page')
  const [fontsize, setFontsize] = useState(18)
  const [color, setColor] = useState('#c00000')
  const [opacity, setOpacity] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [busy, setBusy] = useState(false)

  if (!target || target.kind !== 'text') return null

  const exprFor = (sc: Scope): string =>
    sc === 'all' ? 'all' : sc === 'selection' ? (selected.length > 0 ? selectionExpr(selected) : String(currentPage)) : String(currentPage)

  const can = text.trim().length > 0 && !busy

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t('stamp.text')} onClick={cancel}>
      <div className="w-[26rem] rounded-lg bg-white p-4 shadow-xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-base font-semibold">{t('stamp.text')}</h2>
        <p className="mb-3 text-xs text-slate-500">{t('stamp.placeholders')}</p>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">{t('stamp.text')}</span>
          <input className={input} data-testid="stamp-text" value={text} autoFocus onChange={(e) => setText(e.target.value)} />
        </label>

        <div className="mb-3 flex gap-3 text-sm">
          {(['page', 'selection', 'all'] as Scope[]).map((sc) => (
            <label key={sc} className="flex items-center gap-1">
              <input type="radio" name="stamp-scope" data-testid={`stamp-scope-${sc}`} checked={scope === sc} onChange={() => setScope(sc)} />
              {t('stamp.scope.' + sc)}
            </label>
          ))}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('stamp.size')}</span>
            <input type="number" className={input} data-testid="stamp-size" value={fontsize} min={1} onChange={(e) => setFontsize(Number(e.target.value))} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('stamp.color')}</span>
            <input type="color" className="h-9 w-full rounded border border-slate-300" data-testid="stamp-color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('stamp.opacity')}</span>
            <input type="number" className={input} data-testid="stamp-opacity" value={opacity} min={0} max={1} step={0.05} onChange={(e) => setOpacity(Number(e.target.value))} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('stamp.rotation')}</span>
            <input type="number" className={input} data-testid="stamp-rotation" value={rotation} step={90} onChange={(e) => setRotation(Number(e.target.value))} />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" data-testid="stamp-cancel" onClick={cancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!can}
            data-testid="stamp-run"
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40"
            onClick={async () => {
              if (!text.trim()) return
              setBusy(true)
              try {
                await stampText({ expr: exprFor(scope), x: target.x, y: target.y, text, fontsize, color, opacity, rotation, overlay: true })
                cancel()
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('common.apply')}
          </button>
        </div>
      </div>
    </div>
  )
}
