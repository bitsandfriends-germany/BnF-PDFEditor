import { useMemo, useState } from 'react'
import { useT } from '@/i18n'
import { pdfPointToCanvas, type PdfPageBox } from '@/lib/pdfCoords'
import type { FormField } from '@/lib/documents'

// Native Formularfelder ueber der gerenderten Seite (Section 11). Position aus dem PDF-User-Space
// (unten-links, Backend-Konvention) via pdfPointToCanvas -> CSS. Reihenfolge im DOM = Tab-Reihenfolge
// (AcroForm-Reihenfolge). Commit beim Verlassen des Felds -> fillForm (ein Command pro Bearbeitung).

export interface FormLayerProps {
  fields: FormField[]
  pageWidth: number // Punkte (ungerotiert)
  pageHeight: number // Punkte
  scale: number
  rotation: number
  highlight: boolean
  readOnly: boolean
  onCommit: (name: string, value: string | boolean) => void
}

interface CssBox { left: number; top: number; width: number; height: number }

function toCssBox(f: FormField, page: PdfPageBox, scale: number, rotation: number): CssBox {
  const a = pdfPointToCanvas(f.rect.x, f.rect.y, page, scale, rotation)
  const b = pdfPointToCanvas(f.rect.x + f.rect.width, f.rect.y + f.rect.height, page, scale, rotation)
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  }
}

export function FormLayer({ fields, pageWidth, pageHeight, scale, rotation, highlight, readOnly, onCommit }: FormLayerProps): JSX.Element | null {
  const t = useT()
  const page: PdfPageBox = useMemo(() => ({ width: pageWidth, height: pageHeight }), [pageWidth, pageHeight])
  const [local, setLocal] = useState<Record<string, string | boolean>>({})

  if (fields.length === 0) return null

  const valueOf = (f: FormField): string | boolean => local[f.name] ?? f.value

  const commit = (name: string, v: string | boolean): void => {
    setLocal((m) => ({ ...m, [name]: v }))
    onCommit(name, v)
  }

  const baseFor = (required: boolean): string => {
    const reqMark = required ? ' !border-red-500 !bg-red-100/30' : ''
    return highlight
      ? `absolute rounded-sm border border-sky-400/70 bg-sky-300/10 px-0.5 text-slate-900 focus:outline focus:outline-2 focus:outline-sky-500${reqMark}`
      : `absolute border text-slate-900 focus:outline focus:outline-2 focus:outline-sky-500${required ? ' border-red-500 bg-red-100/30' : ' border-transparent'}${reqMark}`
  }

  return (
    <>
      {fields.map((f, i) => {
        const box = toCssBox(f, page, scale, rotation)
        const style = { left: box.left, top: box.top, width: box.width, height: box.height, fontSize: f.fontSize > 0 ? f.fontSize * scale : undefined }
        const disabled = readOnly || f.readOnly
        const req = f.required ? ' *' : ''
        const key = `${f.name}:${i}`
        const testid = `form-field-${f.name}`

        if (f.type === 'Signature') {
          if (f.signed) {
            // R64: unterzeichnetes Feld zeigt das PDF selbst (Bild/Name/Stempel).
            // Unsere Beschriftung 'Signaturfeld' wirft dort nur Fragen auf —
            // klickdurchlaessig fuer das Info-Popup.
            return <div key={key} data-testid={testid} style={{ ...style, pointerEvents: 'none' }} aria-hidden />
          }
          return (
            <div key={key} data-testid={testid} title={t('forms.signatureField')} style={{ ...style, ...(!highlight ? { border: '1px dashed rgba(0,0,0,.25)' } : {}) }} className="absolute grid place-items-center bg-sky-100/40 text-[10px] text-sky-700">
              {t('forms.signatureField')}
            </div>
          )
        }
        if (f.type === 'Button') {
          return <div key={key} data-testid={testid} style={style} aria-hidden />
        }
        if (f.type === 'CheckBox') {
          return (
            <label key={key} data-testid={testid} title={f.name + req} style={style} className="absolute grid place-items-center">
              <input data-testid={`${testid}-input`} type="checkbox" disabled={disabled} checked={Boolean(valueOf(f))} onChange={(e) => commit(f.name, e.target.checked)} />
            </label>
          )
        }
        if (f.type === 'ComboBox' || f.type === 'ListBox' || f.type === 'RadioButton') {
          const v = String(valueOf(f))
          return (
            <select key={key} data-testid={testid} title={f.name + req} disabled={disabled} style={{ ...style, ...({ lineHeight: '1.1' } as object) }} className={baseFor(f.required)} value={v} onChange={(e) => commit(f.name, e.target.value)}>
              <option value="">{'\u00a0'}</option>
              {f.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
              {v && !f.options.includes(v) ? <option value={v}>{v}</option> : null}
            </select>
          )
        }
        // Text (ein-/mehrzeilig)
        const v = String(valueOf(f))
        if (f.multiline) {
          return (
            <textarea key={key} data-testid={testid} title={f.name + req} disabled={disabled} style={style} className={baseFor(f.required)} value={v} maxLength={f.maxLen || undefined} onBlur={(e) => commit(f.name, e.target.value)} onChange={(e) => setLocal((m) => ({ ...m, [f.name]: e.target.value }))} />
          )
        }
        return (
          <input key={key} data-testid={testid} title={f.name + req} disabled={disabled} style={style} className={baseFor(f.required)} value={v} maxLength={f.maxLen || undefined} onBlur={(e) => commit(f.name, e.target.value)} onChange={(e) => setLocal((m) => ({ ...m, [f.name]: e.target.value }))} />
        )
      })}
    </>
  )
}
