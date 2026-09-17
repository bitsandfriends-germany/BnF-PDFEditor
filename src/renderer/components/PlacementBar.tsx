import { useT } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'
import { stampImageSelection } from '@/lib/documents'
import { useAppStore } from '@/store/useAppStore'

// Einheitliche Grafik-Platzier-Leiste: gedroppte/gerenderte Grafik als Vorschau, gezogene
// Region, "Einbetten" schreibt sie per Stempel-Mutator aufs Blatt (Save bettet endgueltig
// ein). Stempel und Signatur nutzen denselben Weg — nur die Herkunft unterscheidet sich.
export function PlacementBar(): JSX.Element | null {
  const t = useT()
  const placement = useUiStore((s) => s.graphicPlacement)
  const placed = useUiStore((s) => s.placedGraphic)
  const clear = useUiStore((s) => s.clearGraphicPlacement)
  const addToast = useAppStore((s) => s.addToast)
  if (!placement) return null
  const embed = async (): Promise<void> => {
    if (!placed) return
    const ok = await stampImageSelection(String(placed.page), placed.rect, placement.imageB64, { overlay: true, keepProportion: true })
    if (ok) {
      addToast({ kind: 'success', message: t('place.embedded', { name: placement.name, page: placed.page }) })
      clear()
    } else {
      addToast({ kind: 'error', message: t('place.failed') })
    }
  }
  return (
    <div data-testid="placement-bar" className="pointer-events-auto fixed bottom-6 left-1/2 z-40 -translate-x-1/2 flex items-center gap-3 rounded-xl border border-slate-300 bg-white/95 px-4 py-3 shadow-xl dark:border-slate-600 dark:bg-slate-800/95">
      <img src={placement.dataUrl} alt={placement.name} data-testid="place-preview" className="h-14 w-14 rounded border border-slate-200 bg-slate-50 object-contain dark:border-slate-600 dark:bg-slate-700" />
      <div className="min-w-[180px] text-sm">
        <div className="font-medium">{placement.name}</div>
        <div className="text-slate-500" data-testid="place-status">
          {placed ? t('place.onPage', { page: placed.page, w: Math.round(placed.rect.width), h: Math.round(placed.rect.height) }) : t('place.drawHint')}
        </div>
      </div>
      <button type="button" data-testid="place-apply" disabled={!placed} onClick={() => void embed()} className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40">
        {t('place.embed')}
      </button>
      <button type="button" data-testid="place-cancel" onClick={clear} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600">
        {t('common.cancel')}
      </button>
    </div>
  )
}
