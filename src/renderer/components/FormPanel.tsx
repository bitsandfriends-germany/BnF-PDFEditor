import { useCallback, useEffect, useState } from 'react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { getFormFields, flatten, saveDocument, resetForm, type FormFieldsResult } from '@/lib/documents'

// Formular-Bedienung (Section 11): die eigentlichen Felder liegen als native Controls auf der
// Seite (FormLayer). Hier die Steuerung drumherum: Hervorheben, Speichern (editierbar / flach),
// Zuruecksetzen mit Bestaetigung — und der ausdrueckliche XFA-Hinweis (XFA ist [OUT]).

const btn = 'w-full rounded-md border border-slate-300 px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700'

export function FormPanel(): JSX.Element {
  const t = useT()
  const docOpen = useAppStore((s) => s.docOpen)
  const docVersion = useAppStore((s) => s.docVersion)
  const readOnly = useAppStore((s) => s.readOnly)
  const mutationLock = useAppStore((s) => s.mutationLock)
  const highlight = useUiStore((s) => s.highlightFormFields)
  const setHighlight = useUiStore((s) => s.setHighlightFormFields)
  const requestConfirm = useUiStore((s) => s.requestConfirm)

  const [info, setInfo] = useState<FormFieldsResult | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    if (!docOpen) {
      setInfo(null)
      return
    }
    try {
      setInfo(await getFormFields())
    } catch {
      setInfo(null)
    }
  }, [docOpen])

  useEffect(() => {
    void reload()
  }, [reload, docVersion])

  const count = info?.count ?? 0
  const busyOrLocked = busy || mutationLock || !docOpen || readOnly

  const onSaveFlat = async (): Promise<void> => {
    const ok = await requestConfirm(t('forms.flattenTitle'), t('forms.flattenBody'))
    if (!ok) return
    setBusy(true)
    try {
      if (await flatten(['forms'])) await saveDocument('save')
    } finally {
      setBusy(false)
    }
  }

  const onReset = async (): Promise<void> => {
    const ok = await requestConfirm(t('forms.resetTitle'), t('forms.resetBody'))
    if (!ok) return
    setBusy(true)
    try {
      if (await resetForm()) await reload()
    } finally {
      setBusy(false)
    }
  }

  if (!docOpen) return <p className="p-3 text-sm text-slate-500">{t('forms.noDoc')}</p>

  return (
    <div className="flex h-full flex-col gap-3 p-3 text-sm">
      {info?.hasXfa ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-200" data-testid="form-xfa-notice">
          {t('forms.xfaNotice')}
        </div>
      ) : count === 0 ? (
        <p className="text-slate-500" data-testid="form-none">{t('forms.none')}</p>
      ) : (
        <p className="text-slate-600 dark:text-slate-300" data-testid="form-count">{t('forms.count', { count })}</p>
      )}

      <label className="flex items-center gap-2">
        <input type="checkbox" data-testid="form-highlight" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
        {t('forms.highlight')}
      </label>

      {count > 0 ? (
        <div className="flex flex-col gap-2">
          <button type="button" className={btn} disabled={busyOrLocked} data-testid="form-save-editable" onClick={() => void saveDocument('save')}>
            {t('forms.saveEditable')}
          </button>
          <button type="button" className={btn} disabled={busyOrLocked} data-testid="form-save-flat" onClick={() => void onSaveFlat()}>
            {t('forms.saveFlat')}
          </button>
          <button type="button" className={btn} disabled={busyOrLocked} data-testid="form-reset" onClick={() => void onReset()}>
            {t('forms.reset')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
