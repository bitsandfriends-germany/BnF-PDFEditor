import { useEffect, useRef, useState } from 'react'
import { FileText, FolderOpen, Save, SaveAll, Copy, X, ChevronDown } from 'lucide-react'
import { useT } from '@/i18n'
import { Tooltip } from '@/components/Tooltip'
import { commandTooltipKey } from '@/lib/tooltips'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { openDocument } from '@/lib/documents'
import { getCommand, liveCommandContext } from '@/lib/commands'

// Datei-Menue (Section 4): Oeffnen, Zuletzt geoeffnet, Speichern / Speichern unter / Kopie
// speichern, Schliessen. Kopie speichern ist der eigene "Save a Copy"-Eintrag (ohne Rebind).
// Schliessen fuehrt bei ungespeicherten Aenderungen den 3-Optionen-Dialog.

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

const itemCls = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent'

export function FileMenu(): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const addToast = useAppStore((s) => s.addToast)
  const recent = useUiStore((s) => s.recent)
  const loadRecent = useUiStore((s) => s.loadRecent)

  useEffect(() => {
    if (!open) return
    void loadRecent()
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, loadRecent])

  const act = (fn: () => void): void => {
    setOpen(false)
    fn()
  }

  // §7.6: Das Menü BAR ruft Befehle der Command-Registry auf — keine zweite Aktions-Definition.
  const runCmd = (id: string): void => act(() => { getCommand(id)?.run(liveCommandContext()) })
  const cmdOff = (id: string): boolean => {
    const c = getCommand(id)
    return c === undefined || !c.isEnabled(liveCommandContext())
  }

  const onRecent = async (path: string, exists: boolean): Promise<void> => {
    setOpen(false)
    if (exists) {
      void openDocument(path)
      return
    }
    await window.pdfEditor.removeRecent(path)
    await loadRecent()
    addToast({ kind: 'info', message: `${basename(path)} ${t('recents.gone')}` })
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="file-menu-button"
        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
      >
        {t('menu.file')} <ChevronDown size={14} aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-72 rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          <Tooltip variant="native" text={t(commandTooltipKey('file.open'))} className="w-full">
            <button role="menuitem" type="button" className={itemCls} data-testid="menu-open" onClick={() => runCmd('file.open')}>
            <FolderOpen size={15} /> {t('common.open')}
          </button>
          </Tooltip>
          <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
          <div className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-400">{t('recents.title')}</div>
          {recent.length === 0 ? (
            <div className="px-3 py-1 text-sm text-slate-400">{t('recents.hint')}</div>
          ) : (
            recent.map((e) => (
              <button data-testid={`menu-recent-${e.path}`}
                key={e.path}
                role="menuitem"
                type="button"
                onClick={() => void onRecent(e.path, e.exists)}
                title={e.path}
                className={`${itemCls} ${e.exists ? '' : 'text-slate-300 line-through dark:text-slate-500'}`}
              >
                <FileText size={15} className="shrink-0" /> <span className="truncate">{basename(e.path)}</span>
              </button>
            ))
          )}
          <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
          <Tooltip variant="native" text={t(commandTooltipKey('file.save'))} className="w-full">
            <button role="menuitem" type="button" className={itemCls} data-testid="menu-save" disabled={cmdOff('file.save')} onClick={() => runCmd('file.save')}>
            <Save size={15} /> {t('common.save')}
          </button>
          </Tooltip>
          <Tooltip variant="native" text={t(commandTooltipKey('file.saveAs'))} className="w-full">
            <button role="menuitem" type="button" className={itemCls} data-testid="menu-save-as" disabled={cmdOff('file.saveAs')} onClick={() => runCmd('file.saveAs')}>
            <SaveAll size={15} /> {t('sc.saveAs')}
          </button>
          </Tooltip>
          <Tooltip variant="native" text={t(commandTooltipKey('file.saveCopy'))} className="w-full">
            <button role="menuitem" type="button" className={itemCls} data-testid="menu-save-copy" disabled={cmdOff('file.saveCopy')} onClick={() => runCmd('file.saveCopy')}>
            <Copy size={15} /> {t('common.saveCopy')}
          </button>
          </Tooltip>
          <Tooltip variant="native" text={t(commandTooltipKey('file.close'))} className="w-full">
            <button role="menuitem" type="button" className={itemCls} data-testid="menu-close" disabled={cmdOff('file.close')} onClick={() => runCmd('file.close')}>
            <X size={15} /> {t('menu.close')}
          </button>
          </Tooltip>
        </div>
      ) : null}
    </div>
  )
}
