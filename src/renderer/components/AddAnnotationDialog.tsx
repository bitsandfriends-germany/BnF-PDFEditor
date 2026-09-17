import { useEffect, useState } from 'react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { addAnnotation } from '@/lib/documents'

// Anlage-Dialog (Section 8.b): uebernimmt das per Overlay gezogene Rechteck und die per-
// Typ-Eigenschaften (Farbe, Deckkraft, Schriftgroesse bei Freitext) sowie Autor/Notiztext.
// Der Autor ist vorbelegt mit dem Systemnutzer (PlatformInfo.username), aber editierbar —
// §8 fordert "Autor aus Einstellungen, Standard Systemnutzer".

const input = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500'

export function AddAnnotationDialog(): JSX.Element | null {
  const t = useT()
  const target = useUiStore((s) => s.markupTarget)
  const cancel = useUiStore((s) => s.cancelMarkup)
  const author = useUiStore((s) => s.markupAuthor)
  const setAuthor = useUiStore((s) => s.setMarkupAuthor)
  const currentPage = useAppStore((s) => s.currentPage)
  const addToast = useAppStore((s) => s.addToast)

  const [text, setText] = useState('')
  const [color, setColor] = useState('#ffd400')
  const [opacity, setOpacity] = useState(1)
  const [fontsize, setFontsize] = useState(12)
  const [busy, setBusy] = useState(false)

  // Autor vorbelegen, sobald der Dialog das erste Mal offen ist und noch keiner gesetzt ist.
  useEffect(() => {
    if (target && !author && window.pdfEditor?.getPlatformInfo) {
      window.pdfEditor.getPlatformInfo().then((p) => setAuthor(p.username || '')).catch(() => {})
    }
  }, [target, author, setAuthor])

  if (!target) return null
  const kind = target.kind
  const needsText = kind === 'Text' || kind === 'FreeText'

  const can = !busy && (!needsText || text.trim().length > 0)

  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      const done = await addAnnotation({
        page0: currentPage - 1,
        type: kind,
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
        text: text.trim(),
        color,
        opacity,
        author,
        fontsize
      })
      if (done) addToast({ kind: 'success', message: t('annotations.added') })
      cancel()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t('annotations.new')} onClick={cancel}>
      <div className="w-[24rem] rounded-lg bg-white p-4 shadow-xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-base font-semibold">{t('annotations.new')}</h2>

        {needsText ? (
          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('annotations.text')}</span>
            <textarea className={input} data-testid="ann-add-text" rows={3} autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        ) : null}

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('annotations.color')}</span>
            <input type="color" className="h-9 w-full rounded border border-slate-300 dark:border-slate-600" data-testid="ann-add-color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('annotations.opacity')}</span>
            <input type="number" className={input} data-testid="ann-add-opacity" value={opacity} min={0} max={1} step={0.1} onChange={(e) => setOpacity(Number(e.target.value))} />
          </label>
        </div>

        {kind === 'FreeText' ? (
          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('annotations.fontsize')}</span>
            <input type="number" className={input} data-testid="ann-add-fontsize" value={fontsize} min={1} onChange={(e) => setFontsize(Number(e.target.value))} />
          </label>
        ) : null}

        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">{t('annotations.author')}</span>
          <input className={input} data-testid="ann-add-author" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" data-testid="ann-add-cancel" onClick={cancel} className="rounded-md px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-700">
            {t('common.cancel')}
          </button>
          <button type="button" disabled={!can} data-testid="ann-add-apply" onClick={() => void apply()} className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40">
            {t('annotations.add')}
          </button>
        </div>
      </div>
    </div>
  )
}
