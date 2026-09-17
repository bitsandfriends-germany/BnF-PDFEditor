import { useEffect, useRef } from 'react'
import { useT } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'

// Schliessen bei ungespeicherten Aenderungen (Section 4): DREI Optionen — Speichern, Verwerfen,
// Abbrechen. Bewusst kein 2-Button-Dialog. Die Wahl liefert requestClose() an closeDocument().

export function CloseDialog(): JSX.Element | null {
  const t = useT()
  const pending = useUiStore((s) => s.pendingClose !== null)
  const resolve = useUiStore((s) => s.resolveClose)
  const saveRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (pending) saveRef.current?.focus()
  }, [pending])

  if (!pending) return null

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40" role="dialog" aria-modal="true" aria-label={t('close.title')}>
      <div className="w-[26rem] rounded-lg bg-white p-4 shadow-xl">
        <h2 className="mb-2 text-base font-semibold">{t('close.title')}</h2>
        <p className="mb-4 text-sm text-slate-600">{t('close.body')}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => resolve('cancel')} data-testid="close-cancel" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
            {t('close.cancel')}
          </button>
          <button type="button" onClick={() => resolve('discard')} data-testid="close-discard" className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
            {t('close.discard')}
          </button>
          <button ref={saveRef} type="button" onClick={() => resolve('save')} data-testid="close-save" className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700">
            {t('close.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
