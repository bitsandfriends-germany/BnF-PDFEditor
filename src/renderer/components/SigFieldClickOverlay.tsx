import { useEffect, useState } from 'react'
import { BadgeCheck, ShieldAlert, ShieldX, X } from 'lucide-react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { getFormFields, listDocumentSignatures, type DocSignature, type FormField } from '@/lib/documents'
import type { PdfRect } from '@/lib/pdfCoords'

// R64 Nutzerwunsch: Das platzierte Signaturfeld ist ein ECHTES PDF-Formfeld.
// Ein Klick darauf (Viewer-Modus, ohne aktive Bewaffnung) oeffnet ein Popup mit
// den Signaturinfos: Aussteller/Subjekt, Zeitstempel, Integritaet und die
// CA-Validierung. Ohne Signatur zeigt dasselbe Popup das leere Feld an.
// Das Popup hoengt an der Welt (fixed), damit es nie vom Seitenrand abgeschnitten wird.

export interface OpenSigInfo { page: number; rect: PdfRect; screen: { x: number; y: number } }

export function SigFieldClickOverlay(): JSX.Element | null {
  const t = useT()
  const open = useUiStore((s) => s.sigInfo)
  const closeSigInfo = useUiStore((s) => s.closeSigInfo)
  const docVersion = useAppStore((s) => s.docVersion)
  const [sig, setSig] = useState<DocSignature | null | undefined>(undefined)
  const [field, setField] = useState<FormField | null | undefined>(undefined)

  useEffect(() => {
    if (!open) return
    let live = true
    setSig(undefined)
    setField(undefined)
    void (async () => {
      let name: string | null = null
      try {
        const fs = await getFormFields()
        if (!live) return
        const hit = fs.fields.find((f) => f.type === 'Signature' && f.page === open.page
          && Math.abs(f.rect.x - open.rect.x) < 2 && Math.abs(f.rect.y - open.rect.y) < 2)
          ?? fs.fields.find((f) => f.type === 'Signature' && f.page === open.page)
        name = hit?.name ?? null
        if (live) setField(hit ?? null)
      } catch { if (live) setField(null) }
      try {
        const sigs = await listDocumentSignatures()
        if (!live) return
        setSig(sigs.find((sg) => (sg.field ?? null) === name) ?? sigs[0] ?? null)
      } catch { if (live) setSig(null) }
    })()
    return () => { live = false }
    // docVersion: nach Signieren/Entfernen neu laden.
  }, [open, docVersion])

  // R65: Klick INS Feld oeffnet, jeder Klick daneben (oder Esc) schliesst —
  // ohne dass der Schliess-Klick selbst wieder Werkzeuge troeffnet.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeSigInfo() }
    const onDown = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null
      if (el && el.closest('[data-testid="sigfield-info"]')) return
      closeSigInfo()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true) }
  }, [open, closeSigInfo])

  if (!open) return null
  const x = Math.min(Math.max(8, open.screen.x - 140), window.innerWidth - 300)
  const y = Math.min(Math.max(8, open.screen.y + 8), window.innerHeight - 260)
  const sigOk = sig !== null && sig !== undefined && sig.intact && !sig.modifiedAfterSigning && sig.valid
  const Icon = sigOk ? BadgeCheck : sig === null ? ShieldAlert : ShieldX
  const tone = sigOk ? 'text-emerald-600 dark:text-emerald-400' : sig === null ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'

  return (
    <div data-testid="sigfield-info" className="pointer-events-auto fixed z-[70] w-[280px] rounded-lg border border-slate-300 bg-white p-3 text-xs shadow-xl dark:border-slate-600 dark:bg-slate-800"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold">
          <BadgeCheck size={14} className="text-slate-500" /> {t('sigfield.infoTitle')}
        </div>
        <button type="button" data-testid="sigfield-info-close" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" onClick={() => { closeSigInfo() }}>
          <X size={13} />
        </button>
      </div>
      {sig === undefined ? (
        <div className="text-slate-400">{t('sigfield.infoLoading')}</div>
      ) : sig === null ? (
        <div className="space-y-1">
          <div className={tone}>{field ? t('sigfield.infoEmpty') : t('sigfield.infoNone')}</div>
        </div>
      ) : (
        <div className="space-y-1">
          <div className={`flex items-center gap-1.5 font-semibold ${tone}`}>
            <Icon size={14} /> <span data-testid="sigfield-info-verdict">{sig.verdict}</span>
          </div>
          {sig.name ? <Row k={t('sigfield.infoName')} v={sig.name} /> : null}
          {sig.signTime ? <Row k={t('sigfield.infoTime')} v={fmtDate(sig.signTime)} /> : null}
          {sig.reason ? <Row k={t('sigfield.infoReason')} v={sig.reason} /> : null}
          {sig.location ? <Row k={t('sigfield.infoLocation')} v={sig.location} /> : null}
          <Row k={t('sigfield.intact')} v={sig.intact ? t('sigfield.yes') : t('sigfield.no')} />
          <Row k={t('sigfield.valid')} v={sig.valid ? t('sigfield.yes') : t('sigfield.no')} />
          <Row k={t('sigfield.trusted')} v={sig.trusted ? t('sigfield.yes') : t('sigfield.no')} />
          {!sig.trusted && sig.trustNote ? (
            <p data-testid="sigfield-info-trustnote" className="rounded bg-amber-50 p-1.5 leading-snug text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              {sig.trustNote}
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2">
      <span className="text-slate-500">{k}</span>
      <span className="break-words">{v}</span>
    </div>
  )
}

function fmtDate(d: string): string {
  try {
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) return d
    return dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch { return d }
}
