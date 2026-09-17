import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react'
import { useT } from '@/i18n'
import { useUiStore, type PinRequest } from '@/store/useUiStore'

// Modaler PIN-Abfrage (Nutzerwunsch Runde 53): die Karten-PIN wird in einem
// echten Dialogfenster abgefragt, nicht inline im Panel. Felder sind
// Passwort-typ; die Werte leben nur in diesem Komponenten-State und werden
// ausschließlich an den Signieraufruf übergeben — nie persistiert.

export function PinModal(): JSX.Element | null {
  const t = useT()
  const pending = useUiStore((s) => s.pendingPin)
  const resolve = useUiStore((s) => s.resolvePin)
  const [pin, setPin] = useState('')
  const [sigPin, setSigPin] = useState('')
  // 'idle' | 'checking' | 'ok' — Fehler bleiben als Text stehen und erlauben Retry.
  const [verifyState, setVerifyState] = useState<'idle' | 'checking' | 'ok'>('idle')
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pending) { setPin(''); setSigPin(''); setVerifyState('idle'); setVerifyError(null); firstRef.current?.focus() }
  }, [pending])

  if (!pending) return null
  const req: PinRequest = pending

  const submit = async (): Promise<void> => {
    if (!pin || verifyState === 'checking') return
    if (req.verify) {
      setVerifyState('checking')
      setVerifyError(null)
      const r = await req.verify(pin, req.needSigPin && sigPin ? sigPin : undefined).catch((e: unknown) => ({ ok: false, message: String((e as Error)?.message ?? e).slice(0, 160) }))
      if (!r.ok) { setVerifyState('idle'); setVerifyError(r.message ?? t('pin.verifyFailed')); return }
      // Gruener Haken kurz sichtbar lassen, dann uebergeben.
      setVerifyState('ok')
      await new Promise((res) => setTimeout(res, 550))
    }
    resolve({ pin, sigPin: req.needSigPin && sigPin ? sigPin : undefined })
  }
  const cancel = (): void => { resolve(null) }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" role="dialog" aria-modal="true" aria-label={req.title} data-testid="pin-dialog">
      <div className="w-[24rem] rounded-lg bg-white p-4 shadow-xl dark:bg-slate-800" onKeyDown={(e) => { if (e.key === 'Escape') cancel() }}>
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><KeyRound size={16} /> {req.title}</h2>
        {req.body ? <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{req.body}</p> : null}
        <input
          ref={firstRef}
          type="password"
          autoComplete="off"
          data-testid="pin-input"
          className="mb-2 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-600 dark:bg-slate-700"
          placeholder={t('pin.card')}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        {req.needSigPin ? (
          <input
            type="password"
            autoComplete="off"
            data-testid="pin-sigpin"
            className="mb-2 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-600 dark:bg-slate-700"
            placeholder={t('pin.signing')}
            value={sigPin}
            onChange={(e) => setSigPin(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          />
        ) : null}
        {verifyState === 'ok' ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400" data-testid="pin-verified"><CheckCircle2 size={14} /> {t('pin.verified')}</p>
        ) : verifyError ? (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400" data-testid="pin-error">{verifyError}</p>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">{t('pin.neverStored')}</span>
          <div className="flex gap-2">
            <button type="button" onClick={cancel} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600" data-testid="pin-cancel">
              {t('common.cancel')}
            </button>
            <button type="button" onClick={() => { void submit() }} disabled={!pin || verifyState === 'checking'} className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40" data-testid="pin-ok">
              {verifyState === 'checking' ? <Loader2 size={14} className="animate-spin" /> : null}
              {verifyState === 'checking' ? t('pin.checking') : verifyState === 'ok' ? t('pin.verified') : t('pin.ok')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
