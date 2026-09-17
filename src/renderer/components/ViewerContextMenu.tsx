import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { useT } from '@/i18n'
import { ContextMenu } from '@/components/ContextMenu'
import { pageScopeLabel, type CommandContext } from '@/lib/commands'
import type { PdfRect } from '@/lib/pdfCoords'

// §6: Rechtsklick auf die Haupt-Leinwand. Scope = Klickseite (oder ganze Auswahl, wenn die
// Klickseite Teil der Auswahl ist). Menü-Inhalt + Reihenfolge kommen aus contextMenuFor('canvas'):
// Seiten-Operationen, dann Ansicht-Aktionen; zerstörerisches unten nach Separator.

export interface CanvasMenuRequest {
  page: number
  x: number
  y: number
}

export interface ViewerContextMenuProps {
  menu: CanvasMenuRequest
  textSelected: boolean
  /** §6: aktive Textauswahl (Seite 1-basiert + PDF-Rechteck) für die Auswahl-Aktionen oben. */
  selection?: { page: number; text: string; rect: PdfRect } | null
  stamping: boolean
  onClose: () => void
}

export function ViewerContextMenu({ menu, textSelected, selection, stamping, onClose }: ViewerContextMenuProps): JSX.Element {
  const t = useT()
  const readOnly = useAppStore((s) => s.readOnly)
  const mutationLock = useAppStore((s) => s.mutationLock)
  const signedDoc = useAppStore((s) => s.signedDoc)
  const pageCount = useAppStore((s) => s.pageCount)
  const selected0 = useUiStore((s) => s.selected)
  const selectedPages = selected0.map((i) => i + 1)
  const inSel = selectedPages.includes(menu.page)

  const ctx: CommandContext = {
    docOpen: true,
    readOnly,
    mutationLock,
    currentPage: menu.page,
    pageCount,
    selected: inSel ? selectedPages : [menu.page],
    signedDoc,
    textSelected,
    stamping,
    ...(selection ? { selectionText: selection.text, selectionRect: selection.rect, selectionPage: selection.page } : {})
  }
  return (
    <ContextMenu target="canvas" ctx={ctx} x={menu.x} y={menu.y} scopeLabel={pageScopeLabel(t, menu.page, selectedPages)} onClose={onClose} />
  )
}
