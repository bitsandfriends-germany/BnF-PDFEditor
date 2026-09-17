import { useCallback, useEffect, useState } from 'react'
import { Move, PenTool, Trash2, Upload, Type } from 'lucide-react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { imageDataUrl } from '@/lib/imageMime'
import {
  listSignatures, importSignatureFile, createTextSignature, deleteSignature, listDocumentSignatures, getSignatureImageB64, removeSignatures,
  type SignatureMeta, type DocSignature
} from '@/lib/documents'

// Signatur-Bibliothek (Section 9): wiederverwendbare Grafiken auflisten/importieren/erzeugen/
// loeschen. Bilder werden in die Bibliothek KOPIERT (kein Referenzieren). Zusaetzlich die
// digitalen Signaturen des geoeffneten Dokuments als Klartext-Urteil (Section 9 Verifikation).

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  const f = i >= 0 ? p.slice(i + 1) : p
  const dot = f.lastIndexOf('.')
  return dot > 0 ? f.slice(0, dot) : f
}

const input = 'w-full rounded border border-slate-300 px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-600'

export function SignaturePanel(): JSX.Element {
  const t = useT()
  const docOpen = useAppStore((s) => s.docOpen)
  const docVersion = useAppStore((s) => s.docVersion)
  const addToast = useAppStore((s) => s.addToast)
  const [items, setItems] = useState<SignatureMeta[]>([])
  // Bildvorschauen (Nutzerwunsch): b64 je Signatur-Id, nach dem Laden geladen.
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const armGraphicPlacement = useUiStore((s) => s.armGraphicPlacement)
  const [docSigs, setDocSigs] = useState<DocSignature[]>([])
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    try {
      const list = await listSignatures()
      setItems(list)
      // Vorschau-Ladung best effort: einzelne fehlende Bilder duerfen den Panel-Reload nicht kippen.
      const map: Record<string, string> = {}
      await Promise.all(list.map(async (it) => {
        try { map[it.id] = await getSignatureImageB64(it.id) } catch { /* ohne Vorschau */ }
      }))
      setThumbs(map)
    } catch {
      /* Bibliothek kann leer/nicht lesbar sein */
    }
    if (docOpen) {
      try {
        setDocSigs(await listDocumentSignatures())
      } catch {
        setDocSigs([])
      }
    } else {
      setDocSigs([])
    }
  }, [docOpen])

  useEffect(() => {
    void reload()
  }, [reload, docVersion])

  const onImport = async (): Promise<void> => {
    const path = await window.pdfEditor.pickImage()
    if (!path) return
    setBusy(true)
    try {
      await importSignatureFile(name.trim() || baseName(path), path, 120, 1)
      addToast({ kind: 'success', message: t('sig.imported') })
      setName('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const onCreate = async (): Promise<void> => {
    if (!name.trim() || !text.trim()) return
    setBusy(true)
    try {
      await createTextSignature(name.trim(), text.trim())
      addToast({ kind: 'success', message: t('sig.created') })
      setName('')
      setText('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      await deleteSignature(id)
      addToast({ kind: 'info', message: t('sig.deleted') })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 p-3 text-sm">
      <h3 className="font-semibold">{t('sig.library')}</h3>
      <p className="text-xs text-slate-500">{t('sig.libHint')}</p>

      {items.length === 0 ? (
        <p className="text-slate-400">{t('signatures.empty')}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5 rounded border border-slate-200 px-1.5 py-0.5 text-xs dark:border-slate-700">
              {thumbs[s.id] ? (
                <img src={imageDataUrl(thumbs[s.id] ?? '', s.fileName ?? 'sig.png')} alt={s.name} data-testid={`sig-thumb-${s.id}`} className="h-6 max-w-[56px] shrink-0 rounded bg-slate-50 object-contain dark:bg-slate-700" />
              ) : (
                <PenTool size={14} className="shrink-0 text-slate-400" />
              )}
              <span className="min-w-0 flex-1 truncate" title={s.fileName ?? s.name}>{s.name}</span>
              <span className="shrink-0 text-[10px] text-slate-400">{Math.round(s.defaultSizePt)}pt</span>
              <button type="button" title={t('sig.place')} aria-label={t('sig.place')} data-testid={`sig-place-${s.id}`} disabled={busy || !docOpen || !thumbs[s.id]} onClick={() => { const b = thumbs[s.id]; if (b) armGraphicPlacement({ mode: 'signature', name: s.name, imageB64: b, dataUrl: imageDataUrl(b, s.fileName ?? 'sig.png'), sigId: s.id }) }} className="rounded p-0.5 text-sky-600 hover:bg-sky-50 disabled:opacity-40 dark:hover:bg-slate-700">
                <Move size={14} />
              </button>
              <button type="button" title={t('sig.delete')} aria-label={t('sig.delete')} data-testid={`sig-del-${s.id}`} disabled={busy} onClick={() => void onDelete(s.id)} className="rounded p-0.5 text-red-600 hover:bg-red-50 disabled:opacity-40">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-md border border-slate-200 p-2 dark:border-slate-700">
        <input className={input} placeholder={t('sig.name')} data-testid="sig-name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={input} placeholder={t('sig.text')} data-testid="sig-text" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2">
          <button type="button" disabled={busy} data-testid="sig-import" onClick={() => void onImport()} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600">
            <Upload size={14} /> {t('sig.import')}
          </button>
          <button type="button" disabled={busy || !name.trim() || !text.trim()} data-testid="sig-create" onClick={() => void onCreate()} className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1.5 text-white hover:bg-sky-700 disabled:opacity-40">
            <Type size={14} /> {t('sig.create')}
          </button>
        </div>
      </div>

      <h3 className="pt-2 font-semibold">{t('sig.docTitle')}</h3>
      {!docOpen || docSigs.length === 0 ? (
        <p className="text-slate-400" data-testid="sigdoc-empty">{t('sig.noneDoc')}</p>
      ) : (
        <ul className="space-y-1">
          <li data-testid="sigdoc-count" className="text-xs text-slate-500">{t('sig.count', { count: docSigs.length })}</li>
          <li>
            {/* R60: 'Signaturen entfernen' auch hier (Nutzerwunsch; bisher nur Kontextmenue). */}
            <button type="button" data-testid="sigdoc-remove-all" disabled={busy || !docOpen}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-300 dark:hover:bg-slate-700"
              onClick={() => { void (async () => { setBusy(true); try { const ok = await removeSignatures(); if (ok) await reload() } finally { setBusy(false) } })() }}>
              <Trash2 size={13} /> {t('certs.removeSigs')}
            </button>
          </li>
          {docSigs.map((d, i) => (
            <li key={i} className={`rounded border px-2 py-1 ${d.valid ? 'border-emerald-300 bg-emerald-50/60' : 'border-red-300 bg-red-50/60'} dark:bg-transparent`}>
              <div className="font-medium">{d.field ?? t('common.signature')}</div>
              <div className="text-xs">{d.verdict}</div>
              {d.name ? <div className="truncate text-xs text-slate-500">{t('certs.signName')}: {d.name}</div> : null}
              {d.reason ? <div className="truncate text-xs text-slate-500">{t('certs.signReason')}: {d.reason}</div> : null}
              {d.location ? <div className="truncate text-xs text-slate-500">{t('certs.signLocation')}: {d.location}</div> : null}
              {d.modifiedAfterSigning ? <div className="text-xs text-red-600">{t('sig.modified')}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
