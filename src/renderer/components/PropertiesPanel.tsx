import { useEffect, useState, type ReactNode } from 'react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { getDocumentProperties, type DocProperties } from '@/lib/documents'
import { dispatchCommand } from '@/lib/commands'

// Read-only Dokument-Eigenschaften (Section 4). Laedt beim Oeffnen und bei Seiten-/Version-
// wechsel (aktuelle Seitenmasse haengen an currentPage). Fehler werden als Zeile gezeigt, nie stumm.

function fmtBytes(n: number | null): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
function yn(v: boolean): 'yes' | 'no' {
  return v ? 'yes' : 'no'
}

export function PropertiesPanel(): JSX.Element {
  const t = useT()
  const docOpen = useAppStore((s) => s.docOpen)
  const currentPage = useAppStore((s) => s.currentPage)
  const docVersion = useAppStore((s) => s.docVersion)
  const readOnly = useAppStore((s) => s.readOnly)
  const [props, setProps] = useState<DocProperties | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!docOpen) {
      setProps(null)
      return
    }
    let cancelled = false
    setLoading(true)
    getDocumentProperties(currentPage)
      .then((p) => { if (!cancelled) { setProps(p); setErr(null) } })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [docOpen, currentPage, docVersion])

  if (!docOpen) return <p className="p-3 text-sm text-slate-500">{t('sidebar.empty')}</p>

  const Row = ({ k, v }: { k: string; v: ReactNode }): JSX.Element => (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="text-right font-medium text-slate-800">{v}</span>
    </div>
  )

  return (
    <div className="h-full overflow-auto p-3" data-testid="properties-panel">
      {loading && !props ? <p className="text-sm text-slate-400">{t('common.busy')}</p> : null}
      {err ? <p className="mb-2 text-sm text-red-600">{err}</p> : null}
      {props ? (
        <div className="divide-y divide-slate-100">
          <Row k={t('prop.fileSize')} v={fmtBytes(props.fileSizeBytes)} />
          <Row k={t('prop.pages')} v={props.pageCount} />
          <Row k={t('prop.version')} v={props.pdfVersion ?? '—'} />
          <Row k={t('prop.producer')} v={props.producer ?? '—'} />
          <Row k={t('prop.creator')} v={props.creator ?? '—'} />
          <Row k={t('prop.created')} v={props.creationDate ?? '—'} />
          <Row k={t('prop.modified')} v={props.modDate ?? '—'} />
          <Row k={t('prop.pageDims')} v={props.pageWidth != null && props.pageHeight != null ? `${props.pageWidth} × ${props.pageHeight} ${t('prop.pt')}` : '—'} />
          <Row k={t('prop.rotation')} v={`${props.pageRotation}°`} />
          <Row k={t('prop.encryption')} v={<>{t(`prop.${yn(props.encrypted)}`)}{props.encryptionAlgorithm ? ` · ${props.encryptionAlgorithm}` : ''}</>} />
          {props.pendingEncryption ? <Row k={t('prop.pendingEncrypt')} v={t('prop.yes')} /> : null}
          {!readOnly ? (
            <button type="button" className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600" data-testid="prop-encrypt" disabled={props.pendingEncryption} onClick={() => void dispatchCommand('file.encrypt')}>
              {t('encrypt.run')}
            </button>
          ) : null}
          <Row k={t('prop.linearized')} v={props.linearized === null ? t('prop.unknown') : t(`prop.${yn(props.linearized)}`)} />
          <Row k={t('prop.tagged')} v={t(`prop.${yn(props.tagged)}`)} />
          <Row k={t('prop.forms')} v={t(`prop.${yn(props.hasForms)}`)} />
          <Row k={t('prop.attachments')} v={props.attachmentCount} />
          <Row k={t('prop.javascript')} v={t(`prop.${yn(props.hasJavaScript)}`)} />
          <div className="py-2">
            <div className="mb-1 text-sm font-medium text-slate-800">{t('prop.fonts')}</div>
            {props.fonts.length === 0 ? (
              <p className="text-sm text-slate-400">{t('prop.noFonts')}</p>
            ) : (
              <ul className="space-y-0.5">
                {props.fonts.map((f, i) => (
                  <li key={i} className="flex items-center justify-between text-xs" data-testid={`font-${i}`}>
                    <span>{f.name ?? '—'}</span>
                    <span className={f.embedded ? 'text-emerald-600' : 'text-amber-600'}>{t(f.embedded ? 'prop.embedded' : 'prop.notEmbedded')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
