import { useEffect } from 'react'
import { FileText, FolderOpen } from 'lucide-react'
import { useT } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'
import { useAppStore } from '@/store/useAppStore'
import { openDocument } from '@/lib/documents'

// Zuletzt geoeffnete Dateien (Section 4). Leere Zustand + Dateimenue. Fehlende Dateien sind
// ausgegraut und werden beim Klick entfernt (+ Toast). Es stehen nur Pfade/Zeitstempel hier.

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

export function RecentFiles(): JSX.Element {
  const t = useT()
  const recent = useUiStore((s) => s.recent)
  const loadRecent = useUiStore((s) => s.loadRecent)
  const addToast = useAppStore((s) => s.addToast)

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  const onOpenDialog = async (): Promise<void> => {
    const p = await window.pdfEditor.openPdfDialog()
    if (p) void openDocument(p)
  }

  const onClick = async (path: string, exists: boolean): Promise<void> => {
    if (exists) {
      void openDocument(path)
      return
    }
    await window.pdfEditor.removeRecent(path)
    await loadRecent()
    addToast({ kind: 'info', message: `${basename(path)} ${t('recents.gone')}` })
  }

  return (
    <div className="mx-auto w-full max-w-lg py-10" data-testid="recent-files">
      <h2 className="mb-3 text-lg font-semibold text-slate-800">{t('recents.title')}</h2>
      <button
        type="button"
        onClick={() => void onOpenDialog()}
        className="mb-4 inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        data-testid="recent-open"
      >
        <FolderOpen size={16} /> {t('recents.openOther')}
      </button>
      {recent.length === 0 ? (
        <p className="text-sm text-slate-400">{t('recents.hint')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {recent.map((e) => (
            <li key={e.path}>
              <button data-testid={`recent-item-${e.path}`}
                type="button"
                onClick={() => void onClick(e.path, e.exists)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${e.exists ? 'text-slate-700' : 'text-slate-300 line-through'}`}
                title={e.path}
              >
                <FileText size={15} className="shrink-0" />
                <span className="truncate">{basename(e.path)}</span>
                {!e.exists ? <span className="ml-auto shrink-0 text-xs">{t('recents.gone')}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
