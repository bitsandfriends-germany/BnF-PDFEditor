import { useState } from 'react'
import { useT } from '@/i18n'
import { encryptDoc } from '@/lib/documents'
import { useUiStore } from '@/store/useUiStore'
import { useAppStore } from '@/store/useAppStore'

// §2/§3 Verschlüsselung: echter Einstieg (Registry-Befehl file.encrypt via
// Eigenschaften-Panel und Native-Menue). Backend schreibt AES-256 (R6) in die Arbeitskopie;
// das Oeffnen danach verlangt das Passwort (PasswordModal-Pfad). Owner-Passwort optional —
// defaultet serverseitig auf das Benutzer-Passwort.
export function EncryptDialog(): JSX.Element | null {
  const t = useT()
  const open = useUiStore((s) => s.encryptDialog)
  const close = useUiStore((s) => s.closeEncryptDialog)
  const readOnly = useAppStore((s) => s.readOnly)
  const [userPw, setUserPw] = useState('')
  const [ownerPw, setOwnerPw] = useState('')
  const [busy, setBusy] = useState(false)
  if (!open) return null

  const can = userPw.length > 0 && !busy && !readOnly
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const ok = await encryptDoc(userPw, ownerPw.length > 0 ? ownerPw : undefined)
      if (ok) close()
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-600'
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t('encrypt.title')} onClick={close}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl dark:bg-slate-800 dark:text-slate-100" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-base font-semibold">{t('encrypt.title')}</h2>
        <p className="mb-3 text-xs text-amber-700 dark:text-amber-400" data-testid="encrypt-warning">{t('encrypt.warning')}</p>
        <label className="mb-2 block text-sm">
          <span className="mb-1 block text-slate-600 dark:text-slate-300">{t('encrypt.userPw')}</span>
          <input type="password" autoFocus className={input} data-testid="enc-user-pw" value={userPw} onChange={(e) => setUserPw(e.target.value)} />
        </label>
        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-slate-600 dark:text-slate-300">{t('encrypt.ownerPw')}</span>
          <input type="password" className={input} data-testid="enc-owner-pw" value={ownerPw} onChange={(e) => setOwnerPw(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600" data-testid="enc-cancel" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" disabled={!can} className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40" data-testid="enc-run" onClick={() => void run()}>
            {t('encrypt.run')}
          </button>
        </div>
      </div>
    </div>
  )
}
