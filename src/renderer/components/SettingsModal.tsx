import { useEffect, useState } from 'react'
import { useT, useI18n, type Lang } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'
import { Tooltip } from '@/components/Tooltip'
import { shellTooltipKey } from '@/lib/tooltips'

// Settings-Modal (Section 5.2 + 4D). Allgemein: Sprache + "Undo-Verlauf auf Platte". Der KI-Tab
// zeigt den Konfigurations-Einstieg; die volle Endpunkt-Verwaltung (GET /models, PUT /config/ai,
// Test, Key-Endpoints) folgt in Step 10 auf diesem Platzhalter-freien Grundgeruest.

type SettingsTab = 'general' | 'ai'

export function SettingsModal(): JSX.Element | null {
  const t = useT()
  const open = useUiStore((s) => s.settingsOpen)
  const close = useUiStore((s) => s.closeSettings)
  const undoOnDisk = useUiStore((s) => s.undoOnDisk)
  const setUndoOnDisk = useUiStore((s) => s.setUndoOnDisk)
  const lang = useI18n((s) => s.lang)
  const setLang = useI18n((s) => s.setLang)
  const tooltips = useUiStore((s) => s.tooltips)
  const setTooltips = useUiStore((s) => s.setTooltips)
  const renderInfo = useUiStore((s) => s.renderInfo)
  const loadAppSettings = useUiStore((s) => s.loadAppSettings)
  const [tab, setTab] = useState<SettingsTab>('general')

  // R75: Einstellungen beim Oeffnen frisch lesen (Render-Modus + Tooltips kommen aus dem Main-Prozess).
  useEffect(() => {
    if (open) void loadAppSettings()
  }, [open, loadAppSettings])

  const shellTip = (testid: string): string => {
    const key = shellTooltipKey(testid)
    return key === '' ? '' : t(key)
  }

  // R75: Rendering umschalten. Die Aenderung wirkt nach dem Neustart (Hardware-Beschleunigung ist
  // zur Laufzeit nicht umschaltbar) — deshalb der Hinweis unter der Auswahl.
  const onRenderMode = async (mode: 'auto' | 'gpu' | 'software'): Promise<void> => {
    const bridge = window.pdfEditor as unknown as { setAppSettings?: (p: unknown) => Promise<unknown> }
    if (!bridge?.setAppSettings) return
    await bridge.setAppSettings({ renderMode: mode })
    await loadAppSettings()
  }
  const onTooltips = async (v: boolean): Promise<void> => {
    setTooltips(v)
    const bridge = window.pdfEditor as unknown as { setAppSettings?: (p: unknown) => Promise<unknown> }
    if (bridge?.setAppSettings) await bridge.setAppSettings({ tooltips: v })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t('settings.title')} onClick={close}>
      <div className="flex max-h-[80vh] w-[36rem] flex-col overflow-hidden rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold">{t('settings.title')}</h2>
          <button data-testid="settings-close" type="button" onClick={close} aria-label={t('settings.close')} className="rounded px-2 py-1 text-sm hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="flex gap-1 border-b border-slate-200 px-2 pt-2" role="tablist">
          <Tooltip text={t('settings.tab.general')} testid="tip-settings-tab-general">
            <button data-testid="settings-tab-general" type="button" role="tab" aria-selected={tab === 'general'} onClick={() => setTab('general')} className={`rounded-t-md px-3 py-1.5 text-sm ${tab === 'general' ? 'bg-white font-medium text-sky-700 ring-1 ring-slate-200' : 'text-slate-600 hover:bg-slate-50'}`}>
              {t('settings.tab.general')}
            </button>
          </Tooltip>
          <Tooltip text={t('settings.tab.ai')} testid="tip-settings-tab-ai">
            <button data-testid="settings-tab-ai" type="button" role="tab" aria-selected={tab === 'ai'} onClick={() => setTab('ai')} className={`rounded-t-md px-3 py-1.5 text-sm ${tab === 'ai' ? 'bg-white font-medium text-sky-700 ring-1 ring-slate-200' : 'text-slate-600 hover:bg-slate-50'}`}>
              {t('settings.tab.ai')}
            </button>
          </Tooltip>
        </div>
        <div className="min-h-40 flex-1 overflow-auto p-4">
          {tab === 'general' ? (
            <div className="space-y-5">
              <label className="flex items-center justify-between gap-4 text-sm">
                {t('settings.language')}
                <Tooltip text={shellTip('settings-lang')} testid="tip-settings-lang">
                  <select data-testid="settings-lang"
                    value={lang}
                    aria-label={t('settings.language')}
                    onChange={(e) => setLang(e.target.value as Lang)}
                    className="rounded border border-slate-300 px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                  >
                    <option value="de">Deutsch</option>
                    <option value="en">English</option>
                  </select>
                </Tooltip>
              </label>

              {/* R75 Nutzerwunsch: Rendering automatisch/GPU/Software waehlbar. */}
              <div className="space-y-1 border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span>{t('settings.rendering')}</span>
                  <Tooltip text={shellTip('settings-render-mode')} testid="tip-settings-render-mode">
                    <select data-testid="settings-render-mode"
                      value={renderInfo?.mode ?? 'auto'}
                      aria-label={t('settings.rendering')}
                      onChange={(e) => void onRenderMode(e.target.value as 'auto' | 'gpu' | 'software')}
                      className="rounded border border-slate-300 px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                    >
                      <option value="auto">{t('settings.render.auto')}</option>
                      <option value="gpu">{t('settings.render.gpu')}</option>
                      <option value="software">{t('settings.render.software')}</option>
                    </select>
                  </Tooltip>
                </div>
                <p className="text-xs text-slate-500" data-testid="settings-render-hint">{t('settings.render.hint')}</p>
                {renderInfo ? (
                  <p className="text-xs text-slate-600" data-testid="settings-render-effective">
                    {t('settings.render.effective', { mode: renderInfo.effective === 'gpu' ? t('settings.render.gpu') : t('settings.render.software') })}
                    {renderInfo.gpuFailures > 0 ? ` · ${t('settings.render.gpuFailures', { n: renderInfo.gpuFailures })}` : ''}
                  </p>
                ) : null}
                <p className="text-xs text-amber-600" data-testid="settings-render-restart">{t('settings.render.restart')}</p>
              </div>

              {/* R75: Tooltips an/aus. */}
              <div className="space-y-1 border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span>{t('settings.tooltips')}</span>
                  <Tooltip text={shellTip('settings-tooltips')} testid="tip-settings-tooltips">
                    <input data-testid="settings-tooltips" type="checkbox" checked={tooltips} aria-label={t('settings.tooltips')} onChange={(e) => void onTooltips(e.target.checked)} />
                  </Tooltip>
                </div>
                <p className="text-xs text-slate-500">{t('settings.tooltips.hint')}</p>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-4 text-sm">
                {t('settings.undoOnDisk')}
                <Tooltip text={shellTip('settings-undo-disk')} testid="tip-settings-undo-disk">
                  <input data-testid="settings-undo-disk" type="checkbox" checked={undoOnDisk} aria-label={t('settings.undoOnDisk')} onChange={(e) => setUndoOnDisk(e.target.checked)} />
                </Tooltip>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-slate-600">{t('ai.notConfigured')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
