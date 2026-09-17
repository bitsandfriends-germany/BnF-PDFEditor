import { useCallback, useEffect, useState } from 'react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { getAnnotation, editAnnotation, deleteAnnotation, type AnnotationDetail } from '@/lib/documents'

// Editor fuer eine einzelne Annotation (Section 8: select/move/restyle/delete). Auswahl kommt aus
// der Liste; Bewegen/Resizen ueber "Position neu setzen" (Overlay-Rechteck -> absoluter rect).

const input = 'w-full rounded border border-slate-300 px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-600'
const btn = 'rounded-md px-2 py-1 text-xs'

export function AnnotationEditor({ id }: { id: string }): JSX.Element | null {
  const t = useT()
  const readOnly = useAppStore((s) => s.readOnly)
  const docVersion = useAppStore((s) => s.docVersion)
  const armReposition = useUiStore((s) => s.armReposition)
  const setSelected = useUiStore((s) => s.setSelectedAnnotationId)

  const [detail, setDetail] = useState<AnnotationDetail | null>(null)
  const [text, setText] = useState('')
  const [author, setAuthor] = useState('')
  const [color, setColor] = useState('#ff0000')
  const [opacity, setOpacity] = useState(1)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const d = await getAnnotation(id)
      setDetail(d)
      setText(d.text)
      setAuthor(d.author)
      if (d.color) setColor(d.color)
      setOpacity(d.opacity ?? 1)
    } catch {
      setDetail(null)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load, docVersion])

  if (!detail) return null
  const can = !readOnly && !busy

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      if (await editAnnotation(id, { text, author, color, opacity })) await load()
    } finally {
      setBusy(false)
    }
  }
  const del = async (): Promise<void> => {
    setBusy(true)
    try {
      if (await deleteAnnotation(id)) setSelected(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-slate-200 p-2 text-sm dark:border-slate-700" data-testid="ann-editor">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">{detail.type}</span>
        <button type="button" className="text-xs text-slate-500 hover:underline" data-testid="ann-editor-close" onClick={() => setSelected(null)}>{t('common.close')}</button>
      </div>
      <label className="mb-1.5 block text-xs">
        <span className="mb-0.5 block text-slate-500">{t('annotations.text')}</span>
        <textarea className={input} data-testid="ann-edit-text" rows={2} value={text} disabled={!can} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="mb-1.5 grid grid-cols-3 gap-1.5">
        <label className="text-xs">
          <span className="mb-0.5 block text-slate-500">{t('annotations.author')}</span>
          <input className={input} data-testid="ann-edit-author" value={author} disabled={!can} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="mb-0.5 block text-slate-500">{t('annotations.color')}</span>
          <input type="color" className="h-7 w-full rounded border border-slate-300 dark:border-slate-600" data-testid="ann-edit-color" value={color} disabled={!can} onChange={(e) => setColor(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="mb-0.5 block text-slate-500">{t('annotations.opacity')}</span>
          <input type="number" className={input} data-testid="ann-edit-opacity" value={opacity} min={0} max={1} step={0.1} disabled={!can} onChange={(e) => setOpacity(Number(e.target.value))} />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={!can} data-testid="ann-edit-save" onClick={() => void save()} className={`${btn} bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40`}>{t('common.save')}</button>
        <button type="button" disabled={!can} data-testid="ann-edit-reposition" onClick={() => armReposition(id)} className={`${btn} border border-slate-300 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600`}>{t('annotations.reposition')}</button>
        <button type="button" disabled={!can} data-testid="ann-edit-delete" onClick={() => void del()} className={`${btn} bg-red-600 text-white hover:bg-red-700 disabled:opacity-40`}>{t('common.delete')}</button>
      </div>
    </div>
  )
}
