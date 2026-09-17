import { useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'

// Passwort-Modal (Section 4A): erscheint bei Passwort-Pflicht. Drei Versuche, dann Abbruch (der
// Aufrufer zaehlt). Das Passwort wird nach resolve/Abbruch sofort aus dem lokalen State geloescht —
// es landet nie im Store und nie im Log (Section 5.1).

export function PasswordModal(): JSX.Element | null {
  const t = useT()
  const pending = useUiStore((s) => s.pendingPassword !== null)
  const resolve = useUiStore((s) => s.resolvePassword)
  const [pw, setPw] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pending) inputRef.current?.focus()
  }, [pending])

  if (!pending) return null

  const done = (value: string | null): void => {
    resolve(value)
    setPw('') // sofort ueberschreiben
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40" role="dialog" aria-modal="true" aria-label={t('errors.password_required')}>
      <div className="w-96 rounded-lg bg-white p-4 shadow-xl">
        <h2 className="mb-2 text-base font-semibold">{t('errors.password_required')}</h2>
        <input data-testid="password-input"
          ref={inputRef}
          type="password"
          value={pw}
          aria-label={t('errors.password_required')}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') done(pw)
            if (e.key === 'Escape') done(null)
          }}
          className="mb-3 w-full rounded border border-slate-300 px-2 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
        />
        <div className="flex justify-end gap-2">
          <button data-testid="password-cancel" type="button" onClick={() => done(null)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
            {t('common.cancel')}
          </button>
          <button data-testid="password-confirm" type="button" onClick={() => done(pw)} className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700">
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
