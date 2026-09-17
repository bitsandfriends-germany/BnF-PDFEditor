import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useAppStore, type Toast as ToastItem, type ToastKind } from '@/store/useAppStore'
import { useT } from '@/i18n'

// Toast-System (Section 4C): kein stilles Scheitern. Fehler unten rechts persistent mit
// correlationId + "Details anzeigen"; Info/Erfolg selbstschliessend. aria-live für Screenreader.

const AUTO_DISMISS_MS = 4500

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle
}

const TONE: Record<ToastKind, string> = {
  info: 'border-slate-600 bg-slate-800 text-slate-100',
  success: 'border-emerald-600 bg-emerald-900 text-emerald-50',
  error: 'border-red-600 bg-red-950 text-red-50'
}

function ToastCard({ toast, onShowDetails }: { toast: ToastItem; onShowDetails?: (cid?: string) => void }): JSX.Element {
  const t = useT()
  const dismiss = useAppStore((s) => s.dismissToast)
  const Icon = ICONS[toast.kind]

  useEffect(() => {
    if (toast.persistent) return
    const timer = setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast.id, toast.persistent, dismiss])

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex w-80 gap-3 rounded-lg border px-3 py-2.5 shadow-lg ${TONE[toast.kind]}`}
    >
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug break-words">
          {toast.kind === 'error' ? `${t('toast.errorPrefix')}: ${toast.message}` : toast.message}
        </p>
        {toast.correlationId ? (
          <p className="mt-1 font-mono text-[10px] opacity-70">id: {toast.correlationId}</p>
        ) : null}
        {toast.actionLabel || toast.correlationId ? (
          <button data-testid={`toast-action-${toast.id}`}
            type="button"
            onClick={() => {
              toast.action?.()
              onShowDetails?.(toast.correlationId)
              dismiss(toast.id)
            }}
            className="mt-1 text-xs font-medium underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {toast.actionLabel ?? t('toast.showDetails')}
          </button>
        ) : null}
      </div>
      <button data-testid={`toast-dismiss-${toast.id}`}
        type="button"
        aria-label={t('toast.dismiss')}
        onClick={() => dismiss(toast.id)}
        className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 focus-visible:outline focus-visible:outline-2"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  )
}

export function ToastViewport({ onShowDetails }: { onShowDetails?: (cid?: string) => void }): JSX.Element {
  const toasts = useAppStore((s) => s.toasts)
  return (
    <div
      aria-live="polite"
      aria-label="Meldungen"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} {...(onShowDetails ? { onShowDetails } : {})} />
      ))}
    </div>
  )
}
