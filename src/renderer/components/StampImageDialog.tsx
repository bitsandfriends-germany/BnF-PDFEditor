import { useState } from 'react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore, selectionExpr } from '@/store/useUiStore'
import { stampImageSelection } from '@/lib/documents'

// Bildstempel / Bild-zu-Seite (Section 7): wendet das zuvor gewaehlte Bild auf das per Overlay
// gezogene Rechteck an. Seitenverhaeltnis bleibt standardmaessig erhalten (keepProportion=true);
// Transparenz bleibt erhalten (Backend/PNG). Umfang: aktuelle Seite / Auswahl / alle.

const input = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500'

type Scope = 'page' | 'selection' | 'all'

export function StampImageDialog(): JSX.Element | null {
  const t = useT()
  const target = useUiStore((s) => s.stampTarget)
  const image = useUiStore((s) => s.stampImage)
  const cancel = useUiStore((s) => s.cancelStamp)
  const currentPage = useAppStore((s) => s.currentPage)
  const selected = useUiStore((s) => s.selected)
  const [scope, setScope] = useState<Scope>('page')
  const [opacity, setOpacity] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [keepProportion, setKeepProportion] = useState(true)
  const [busy, setBusy] = useState(false)

  if (!target || target.kind !== 'image') return null

  const exprFor = (sc: Scope): string =>
    sc === 'all' ? 'all' : sc === 'selection' ? (selected.length > 0 ? selectionExpr(selected) : String(currentPage)) : String(currentPage)

  const can = !!image && !busy

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t('stamp.image')} onClick={cancel}>
      <div className="w-[26rem] rounded-lg bg-white p-4 shadow-xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-base font-semibold">{t('stamp.image')}</h2>
        <p className="mb-3 truncate text-xs text-slate-500" title={image?.name}>{image?.name ?? ''}</p>

        <div className="mb-3 flex gap-3 text-sm">
          {(['page', 'selection', 'all'] as Scope[]).map((sc) => (
            <label key={sc} className="flex items-center gap-1">
              <input type="radio" name="stampimg-scope" data-testid={`stampimg-scope-${sc}`} checked={scope === sc} onChange={() => setScope(sc)} />
              {t('stamp.scope.' + sc)}
            </label>
          ))}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('stamp.opacity')}</span>
            <input type="number" className={input} data-testid="stampimg-opacity" value={opacity} min={0} max={1} step={0.05} onChange={(e) => setOpacity(Number(e.target.value))} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('stamp.rotation')}</span>
            <input type="number" className={input} data-testid="stampimg-rotation" value={rotation} step={90} onChange={(e) => setRotation(Number(e.target.value))} />
          </label>
        </div>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" data-testid="stampimg-keep" checked={keepProportion} onChange={(e) => setKeepProportion(e.target.checked)} /> {t('stamp.keepAspect')}
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" data-testid="stampimg-cancel" onClick={cancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!can}
            data-testid="stampimg-run"
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40"
            onClick={async () => {
              if (!image) return
              setBusy(true)
              try {
                await stampImageSelection(exprFor(scope), { x: target.x, y: target.y, width: target.width, height: target.height }, image.b64, { opacity, rotation, overlay: true, keepProportion })
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
