import { useMemo, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore, selectionExpr } from '@/store/useUiStore'
import { parsePageRange } from '@/lib/pageRange'
import { extractPages, splitDocument, insertPages, addPageNumbers, applyWatermark, listEmbeddedImages, extractEmbeddedImages, flatten, exportImages, exportText, compressDoc, lineariseDoc, imagesToPdf, type InsertSource, type EmbeddedImage } from '@/lib/documents'

// Pages-/Inhalts-Dialoge (Sections 6/7). Bewusst klein und direkt: Sie sammeln genau die
// Backend-Parameter und rufen den getypten Client. Mutationen (Einfügen, Seitenzahlen) durch-
// laufen automatisch das Signatur-Gate in mutate(); Extrahieren/Teilen sind Datei-Produzenten.

type Kind = 'extract' | 'split' | 'insert' | 'numbers' | 'watermark' | 'images' | 'flatten' | 'export'

const BLANK_SIZES: Record<string, [number, number]> = {
  a4: [595, 842],
  letter: [612, 792],
  a3: [842, 1191]
}
const ANCHORS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="mb-3 block text-sm">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

const input = 'w-full rounded border border-slate-300 px-2 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500'

function useRange(initial: string, total: number): { expr: string; setExpr: (v: string) => void; valid: boolean } {
  const [expr, setExpr] = useState(initial)
  const res = useMemo(() => parsePageRange(expr, total), [expr, total])
  return { expr, setExpr, valid: res.ok && expr.trim().length > 0 }
}

function DirField({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const t = useT()
  return (
    <div className="flex gap-2">
      <input className={input} readOnly value={value} placeholder={t('dialog.dest')} data-testid="dlg-dir-path" />
      <button data-testid="dlg-dir-choose"
        type="button"
        className="whitespace-nowrap rounded-md border border-slate-300 px-3 text-sm hover:bg-slate-50"
        onClick={async () => {
          const d = await window.pdfEditor.chooseDirectory()
          if (d) onChange(d)
        }}
      >
        {t('dialog.choose')}
      </button>
    </div>
  )
}

function ExtractDialog({ total, pre }: { total: number; pre: string }): JSX.Element | null {
  const t = useT()
  const range = useRange(pre, total)
  const [each, setEach] = useState(false)
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const can = range.valid && dir !== '' && !busy
  return (
    <>
      <Field label={t('pages.title')}>
        <input className={input} value={range.expr} data-testid="extract-expr" onChange={(e) => range.setExpr(e.target.value)} />
      </Field>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input data-testid="extract-each" type="checkbox" checked={each} onChange={(e) => setEach(e.target.checked)} /> {t('dialog.eachOwnFile')}
      </label>
      <Field label={t('dialog.dest')}><DirField value={dir} onChange={setDir} /></Field>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      <button
        type="button"
        disabled={!can}
        data-testid="extract-run"
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40"
        onClick={async () => {
          setErr(null)
          if (!dir) return setErr(t('dialog.needDir'))
          setBusy(true)
          try { await extractPages(range.expr, dir, each) } finally { setBusy(false) }
        }}
      >
        {t('common.apply')}
      </button>
    </>
  )
}

function SplitDialog({ total, presetMode, presetPage }: { total: number; presetMode?: 'everyN' | 'at' | 'every'; presetPage?: number }): JSX.Element | null {
  const t = useT()
  // §6 "Vor dieser Seite teilen": Preset aus dem Kontextmenü setzt Modus + Seite als Anfangswerte.
  const [mode, setMode] = useState<'everyN' | 'at' | 'every'>(presetMode ?? 'everyN')
  const [count, setCount] = useState(2)
  const [page, setPage] = useState(presetPage ?? 1)
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState(false)
  const can = dir !== '' && !busy && (mode !== 'everyN' || count >= 1) && (mode !== 'at' || page >= 1)
  return (
    <>
      <Field label={t('dialog.mode')}>
        <select className={input} value={mode} data-testid="dlg-split-mode" onChange={(e) => setMode(e.target.value as 'everyN' | 'at' | 'every')}>
          <option value="everyN">{t('dialog.everyN')}</option>
          <option value="at">{t('dialog.atPage')}</option>
          <option value="every">{t('dialog.eachPage')}</option>
        </select>
      </Field>
      {mode === 'everyN' && (
        <Field label={t('dialog.everyN')}>
          <input data-testid="split-count" type="number" min={1} className={input} value={count} onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)} />
        </Field>
      )}
      {mode === 'at' && (
        <Field label={t('dialog.atPage')}>
          <input data-testid="split-page" type="number" min={1} max={total} className={input} value={page} onChange={(e) => setPage(parseInt(e.target.value, 10) || 1)} />
        </Field>
      )}
      <Field label={t('dialog.dest')}><DirField value={dir} onChange={setDir} /></Field>
      <button
        type="button"
        disabled={!can}
        data-testid="split-run"
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40"
        onClick={async () => { setBusy(true); try { await splitDocument({ mode, page: mode === 'at' ? page : null, count: mode === 'everyN' ? count : null, destDir: dir }) } finally { setBusy(false) } }}
      >
        {t('common.apply')}
      </button>
    </>
  )
}

function InsertDialog({ total, presetPosition, presetPage }: { total: number; presetPosition?: 'start' | 'end' | 'before' | 'after'; presetPage?: number }): JSX.Element | null {
  const t = useT()
  const [position, setPosition] = useState<'start' | 'end' | 'before' | 'after'>(presetPosition ?? 'end')
  const [page, setPage] = useState(presetPage ?? 1)
  const [kind, setKind] = useState<'blank' | 'image' | 'pdf'>('blank')
  const [sizeKey, setSizeKey] = useState<'a4' | 'letter' | 'a3'>('a4')
  const [orient, setOrient] = useState<'portrait' | 'landscape'>('portrait')
  const [imgPath, setImgPath] = useState('')
  const [pdfPath, setPdfPath] = useState('')
  const [scale, setScale] = useState(false)
  const [busy, setBusy] = useState(false)
  const needPage = position === 'before' || position === 'after'
  const srcReady = kind === 'blank' || (kind === 'image' && imgPath !== '') || (kind === 'pdf' && pdfPath !== '')
  const can = !busy && srcReady && (!needPage || page >= 1)
  return (
    <>
      <Field label={t('dialog.position')}>
        <select className={input} value={position} data-testid="dlg-ins-pos" onChange={(e) => setPosition(e.target.value as typeof position)}>
          <option value="start">{t('insert.atStart')}</option>
          <option value="before">{t('insert.before')}</option>
          <option value="after">{t('insert.after')}</option>
          <option value="end">{t('insert.end')}</option>
        </select>
      </Field>
      {needPage && (
        <Field label={t('dialog.page')}>
          <input data-testid="insert-page" type="number" min={1} max={total} className={input} value={page} onChange={(e) => setPage(parseInt(e.target.value, 10) || 1)} />
        </Field>
      )}
      <Field label={t('dialog.source')}>
        <select className={input} value={kind} data-testid="dlg-ins-kind" onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="blank">{t('src.blank')}</option>
          <option value="image">{t('src.image')}</option>
          <option value="pdf">{t('src.pdf')}</option>
        </select>
      </Field>
      {kind === 'blank' && (
        <Field label={t('dialog.pageSize')}>
          <select data-testid="insert-blank-size" className={input} value={sizeKey} onChange={(e) => setSizeKey(e.target.value as typeof sizeKey)}>
            <option value="a4">{t('dialog.blankA4')}</option>
            <option value="letter">{t('dialog.blankLetter')}</option>
            <option value="a3">{t('dialog.blankA3')}</option>
          </select>
        </Field>
      )}
      {kind === 'blank' && (
        <Field label={t('dialog.orientation')}>
          <select data-testid="insert-orientation" className={input} value={orient} onChange={(e) => setOrient(e.target.value as typeof orient)}>
            <option value="portrait">{t('ori.portrait')}</option>
            <option value="landscape">{t('ori.landscape')}</option>
          </select>
        </Field>
      )}
      {kind === 'image' && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <button data-testid="insert-pick-image" type="button" className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50" onClick={async () => { const p = await window.pdfEditor.pickImage(); if (p) setImgPath(p) }}>{t('dialog.pickFile')}</button>
          <span className="truncate text-slate-500" data-testid="dlg-ins-img">{imgPath}</span>
        </div>
      )}
      {kind === 'pdf' && (
        <>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <button data-testid="insert-pick-pdf" type="button" className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50" onClick={async () => { const p = await window.pdfEditor.openPdfDialog(); if (p) setPdfPath(p) }}>{t('dialog.pickFile')}</button>
            <span className="truncate text-slate-500" data-testid="dlg-ins-pdf">{pdfPath}</span>
          </div>
          <label className="mb-3 flex items-center gap-2 text-sm"><input data-testid="insert-scale" type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} /> {t('dialog.scale')}</label>
        </>
      )}
      <button
        type="button"
        disabled={!can}
        data-testid="insert-run"
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40"
        onClick={async () => {
          setBusy(true)
          try {
            const [w, h] = BLANK_SIZES[sizeKey] as [number, number]
            const [bw, bh] = orient === 'landscape' ? [h, w] : [w, h]
            const source: InsertSource =
              kind === 'blank' ? { kind: 'blank', width: bw, height: bh }
              : kind === 'image' ? { kind: 'image', path: imgPath }
              : { kind: 'pdf', path: pdfPath, scale }
            await insertPages(position, needPage ? page : undefined, source)
          } finally { setBusy(false) }
        }}
      >
        {t('common.apply')}
      </button>
    </>
  )
}

function NumbersDialog({ total, pre }: { total: number; pre: string }): JSX.Element | null {
  const t = useT()
  const range = useRange(pre, total)
  const [position, setPosition] = useState<(typeof ANCHORS)[number]>('bottom-center')
  const [start, setStart] = useState(1)
  const [format, setFormat] = useState('{n}')
  const [busy, setBusy] = useState(false)
  const can = range.valid && !busy
  return (
    <>
      <Field label={t('pages.title')}>
        <input className={input} value={range.expr} data-testid="numbers-expr" onChange={(e) => range.setExpr(e.target.value)} />
      </Field>
      <Field label={t('dialog.position')}>
        <select className={input} value={position} data-testid="dlg-num-pos" onChange={(e) => setPosition(e.target.value as typeof position)}>
          {ANCHORS.map((a) => <option key={a} value={a}>{t(`num.${a.replace(/-(.)/g, (_, c) => c.toUpperCase())}`)}</option>)}
        </select>
      </Field>
      <Field label={t('dialog.format')}>
        <input className={input} value={format} data-testid="dlg-num-fmt" onChange={(e) => setFormat(e.target.value)} />
      </Field>
      <Field label={t('dialog.start')}>
        <input data-testid="numbers-start" type="number" className={input} value={start} onChange={(e) => setStart(parseInt(e.target.value, 10) || 1)} />
      </Field>
      <button
        type="button"
        disabled={!can}
        data-testid="numbers-run"
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40"
        onClick={async () => { setBusy(true); try { await addPageNumbers({ expr: range.expr, position, margin: 36, format, start, fontname: 'helv', fontsize: 10, color: '#000000' }) } finally { setBusy(false) } }}
      >
        {t('common.apply')}
      </button>
    </>
  )
}

const TITLES: Record<Kind, string> = { extract: 'pages.extract', split: 'pages.split', insert: 'pages.insert', numbers: 'pages.numbers', watermark: 'pages.watermark', images: 'images.title', flatten: 'flatten.title', export: 'tools.export' }

function WatermarkDialog({ total, pre }: { total: number; pre: string }): JSX.Element | null {
  const t = useT()
  const close = useUiStore((s) => s.closePagesDialog)
  const range = useRange(pre, total)
  const [text, setText] = useState('')
  const [angle, setAngle] = useState(45)
  const [opacity, setOpacity] = useState(0.2)
  const [tiled, setTiled] = useState(false)
  const [over, setOver] = useState(true)
  const [busy, setBusy] = useState(false)
  const can = range.valid && text.trim().length > 0 && !busy
  return (
    <>
      <Field label={t('pages.title')}>
        <input className={input} value={range.expr} data-testid="watermark-expr" onChange={(e) => range.setExpr(e.target.value)} />
      </Field>
      <Field label={t('wm.text')}>
        <input className={input} value={text} data-testid="wm-text" placeholder={t('wm.placeholder')} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label={t('wm.angle')}>
          <input type="number" className={input} value={angle} data-testid="wm-angle" min={-180} max={180} onChange={(e) => setAngle(Number(e.target.value))} />
        </Field>
        <Field label={t('wm.opacity')}>
          <input type="number" className={input} value={opacity} data-testid="wm-opacity" min={0} max={1} step={0.05} onChange={(e) => setOpacity(Number(e.target.value))} />
        </Field>
      </div>
      <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" data-testid="wm-tiled" checked={tiled} onChange={(e) => setTiled(e.target.checked)} /> {t('wm.tiled')}</label>
      <div className="mb-3 flex gap-3 text-sm">
        <label className="flex items-center gap-1"><input type="radio" name="wm-pos" data-testid="wm-over" checked={over} onChange={() => setOver(true)} /> {t('wm.over')}</label>
        <label className="flex items-center gap-1"><input type="radio" name="wm-pos" data-testid="wm-behind" checked={!over} onChange={() => setOver(false)} /> {t('wm.behind')}</label>
      </div>
      <p className="mb-3 text-xs text-slate-500">{t('wm.hint')}</p>
      <button
        type="button"
        disabled={!can}
        data-testid="watermark-run"
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40"
        onClick={async () => {
          setBusy(true)
          try {
            await applyWatermark({ kind: 'text', expr: range.expr, text, angle, opacity, tiled, overlay: over })
            close()
          } finally {
            setBusy(false)
          }
        }}
      >
        {t('common.apply')}
      </button>
    </>
  )
}

function ImagesDialog({ total, pre }: { total: number; pre: string }): JSX.Element | null {
  const t = useT()
  const close = useUiStore((s) => s.closePagesDialog)
  const addToast = useAppStore((s) => s.addToast)
  const range = useRange(pre, total)
  const [images, setImages] = useState<EmbeddedImage[] | null>(null)
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const can = range.valid && dir !== '' && !!images && images.length > 0 && !busy
  return (
    <>
      <Field label={t('pages.title')}>
        <input className={input} value={range.expr} data-testid="images-expr" onChange={(e) => range.setExpr(e.target.value)} />
      </Field>
      <button
        type="button"
        className="mb-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
        data-testid="img-list"
        disabled={!range.valid || busy}
        onClick={async () => {
          setBusy(true); setErr(null)
          try { setImages(await listEmbeddedImages(range.expr)) } catch { setErr(t('images.none')) } finally { setBusy(false) }
        }}
      >
        {t('images.list')}
      </button>
      <p className="mb-2 text-xs text-slate-500">{t('images.hint')}</p>
      {images && (
        images.length === 0 ? (
          <p className="mb-3 text-sm text-slate-500">{t('images.none')}</p>
        ) : (
          <table className="mb-3 w-full text-xs">
            <thead><tr className="text-left text-slate-500"><th className="py-0.5">{t('images.col.page')}</th><th>{t('images.col.size')}</th><th>{t('images.col.space')}</th></tr></thead>
            <tbody>
              {images.map((im, i) => (
                <tr key={i} data-testid={`img-row-${i}`}>
                  <td className="py-0.5">{im.page}</td>
                  <td>{im.width} × {im.height}</td>
                  <td className="truncate">{im.colorspace}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
      <Field label={t('dialog.dest')}><DirField value={dir} onChange={setDir} /></Field>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      <button
        type="button"
        disabled={!can}
        data-testid="images-run"
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40"
        onClick={async () => {
          setBusy(true)
          try {
            const n = await extractEmbeddedImages(range.expr, dir)
            addToast({ kind: 'success', message: t('images.done', { count: n }) })
            close()
          } finally { setBusy(false) }
        }}
      >
        {t('common.apply')}
      </button>
    </>
  )
}

function FlattenDialog(): JSX.Element | null {
  const t = useT()
  const close = useUiStore((s) => s.closePagesDialog)
  const addToast = useAppStore((s) => s.addToast)
  const [annots, setAnnots] = useState(true)
  const [forms, setForms] = useState(true)
  const [busy, setBusy] = useState(false)
  const cats = [annots ? 'annotations' : null, forms ? 'forms' : null].filter((x): x is string => x !== null)
  const can = cats.length > 0 && !busy
  return (
    <>
      <p className="mb-3 text-sm text-amber-700">{t('flatten.confirm')}</p>
      <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" data-testid="flat-annotations" checked={annots} onChange={(e) => setAnnots(e.target.checked)} /> {t('flatten.annotations')}</label>
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" data-testid="flat-forms" checked={forms} onChange={(e) => setForms(e.target.checked)} /> {t('flatten.forms')}</label>
      <p className="mb-3 text-xs text-slate-500">{t('flatten.stampsNote')}</p>
      <button
        type="button"
        disabled={!can}
        data-testid="flatten-run"
        className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-40"
        onClick={async () => {
          setBusy(true)
          try {
            await flatten(cats)
            addToast({ kind: 'success', message: t('flatten.done') })
            close()
          } finally { setBusy(false) }
        }}
      >
        {t('flatten.run')}
      </button>
    </>
  )
}

function ExportDialog({ total, pre }: { total: number; pre: string }): JSX.Element | null {
  const t = useT()
  const encrypted = useAppStore((s) => s.encrypted)
  const addToast = useAppStore((s) => s.addToast)
  const range = useRange(pre, total)
  const [mode, setMode] = useState<'images' | 'text' | 'compress' | 'linearise' | 'imagesToPdf'>('images')
  const [dir, setDir] = useState('')
  const [fmt, setFmt] = useState<'png' | 'jpeg'>('png')
  const [dpi, setDpi] = useState(150)
  const [textFmt, setTextFmt] = useState<'txt' | 'md'>('txt')
  const [quality, setQuality] = useState(60)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [imgPaths, setImgPaths] = useState<string[]>([])
  const [pageSize, setPageSize] = useState('auto')
  const [orient, setOrient] = useState('auto')
  const needRange = mode === 'images' || mode === 'text'
  const can = dir !== '' && (!needRange || range.valid) && !busy && !(mode === 'linearise' && encrypted) && (mode !== 'imagesToPdf' || imgPaths.length > 0)
  const run = async (): Promise<void> => {
    setBusy(true); setResult(null)
    try {
      if (mode === 'images') { const n = await exportImages(range.expr, dir, fmt, dpi); setResult(t('export.imagesDone').replace('{n}', String(n))) }
      else if (mode === 'text') { const p = await exportText(range.expr, dir, textFmt); setResult(p) }
      else if (mode === 'compress') { const r = await compressDoc(dir, dpi, quality); setResult(t('export.compressDone').replace('{pct}', String(Math.max(0, r.savedPercent)))) }
      else if (mode === 'imagesToPdf') { const r = await imagesToPdf(imgPaths, dir, pageSize, orient); setResult(r) }
      else { const r = await lineariseDoc(dir); setResult(r.path) }
      addToast({ kind: 'success', message: t('export.done') })
    } catch (e) {
      addToast({ kind: 'error', message: e instanceof Error ? e.message : t('export.failed') })
    } finally { setBusy(false) }
  }
  return (
    <>
      <Field label={t('export.what')}>
        <select className={input} data-testid="exp-what" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="images">{t('export.modeImages')}</option>
          <option value="text">{t('export.modeText')}</option>
          <option value="compress">{t('export.modeCompress')}</option>
          <option value="linearise">{t('export.modeLinearise')}</option>
          <option value="imagesToPdf">{t('export.modeImagesToPdf')}</option>
        </select>
      </Field>
      {needRange && (
        <Field label={t('dialog.range')}>
          <input className={input} value={range.expr} data-testid="export-expr" onChange={(e) => range.setExpr(e.target.value)} />
          {!range.valid && <span className="text-xs text-red-600">{t('pages.rangeInvalid').replace('{max}', String(total))}</span>}
        </Field>
      )}
      {mode === 'images' && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Field label={t('export.format')}>
            <select className={input} data-testid="exp-fmt" value={fmt} onChange={(e) => setFmt(e.target.value as 'png' | 'jpeg')}>
              <option value="png">PNG</option><option value="jpeg">JPEG</option>
            </select>
          </Field>
          <Field label={t('export.dpi')}>
            <select className={input} data-testid="exp-dpi" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
              {[72, 150, 300, 600].map((d) => <option key={d} value={d}>{d} DPI</option>)}
            </select>
          </Field>
        </div>
      )}
      {mode === 'text' && (
        <Field label={t('export.format')}>
          <select className={input} data-testid="exp-textfmt" value={textFmt} onChange={(e) => setTextFmt(e.target.value as 'txt' | 'md')}>
            <option value="txt">TXT</option><option value="md">Markdown</option>
          </select>
        </Field>
      )}
      {mode === 'compress' && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Field label={t('export.dpi')}>
            <select className={input} data-testid="exp-cdpi" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
              {[72, 150, 300].map((d) => <option key={d} value={d}>{d} DPI</option>)}
            </select>
          </Field>
          <Field label={t('export.quality')}>
            <input type="number" className={input} data-testid="exp-quality" value={quality} min={0} max={100} onChange={(e) => setQuality(Number(e.target.value))} />
          </Field>
        </div>
      )}
      {mode === 'imagesToPdf' && (
        <div className="mb-3 space-y-2">
          <div className="flex gap-2">
            <button type="button" className="whitespace-nowrap rounded-md border border-slate-300 px-3 text-sm hover:bg-slate-50" data-testid="exp-pick-images" onClick={async () => { const ps = await (window.pdfEditor.pickImages ? window.pdfEditor.pickImages() : Promise.resolve(null)); if (ps) setImgPaths(ps) }}>{t('export.pickImages')}</button>
            <span className="truncate self-center text-xs text-slate-500" data-testid="exp-img-count">{imgPaths.length ? `${imgPaths.length} ${t('export.filesSelected')}` : t('export.noFilesSelected')}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('export.pageSize')}>
              <select className={input} data-testid="exp-pagesize" value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                <option value="auto">{t('export.pageSizeAuto')}</option>
                <option value="a4">A4</option><option value="a3">A3</option><option value="letter">Letter</option><option value="legal">Legal</option>
              </select>
            </Field>
            <Field label={t('export.orientation')}>
              <select className={input} data-testid="exp-orient" value={orient} onChange={(e) => setOrient(e.target.value)}>
                <option value="auto">{t('export.orientationAuto')}</option>
                <option value="portrait">{t('export.orientationPortrait')}</option><option value="landscape">{t('export.orientationLandscape')}</option>
              </select>
            </Field>
          </div>
        </div>
      )}
      {mode === 'linearise' && encrypted && (
        <p className="mb-3 text-xs text-amber-700" data-testid="exp-enc-hint">{t('export.lineariseEncrypted')}</p>
      )}
      <Field label={t('dialog.dest')}><DirField value={dir} onChange={setDir} /></Field>
      {result && <p className="mb-2 truncate text-xs text-emerald-700" data-testid="exp-result" title={result}>{result}</p>}
      <button type="button" disabled={!can} data-testid="export-run" className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40" onClick={() => void run()}>{t('export.run')}</button>
    </>
  )
}


export function PagesDialogs(): JSX.Element | null {
  const t = useT()
  const kind = useUiStore((s) => s.pagesDialog)
  const preset = useUiStore((s) => s.pagesDialogPreset)
  const close = useUiStore((s) => s.closePagesDialog)
  const pageCount = useAppStore((s) => s.pageCount)
  const currentPage = useAppStore((s) => s.currentPage)
  const selected = useUiStore((s) => s.selected)
  if (!kind) return null
  const pre = selected.length > 0 ? selectionExpr(selected) : String(currentPage)
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t(TITLES[kind])} onClick={close}>
      <div className="w-[26rem] rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t(TITLES[kind])}</h2>
          <button type="button" aria-label={t('common.close')} data-testid="dlg-close" onClick={close} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>
        {kind === 'extract' && <ExtractDialog total={pageCount} pre={pre} />}
        {kind === 'split' && <SplitDialog total={pageCount} {...(preset?.mode ? { presetMode: preset.mode } : {})} {...(preset?.page !== undefined ? { presetPage: preset.page } : {})} />}
        {kind === 'insert' && <InsertDialog total={pageCount} {...(preset?.position ? { presetPosition: preset.position } : {})} {...(preset?.page !== undefined ? { presetPage: preset.page } : {})} />}
        {kind === 'numbers' && <NumbersDialog total={pageCount} pre={pre} />}
        {kind === 'watermark' && <WatermarkDialog total={pageCount} pre={pre} />}
        {kind === 'images' && <ImagesDialog total={pageCount} pre={pre} />}
        {kind === 'flatten' && <FlattenDialog />}
        {kind === 'export' && <ExportDialog total={pageCount} pre={pre} />}
      </div>
    </div>
  )
}
