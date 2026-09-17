import { useAppStore } from '@/store/useAppStore'
import { ContextMenu } from '@/components/ContextMenu'
import type { CommandContext } from '@/lib/commands'

// §6: Rechtsklick auf eine Annotation -> ihre eigenen Aktionen (Eigenschaften bearbeiten,
// Löschen zuletzt nach Separator). Inhalt + Regeln kommen aus contextMenuFor('annotation').

export interface AnnotationMenuRequest {
  id: string
  label: string
  x: number
  y: number
}

export interface AnnotationContextMenuProps {
  menu: AnnotationMenuRequest
  onClose: () => void
}

export function AnnotationContextMenu({ menu, onClose }: AnnotationContextMenuProps): JSX.Element {
  const readOnly = useAppStore((s) => s.readOnly)
  const mutationLock = useAppStore((s) => s.mutationLock)
  const ctx: CommandContext = {
    docOpen: true,
    readOnly,
    mutationLock,
    currentPage: 1,
    pageCount: 0,
    selected: [],
    textSelected: false,
    stamping: false,
    onAnnotation: true,
    annotationId: menu.id
  }
  return <ContextMenu target="annotation" ctx={ctx} x={menu.x} y={menu.y} scopeLabel={menu.label} onClose={onClose} />
}
