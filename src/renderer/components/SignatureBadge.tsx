import { useEffect, useState } from 'react'
import { BadgeCheck, ShieldAlert, ShieldX } from 'lucide-react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { listDocumentSignatures, type DocSignature } from '@/lib/documents'

// R60 Nutzerwunsch: signiertes Dokument zeigt links unten ein grünes
// Zertifikatszeichen. Klick oeffnet ein Popup mit den Zertifikatsinformationen
// und dem VALIDIERUNGSSTATUS gegen die CA (pyHanko-Kette: intakt / gültig /
// Aussteller vertrauenswuerdig / Aenderungen nach der Signatur).

export function SignatureBadge(): JSX.Element | null {
  const t = useT()
  const docOpen = useAppStore((s) => s.docOpen)
  const signedDoc = useAppStore((s) => s.signedDoc)
  const [open, setOpen] = useState(false)
  const [sigs, setSigs] = useState<DocSignature[] | null>(null)
  const [loading, setLoading] = useState(false)

  const docVersion = useAppStore((s) => s.docVersion)
  useEffect(() => {
    // Nach jeder Dokumentanderung (Neu-Oeffnen, Signieren, Entfernen) neu laden.
    setSigs(null)
    if (!docOpen || !signedDoc) setOpen(false)
  }, [docOpen, signedDoc, docVersion])

  // R65: Unterzeichnungs-Ereignisse (z. B. Signieren ohne Dokument-Neuladen)
  // verschieben das Badge — es muss sofort sichtbar sein.
  useEffect(() => {
    const un = useAppStore.subscribe((st, prev) => {
      if (st.signedDoc && !prev.signedDoc) setSigs(null)
    })
    return un
  }, [])

  useEffect(() => {
    if (!open || sigs !== null || loading) return
    setLoading(true)
    void listDocumentSignatures().then((r) => { setSigs(r); setLoading(false) }).catch(() => { setSigs([]); setLoading(false) })
  }, [open, sigs, loading])

  if (!docOpen || !signedDoc) return null
  const broken = (sigs ?? []).some((s) => !s.intact || s.modifiedAfterSigning)
  const untrusted = (sigs ?? []).some((s) => s.intact && !s.valid)
  const Icon = broken ? ShieldX : untrusted ? ShieldAlert : BadgeCheck
  const tone = broken ? 'text-red-600 border-red-300 bg-red-50/90' : untrusted ? 'text-amber-600 border-amber-300 bg-amber-50/90' : 'text-emerald-600 border-emerald-300 bg-emerald-50/90'

  return (
    <>
      <button
        type="button"
        data-testid="sig-badge"
        title={t('sigbadge.title')}
        aria-label={t('sigbadge.title')}
        onClick={() => setOpen(true)}
        className={`fixed bottom-3 left-3 z-40 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-md backdrop-blur ${tone}`}
      >
        <Icon size={16} /> {t('sigbadge.label')}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" data-testid="sig-badge-modal" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-lg border border-slate-300 bg-white p-4 text-sm shadow-xl dark:border-slate-600 dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">{t('sigbadge.title')}</h3>
              <button type="button" data-testid="sig-badge-close" className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" onClick={() => setOpen(false)} aria-label="Schließen">✕</button>
            </div>
            {loading ? <p className="text-slate-500">…</p> : null}
            {!loading && (sigs ?? []).length === 0 ? <p className="text-slate-500">{t('sig.noneDoc')}</p> : null}
            {!loading && (sigs ?? []).map((d, i) => (
              <div key={i} className={`mb-2 rounded border px-3 py-2 ${d.intact && d.valid ? 'border-emerald-300 bg-emerald-50/60 dark:bg-transparent' : 'border-red-300 bg-red-50/60 dark:bg-transparent'}`} data-testid={`sig-badge-item-${i}`}>
                <div className="flex items-center gap-2 font-medium">
                  {d.intact && d.valid ? <BadgeCheck size={15} className="text-emerald-600" /> : d.intact ? <ShieldAlert size={15} className="text-amber-600" /> : <ShieldX size={15} className="text-red-600" />}
                  {d.field ?? t('common.signature')}
                </div>
                <div className="mt-1 text-xs">{d.verdict}</div>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                  {d.name ? <li>{t('certs.signName')}: {d.name}</li> : null}
                  {d.reason ? <li>{t('certs.signReason')}: {d.reason}</li> : null}
                  {d.signTime ? <li>{t('sigbadge.time')}: {d.signTime}</li> : null}
                  <li>{d.intact ? t('sigbadge.intact') : t('sigbadge.broken')}</li>
                  <li>{d.trusted ? t('sigbadge.trusted') : t('sigbadge.untrusted')}</li>
                  {d.modifiedAfterSigning ? <li className="text-red-600">{t('sig.modified')}</li> : null}
                </ul>
              </div>
            ))}
            <p className="mt-1 text-[11px] text-slate-400">{t('sigbadge.caNote')}</p>
          </div>
        </div>
      ) : null}
    </>
  )
}
