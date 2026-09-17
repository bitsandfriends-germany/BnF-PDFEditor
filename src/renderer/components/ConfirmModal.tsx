import { useEffect, useRef } from 'react'
import { useT } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'

// Generischer Bestätigungs-Dialog. Wird u. a. für das Signatur-Gate (Section 2.8) benutzt:
// vor jeder Mutation an einem signierten Dokument wird hier die Konsequenz benannt und
// explizit abgefragt — nie still. Titel/Body kommen aus dem Store (außerhalb, über t()).

export function ConfirmModal(): JSX.Element | null {
  const t = useT()
  const pending = useUiStore((s) => s.pendingConfirm)
  const resolve = useUiStore((s) => s.resolveConfirm)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (pending) okRef.current?.focus()
  }, [pending])

  if (!pending) return null

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40" role="dialog" aria-modal="true" aria-label={pending.title}>
      <div className="w-[26rem] rounded-lg bg-white p-4 shadow-xl">
        <h2 className="mb-2 text-base font-semibold">{pending.title}</h2>
        <p className="mb-4 text-sm text-slate-600">{pending.body}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => resolve(false)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" data-testid="confirm-cancel">
            {t('common.cancel')}
          </button>
          <button
            ref={okRef}
            type="button"
            onClick={() => resolve(true)}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700"
            data-testid="confirm-ok"
          >
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
