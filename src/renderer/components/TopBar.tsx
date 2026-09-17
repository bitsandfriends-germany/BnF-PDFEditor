import { useEffect, useState } from 'react'
import { FolderOpen, Save, SaveAll, Printer, Undo2, Redo2, ZoomIn, ZoomOut, RotateCcw, RotateCw, Sun, Moon, Contrast, Maximize, Hand, MousePointer2 } from 'lucide-react'
import { useT } from '@/i18n'
import { Tooltip } from '@/components/Tooltip'
import { shellTooltipKey } from '@/lib/tooltips'
import { useAppStore, performUndo, performRedo } from '@/store/useAppStore'
import { useUiStore, clampPage } from '@/store/useUiStore'
import { openDocument, saveDocument } from '@/lib/documents'
import { FileMenu } from '@/components/FileMenu'

// Top-Leiste nach Section 4A. Jeder Button: aria-label + nativer Tooltip (title), asynchroner
// Aktionen sperren den Klick, solange sie laufen. Read-Only deaktiviert alle mutierenden Buttons.

export function TopBar(): JSX.Element {
  const t = useT()
  const { readOnly, docOpen, dirty, pageCount, currentPage, canUndo, canRedo, mutationLock, setCurrentPage } = useAppStore()
  // R75: Hilfetext fuer ein Shell-Element (testid -> i18n-Schluessel).
  const shellTip = (testid: string): string => {
    const key = shellTooltipKey(testid)
    return key === '' ? '' : t(key)
  }

  const { zoom, zoomMode, setZoom, zoomIn, zoomOut, pageFlash, viewRotation, invertPage, theme, layoutMode, rotateView, setLayoutMode, toggleTheme, toggleInvertPage, toggleFullScreen, viewerMode, setViewerMode } = useUiStore()
  const [busy, setBusy] = useState(false)
  const [pageText, setPageText] = useState(String(currentPage))

  // R73 Nutzerbefund ("... liefert nur die ersten Seiten"): Die Seitenzahl-Anzeige blieb stehen,
  // wenn die Seite von AUSSEN wechselte (Scroll-Spy beim Blaettern, Thumbnail-Klick, Pfeile,
  // Layout-Wechsel). Sie folgt jetzt der aktuellen Seite — ausser der Nutzer tippt gerade hinein.
  useEffect(() => {
    const el = document.activeElement as HTMLElement | null
    if (el?.getAttribute('data-testid') === 'tb-page-input') return
    setPageText(String(currentPage))
  }, [currentPage])

  const disabledByLock = mutationLock

  const onOpen = async (): Promise<void> => {
    const path = await window.pdfEditor.openPdfDialog()
    if (!path) return
    setBusy(true)
    try {
      await openDocument(path)
    } finally {
      setBusy(false)
    }
  }

  const onSave = async (): Promise<void> => {
    setBusy(true)
    try {
      await saveDocument('save')
    } finally {
      setBusy(false)
    }
  }

  const commitPage = (raw: string): void => {
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n)) {
      useUiStore.getState().flashPage()
      setPageText(String(currentPage))
      return
    }
    const clamped = clampPage(n, pageCount)
    if (clamped !== n) useUiStore.getState().flashPage()
    setCurrentPage(clamped)
    setPageText(String(clamped))
  }

  const selectZoom = (mode: 'fitWidth' | 'fitPage' | 'custom', value: number): void => {
    if (mode === 'custom') setZoom(value, 'custom')
    else setZoom(zoom, mode)
  }

  const zoomSelectValue = zoomMode !== 'custom' ? zoomMode : String(Math.round(zoom * 100))

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
      <FileMenu />
      <Tooltip text={shellTip('tb-open')} testid="tip-tb-open">
        <button data-testid="tb-open"
        type="button"
        aria-label={t('common.open')}
        onClick={() => void onOpen()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
      >
        <FolderOpen size={16} /> {busy ? t('common.opening') : t('common.open')}
      </button>
      </Tooltip>
      <Tooltip text={shellTip('btn-save')} testid="tip-btn-save">
        <button
        type="button"
        data-testid="btn-save"
        aria-label={t('common.save')}
        onClick={() => void onSave()}
        disabled={!docOpen || readOnly || busy || disabledByLock}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
      >
        <Save size={16} /> {t('common.save')}
        {dirty ? <span className="ml-0.5 text-slate-400">•</span> : null}
      </button>
      </Tooltip>
      <Tooltip text={shellTip('tb-save-as')} testid="tip-tb-save-as">
        <button
        type="button"
        data-testid="tb-save-as"
        aria-label={t('sc.saveAs')}
        onClick={() => { void saveDocument('as') }}
        disabled={!docOpen || readOnly || busy || disabledByLock}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
      >
        <SaveAll size={16} /> {t('sc.saveAs')}
      </button>
      </Tooltip>
      <Tooltip text={shellTip('tb-print')} testid="tip-tb-print">
        <button data-testid="tb-print"
        type="button"
        aria-label={t('common.print')}
        disabled
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm opacity-50"
      >
        <Printer size={16} />
      </button>
      </Tooltip>

      <div className="mx-2 h-6 w-px bg-slate-200" aria-hidden />

      <Tooltip text={shellTip('tb-undo')} testid="tip-tb-undo">
        <button data-testid="tb-undo" type="button" aria-label={t('undo.undo')} onClick={() => void performUndo()} disabled={!canUndo || disabledByLock} className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500">
        <Undo2 size={16} />
      </button>
      </Tooltip>
      <Tooltip text={shellTip('tb-redo')} testid="tip-tb-redo">
        <button data-testid="tb-redo" type="button" aria-label={t('undo.redo')} onClick={() => void performRedo()} disabled={!canRedo || disabledByLock} className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500">
        <Redo2 size={16} />
      </button>
      </Tooltip>

      <div className="mx-2 h-6 w-px bg-slate-200" aria-hidden />

      <nav className="flex items-center gap-1" aria-label={t('pagination.page')}>
        <Tooltip text={shellTip('tb-page-prev')} testid="tip-tb-page-prev">
          <button data-testid="tb-page-prev" type="button" aria-label="prev" onClick={() => setCurrentPage(currentPage - 1)} disabled={!docOpen || currentPage <= 1} className="rounded px-1.5 py-0.5 hover:bg-slate-100 disabled:opacity-40">&lt;</button>
        </Tooltip>
        <Tooltip text={shellTip('tb-page-input')} testid="tip-tb-page-input">
          <input data-testid="tb-page-input"
          type="text"
          inputMode="numeric"
          value={pageText}
          aria-label={t('pagination.goto', { page: currentPage })}
          onChange={(e) => setPageText(e.target.value)}
          onBlur={(e) => commitPage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitPage((e.target as HTMLInputElement).value)
          }}
          className={`w-12 rounded border px-1.5 py-0.5 text-center text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${pageFlash ? 'border-red-500 ring-1 ring-red-400' : 'border-slate-300'}`}
        />
        </Tooltip>
        <span className="text-sm text-slate-500" data-testid="page-count">/ {pageCount}</span>
        <Tooltip text={shellTip('tb-page-next')} testid="tip-tb-page-next">
          <button data-testid="tb-page-next" type="button" aria-label="next" onClick={() => setCurrentPage(currentPage + 1)} disabled={!docOpen || currentPage >= pageCount} className="rounded px-1.5 py-0.5 hover:bg-slate-100 disabled:opacity-40">&gt;</button>
        </Tooltip>
      </nav>

      <div className="mx-2 h-6 w-px bg-slate-200" aria-hidden />

      <div className="flex items-center gap-1" role="group" aria-label={t('toolbar.zoomLevel')}>
        <Tooltip text={shellTip('tb-zoom-out')} testid="tip-tb-zoom-out">
          <button data-testid="tb-zoom-out" type="button" aria-label={t('toolbar.zoomOut')} onClick={zoomOut} className="rounded p-1 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500">
          <ZoomOut size={16} />
        </button>
        </Tooltip>
        <Tooltip text={shellTip('tb-zoom-select')} testid="tip-tb-zoom-select">
          <select data-testid="tb-zoom-select"
          aria-label={t('toolbar.zoomLevel')}
          value={zoomSelectValue}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'fitWidth') selectZoom('fitWidth', zoom)
            else if (v === 'fitPage') selectZoom('fitPage', zoom)
            else selectZoom('custom', Number.parseInt(v, 10) / 100)
          }}
          className="rounded border border-slate-300 px-1.5 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
        >
          <option value="fitWidth">{t('toolbar.fitWidth')}</option>
          <option value="fitPage">{t('toolbar.fitPage')}</option>
          <option value="50">50 %</option>
          <option value="100">100 %</option>
          <option value="150">150 %</option>
          <option value="200">200 %</option>
        </select>
        </Tooltip>
        <Tooltip text={shellTip('tb-zoom-in')} testid="tip-tb-zoom-in">
          <button data-testid="tb-zoom-in" type="button" aria-label={t('toolbar.zoomIn')} onClick={zoomIn} className="rounded p-1 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500">
          <ZoomIn size={16} />
        </button>
        </Tooltip>
        <span className="ml-1 w-12 text-right text-sm tabular-nums text-slate-600">{Math.round(zoom * 100)} %</span>
      </div>

      <div className="mx-2 h-6 w-px bg-slate-200" aria-hidden />

      {/* R60 Nutzerwunsch: Makieren (Hand: Ziehen = blättern) und Text (Cursor:
          markieren/kopieren) als explizite, umschaltbare Modi. */}
      <div className="flex items-center gap-1" role="group" aria-label={t('toolbar.modes')}>
        <Tooltip text={shellTip('tb-mode-hand')} testid="tip-tb-mode-hand">
          <button type="button" data-testid="tb-mode-hand" aria-pressed={viewerMode === 'pan'}
          onClick={() => setViewerMode('pan')}
          className={`rounded p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${viewerMode === 'pan' ? 'bg-sky-100 text-sky-800 dark:bg-slate-700 dark:text-sky-300' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
          <Hand size={16} />
        </button>
        </Tooltip>
        <Tooltip text={shellTip('tb-mode-text')} testid="tip-tb-mode-text">
          <button type="button" data-testid="tb-mode-text" aria-pressed={viewerMode === 'text'}
          onClick={() => setViewerMode('text')}
          className={`rounded p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${viewerMode === 'text' ? 'bg-sky-100 text-sky-800 dark:bg-slate-700 dark:text-sky-300' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
          <MousePointer2 size={16} />
        </button>
        </Tooltip>
      </div>

      <div className="mx-2 h-6 w-px bg-slate-200" aria-hidden />

      <div className="flex items-center gap-1" role="group" aria-label={t('view.rotateRight')}>
        <Tooltip text={shellTip('view-rot-left')} testid="tip-view-rot-left">
          <button type="button" title={t('view.rotateLeft')} aria-label={t('view.rotateLeft')} data-testid="view-rot-left" onClick={() => rotateView(-1)} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700"><RotateCcw size={16} /></button>
        </Tooltip>
        <Tooltip text={shellTip('view-rot-right')} testid="tip-view-rot-right">
          <button type="button" title={t('view.rotateRight')} aria-label={t('view.rotateRight')} data-testid="view-rot-right" onClick={() => rotateView(1)} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700"><RotateCw size={16} /></button>
        </Tooltip>
        {viewRotation !== 0 ? (
          <span data-testid="view-rotation-badge" title={t('view.invert')} className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800" role="status">{t('view.rotation', { deg: viewRotation })}</span>
        ) : null}
      </div>

      <div className="mx-2 h-6 w-px bg-slate-200" aria-hidden />

      <Tooltip text={shellTip('layout-select')} testid="tip-layout-select">
          <select
        aria-label={t('layout.mode')}
        title={t('layout.mode')}
        data-testid="layout-select"
        value={layoutMode}
        onChange={(e) => setLayoutMode(e.target.value as 'single' | 'continuous' | 'facing' | 'facing-cover')}
        className="rounded border border-slate-300 px-1.5 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-600"
      >
        <option value="single">{t('layout.single')}</option>
        <option value="continuous">{t('layout.continuous')}</option>
        <option value="facing">{t('layout.facing')}</option>
        <option value="facing-cover">{t('layout.facingCover')}</option>
      </select>
        </Tooltip>

      <div className="mx-2 h-6 w-px bg-slate-200" aria-hidden />

      <div className="flex items-center gap-1" role="group" aria-label={t('view.fullscreen')}>
        <Tooltip text={shellTip('view-theme')} testid="tip-view-theme">
          <button type="button" title={theme === 'dark' ? t('view.themeLight') : t('view.themeDark')} aria-label={t('view.themeDark')} data-testid="view-theme" onClick={toggleTheme} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
        </Tooltip>
        <Tooltip text={shellTip('view-invert')} testid="tip-view-invert">
          <button type="button" title={t('view.invert')} aria-label={t('view.invert')} data-testid="view-invert" aria-pressed={invertPage} onClick={toggleInvertPage} className={`rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700 ${invertPage ? 'text-sky-600' : ''}`}><Contrast size={16} /></button>
        </Tooltip>
        <Tooltip text={shellTip('view-fullscreen')} testid="tip-view-fullscreen">
          <button type="button" title={t('view.fullscreen')} aria-label={t('view.fullscreen')} data-testid="view-fullscreen" onClick={toggleFullScreen} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700"><Maximize size={16} /></button>
        </Tooltip>
      </div>

      {readOnly ? (
        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" role="status">
          {t('common.readOnly')}
        </span>
      ) : null}
      <div className="flex-1" />
    </header>
  )
}
