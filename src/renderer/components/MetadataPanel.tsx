import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useT } from '@/i18n'
import { api } from '@/lib/apiClient'
import { setMetadata, suggestMetadata, type MetadataPatch } from '@/lib/documents'
import { useAiStore } from '@/store/useAiStore'
import { notifyError } from '@/store/useAppStore'
import { useAppStore } from '@/store/useAppStore'

// Tab 2 (Section 4B): Metadaten-Formular. Laedt per GET, speichert ueber die Dokument-Schicht.
// "KI-Vorschlag" ist sichtbar, aber bis zur KI-Oberflaeche (Step 10) deaktiviert.

const EMPTY: MetadataPatch = { title: '', author: '', subject: '', keywords: '' }

export function MetadataPanel(): JSX.Element {
  const t = useT()
  const readOnly = useAppStore((s) => s.readOnly)
  const docOpen = useAppStore((s) => s.docOpen)
  const docVersion = useAppStore((s) => s.docVersion)
  const [form, setForm] = useState<MetadataPatch>(EMPTY)
  const [busy, setBusy] = useState(false)
  const editedRef = useRef(false)
  const [suggesting, setSuggesting] = useState(false)
  const configured = useAiStore((s) => s.config?.textConfigured ?? false)
  const currentPage = useAppStore((s) => s.currentPage)

  useEffect(() => {
    if (!docOpen) return
    let alive = true
    api
      .get<MetadataPatch>('/document/metadata')
      .then((m) => {
        // E2E-Fund: spaet eintreffende Reads duerfen frische Nutzereingaben nicht
        // ueberschreiben — sonst speichert der Button still die alten Werte.
        if (!alive || editedRef.current) return
        setForm({ title: m.title ?? '', author: m.author ?? '', subject: m.subject ?? '', keywords: m.keywords ?? '' })
      })
      .catch((err) => notifyError(err))
    return () => {
      alive = false
    }
  }, [docOpen, docVersion])

  const field = (key: keyof MetadataPatch, label: string): JSX.Element => (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-600">{label}</span>
      <input data-testid={`meta-field-${key}`}
        type="text"
        value={form[key]}
        aria-label={label}
        disabled={readOnly || !docOpen}
        onChange={(e) => { editedRef.current = true; setForm((f) => ({ ...f, [key]: e.target.value })) }}
        className="w-full rounded border border-slate-300 px-2 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 disabled:bg-slate-50"
      />
    </label>
  )

  return (
    <div className="space-y-3 p-3">
      {field('title', t('metadata.title'))}
      {field('author', t('metadata.author'))}
      {field('subject', t('metadata.subject'))}
      {field('keywords', t('metadata.keywords'))}
      <div className="flex items-center gap-2">
        <button data-testid="meta-save"
          type="button"
          disabled={readOnly || !docOpen || busy}
          onClick={() => {
            setBusy(true)
            editedRef.current = false // Save warms den Cache wieder an (docVersion-Refetch)
            void setMetadata(form).finally(() => setBusy(false))
          }}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {t('metadata.save')}
        </button>
        <button data-testid="meta-suggest"
          type="button"
          disabled={!docOpen || readOnly || suggesting || !configured}
          title={configured ? t('metadata.aiSuggest') : t('ai.notConfigured')}
          aria-label={t('metadata.aiSuggest')}
          onClick={() => {
            setSuggesting(true)
            void suggestMetadata(currentPage)
              .then((patch) => patch && setForm(patch))
              .finally(() => setSuggesting(false))
          }}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <Sparkles size={14} /> {suggesting ? t('common.busy') : t('metadata.aiSuggest')}
        </button>
      </div>
    </div>
  )
}
