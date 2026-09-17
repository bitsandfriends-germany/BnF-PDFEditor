// PART 3 §6/§7.6 — EINE Command-Registry als EINZIGE Quelle der Wahrheit.
//
// Jeder Action wird GENAU EINMAL definiert: id, labelKey, Icon-Token, Gruppe, Reihenfolge,
// Zerstörerisch-Flag, optionaler Shortcut-Verweis (auf die bestehende SHORTCUTS-Tabelle -> kein
// Drift), testid (UID) und enablement-Prädikat + Handler. Toolbar, Kontextmenüs, Menü und Tasten
// werden aus DIESER Liste gebaut — keine Flächen definiert eine eigene Kopie. Handler rufen die
// echten documents.ts-Mutatoren / Stores auf (kein Stub): §2 verbietet Kontrollen ohne echte Wirkung.
//
// Rein getestet: Form + Invarianten (id eindeutig, shortcutId existiert, Gruppenreihenfolge §5,
// Kontextmenü-Scope „omit-not-grey", Zerstörerisches zuletzt, kein Stub-Handler). DOM-Rendering
// (PagesToolbar/ContextMenu) konsumiert diese Registry.

import { selectionExpr, useUiStore } from '@/store/useUiStore'
import { useAppStore, performUndo, performRedo } from '@/store/useAppStore'
import { useDebugStore } from '@/store/useDebugStore'
import { useSearchStore } from '@/store/useSearchStore'
import { rotateSelection, deleteSelection, duplicateSelection, armImageStamp, deleteAnnotation, removeSignatures, openDocument, saveDocument, closeDocument, addAnnotation, applyRedaction } from '@/lib/documents'
import { useAiStore } from '@/store/useAiStore'
import type { PdfRect } from '@/lib/pdfCoords'
import { t } from '@/i18n'

export type CommandGroup = 'rotate' | 'arrange' | 'insert' | 'extractSplit' | 'content' | 'layers' | 'selection' | 'view' | 'annotation' | 'global' | 'textSelection' | 'menu'
export type ToolbarGroup = Exclude<CommandGroup, 'view' | 'menu'>

export interface CommandContext {
  docOpen: boolean
  readOnly: boolean
  mutationLock: boolean
  currentPage: number // 1-basiert
  pageCount: number
  selected: number[] // leere Auswahl -> Aktion wirkt auf currentPage
  textSelected: boolean
  stamping: boolean // platzierter, noch nicht angewendeter Stempel
  /** Dokument enthaelt digitale Signaturen (Store) -> 'Signaturen entfernen' anbieten. */
  signedDoc?: boolean
  /** §6 Annotations-Ziel: Rechtsklick auf eine vorhandene Annotation. */
  onAnnotation?: boolean
  annotationId?: string
  canUndo?: boolean
  canRedo?: boolean
  /** §6 Canvas-Textauswahl: Text + PDF-Rechteck + Seite (1-basiert) der aktiven Auswahl. */
  selectionText?: string
  selectionRect?: PdfRect
  selectionPage?: number
}

export interface CommandDef {
  id: string
  labelKey: string
  group: CommandGroup
  icon: string // lucide-Icon-Name (UI mappt Name -> Komponente)
  testid: string
  order: number // Reihenfolge innerhalb der Gruppe
  destructive?: boolean
  shortcutId?: string // referenziert eine SHORTCUTS-id (keine Duplikat-Definition)
  needsWritable?: boolean // benötigt editierbares Dokument (kein readOnly)
  blocksOnLock?: boolean // Mutation, blockiert während mutationLock
  isEnabled: (ctx: CommandContext) => boolean
  run: (ctx: CommandContext) => void
}

// §5: feste Gruppenreihenfolge der Seiten-Werkzeugleiste; Gruppen brechen nie intern.
// view gehört nie in die Leiste -> Typ ToolbarGroup.
export const TOOLBAR_GROUPS: readonly ToolbarGroup[] = ['rotate', 'arrange', 'insert', 'extractSplit', 'content', 'layers', 'selection']

// Gemeinsame Basis-Prädikate.
const base = (c: CommandContext, needsWritable = false, blocksOnLock = false): boolean =>
  c.docOpen && (!needsWritable || !c.readOnly) && (!blocksOnLock || !c.mutationLock)

// Auswahl-Ausdruck: gewählte Seiten, sonst die aktuelle (§6 Scope des Thumbnails).
const scopeExpr = (c: CommandContext): string => (c.selected.length > 0 ? selectionExpr(c.selected) : String(c.currentPage))
const scopeEnd = (c: CommandContext): number => (c.selected.length > 0 ? Math.max(...c.selected) : c.currentPage)
// §6 Scoped-Menüpunkte ("vor dieser Seite …"): Anfang der aktuellen Scope.
const scopeStart = (c: CommandContext): number => (c.selected.length > 0 ? Math.min(...c.selected) : c.currentPage)

// Seiten-Operationen + Inhalt + Auswahl. Handler = echte Aufrufe (kein Stub).
const ui = (): ReturnType<typeof useUiStore.getState> => useUiStore.getState()

export const COMMANDS: readonly CommandDef[] = [
  // -- rotate
  { id: 'pg.rotLeft', labelKey: 'pages.rotateLeft', group: 'rotate', icon: 'RotateCcw', testid: 'pg-rot-left', order: 1, blocksOnLock: true, isEnabled: (c) => base(c, true, true), run: (c) => { void rotateSelection(scopeExpr(c), -90) } },
  { id: 'pg.rotRight', labelKey: 'pages.rotateRight', group: 'rotate', icon: 'RotateCw', testid: 'pg-rot-right', order: 2, blocksOnLock: true, isEnabled: (c) => base(c, true, true), run: (c) => { void rotateSelection(scopeExpr(c), 90) } },
  { id: 'pg.rot180', labelKey: 'pages.rotate180', group: 'rotate', icon: 'RefreshCw', testid: 'pg-rot-180', order: 3, blocksOnLock: true, isEnabled: (c) => base(c, true, true), run: (c) => { void rotateSelection(scopeExpr(c), 180) } },
  // -- arrange (duplizieren, löschen). Löschen ist zerstörerisch (Kontextmenü: zuletzt, abgetrennt).
  { id: 'pg.duplicate', labelKey: 'pages.duplicate', group: 'arrange', icon: 'Copy', testid: 'pg-dup', order: 1, blocksOnLock: true, isEnabled: (c) => base(c, true, true), run: (c) => { void duplicateSelection(scopeExpr(c), 'after', scopeEnd(c)) } },
  { id: 'pg.delete', labelKey: 'pages.delete', group: 'arrange', icon: 'Trash2', testid: 'pg-del', order: 2, destructive: true, blocksOnLock: true, isEnabled: (c) => base(c, true, true), run: (c) => { void deleteSelection(scopeExpr(c)) } },
  // -- insert
  { id: 'pg.insert', labelKey: 'pages.insert', group: 'insert', icon: 'PlusSquare', testid: 'pg-insert', order: 1, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().openPagesDialog('insert') } },
  // §6: Scoped-Varianten NUR im Kontextmenü (Gruppe 'menu' -> nie in Toolbar/Overflow); öffnen den
  //selben Dialog mit vorausgefülltem Scope (Nachweis: thumbnailContextMenu + pagesDialogs).
  { id: 'pg.insertBefore', labelKey: 'pages.insertBefore', group: 'menu', icon: 'PlusSquare', testid: 'pg-insert-before', order: 1, needsWritable: true, isEnabled: (c) => base(c, true), run: (c) => { ui().openPagesDialog('insert', { position: 'before', page: scopeStart(c) }) } },
  { id: 'pg.insertAfter', labelKey: 'pages.insertAfter', group: 'menu', icon: 'PlusSquare', testid: 'pg-insert-after', order: 2, needsWritable: true, isEnabled: (c) => base(c, true), run: (c) => { ui().openPagesDialog('insert', { position: 'after', page: scopeEnd(c) }) } },
  { id: 'pg.splitBefore', labelKey: 'pages.splitBefore', group: 'menu', icon: 'Scissors', testid: 'pg-split-before', order: 3, isEnabled: (c) => base(c) && c.pageCount > 1, run: (c) => { ui().openPagesDialog('split', { mode: 'at', page: scopeStart(c) }) } },
  // -- extractSplit
  { id: 'pg.extract', labelKey: 'pages.extract', group: 'extractSplit', icon: 'FileOutput', testid: 'pg-extract', order: 1, isEnabled: (c) => base(c), run: () => { ui().openPagesDialog('extract') } },
  { id: 'pg.split', labelKey: 'pages.split', group: 'extractSplit', icon: 'Scissors', testid: 'pg-split', order: 2, isEnabled: (c) => base(c), run: () => { ui().openPagesDialog('split') } },
  // -- content
  { id: 'pg.numbers', labelKey: 'pages.numbers', group: 'content', icon: 'Hash', testid: 'pg-numbers', order: 1, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().openPagesDialog('numbers') } },
  { id: 'pg.watermark', labelKey: 'pages.watermark', group: 'content', icon: 'Droplets', testid: 'pg-watermark', order: 2, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().openPagesDialog('watermark') } },
  { id: 'pg.stampText', labelKey: 'stamp.arm', group: 'content', icon: 'Stamp', testid: 'pg-stamp', order: 3, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().armStamp('text') } },
  { id: 'pg.stampImage', labelKey: 'stamp.armImage', group: 'content', icon: 'ImagePlus', testid: 'pg-stamp-image', order: 4, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { void armImageStamp() } },
  { id: 'pg.images', labelKey: 'images.title', group: 'content', icon: 'Image', testid: 'pg-images', order: 5, isEnabled: (c) => base(c), run: () => { ui().openPagesDialog('images') } },
  { id: 'pg.removeSigs', labelKey: 'certs.removeSigs', group: 'menu', icon: 'ShieldOff', testid: 'pg-remove-sigs', order: 7, destructive: true, needsWritable: true, isEnabled: (c) => base(c, true) && (c.signedDoc ?? false), run: () => { void removeSignatures() } },
  { id: 'pg.sortPages', labelKey: 'pages.sortPages', group: 'menu', icon: 'ArrowUpDown', testid: 'pg-sort', order: 6, isEnabled: (c) => base(c) && c.pageCount > 1, run: () => { ui().setActiveTab('thumbnails') } },
  { id: 'ins.sigField', labelKey: 'certs.field.arm', group: 'insert', icon: 'ShieldCheck', testid: 'ins-sigfield', order: 1, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().armSigField(true) } },
  // -- layers
  { id: 'pg.flatten', labelKey: 'flatten.title', group: 'layers', icon: 'Layers', testid: 'pg-flatten', order: 1, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().openPagesDialog('flatten') } },
  { id: 'pg.export', labelKey: 'tools.export', group: 'layers', icon: 'FileOutput', testid: 'pg-export', order: 2, isEnabled: (c) => base(c), run: () => { ui().openPagesDialog('export') } },
  // -- selection
  { id: 'pg.selectAll', labelKey: 'pages.selectAll', group: 'selection', icon: 'CheckSquare', testid: 'pg-all', order: 1, isEnabled: (c) => base(c) && c.pageCount > 0, run: (c) => { ui().selectAllPages(c.pageCount) } },
  { id: 'pg.clear', labelKey: 'pages.clear', group: 'selection', icon: 'X', testid: 'pg-clear', order: 2, destructive: true, isEnabled: (c) => c.selected.length > 0, run: () => { ui().clearSelection() } },
  // -- view (nur Kontextmenü/Shortcuts, nicht die Seiten-Werkzeugleiste; referenziert SHORTCUTS -> kein Drift)
  { id: 'view.fitWidth', labelKey: 'sc.zoomFitWidth', group: 'view', icon: 'Maximize', testid: 'view-fit-width', order: 1, shortcutId: 'zoomFitWidth', isEnabled: (c) => c.docOpen, run: () => { const u = ui(); u.setZoom(u.zoom, 'fitWidth') } },
  { id: 'view.fitPage', labelKey: 'sc.zoomFitPage', group: 'view', icon: 'Maximize', testid: 'view-fit-page', order: 2, shortcutId: 'zoomFitPage', isEnabled: (c) => c.docOpen, run: () => { const u = ui(); u.setZoom(u.zoom, 'fitPage') } },
    { id: 'view.zoom100', labelKey: 'sc.zoom100', group: 'view', icon: 'Maximize', testid: 'view-zoom-100', order: 3, shortcutId: 'zoom100', isEnabled: (c) => c.docOpen, run: () => { ui().setZoom(1) } },
  // -- annotation (Rechtsklick auf eine vorhandene Annotation; Handler = echte Editor/Mutator-Pfade)
  { id: 'ann.edit', labelKey: 'annotations.properties', group: 'annotation', icon: 'Pencil', testid: 'ann-edit', order: 1, isEnabled: (c) => (c.onAnnotation ?? false) && (c.annotationId !== undefined) && !c.readOnly && !c.mutationLock, run: (c) => { if (c.annotationId !== undefined) ui().setSelectedAnnotationId(c.annotationId) } },
  { id: 'ann.delete', labelKey: 'common.delete', group: 'annotation', icon: 'Trash2', testid: 'ann-delete', order: 2, destructive: true, isEnabled: (c) => (c.onAnnotation ?? false) && (c.annotationId !== undefined) && !c.readOnly && !c.mutationLock, run: (c) => { if (c.annotationId !== undefined) { void deleteAnnotation(c.annotationId); ui().setSelectedAnnotationId(null) } } },
  // §6 Canvas-Menü: Annotations-WERKZEUGE (freie Platzierung) nach den Auswahl-Aktionen. Gruppe
  // 'annotation' steht nicht in TOOLBAR_GROUPS -> Menü-punktbewährt derselbe Effekt wie das
  // Werkzeug-Palette-Handling (armMarkup), Nachweis: viewerContextMenu (State markupTool).
  { id: 'ann.toolHighlight', labelKey: 'annotations.tool.Highlight', group: 'annotation', icon: 'Highlighter', testid: 'ann-tool-highlight', order: 10, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().armMarkup('Highlight') } },
  { id: 'ann.toolUnderline', labelKey: 'annotations.tool.Underline', group: 'annotation', icon: 'Underline', testid: 'ann-tool-underline', order: 11, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().armMarkup('Underline') } },
  { id: 'ann.toolStrikeOut', labelKey: 'annotations.tool.StrikeOut', group: 'annotation', icon: 'Strikethrough', testid: 'ann-tool-strikeout', order: 12, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().armMarkup('StrikeOut') } },
  { id: 'ann.toolSquiggly', labelKey: 'annotations.tool.Squiggly', group: 'annotation', icon: 'SquigglyUnderline', testid: 'ann-tool-squiggly', order: 13, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().armMarkup('Squiggly') } },
  { id: 'ann.toolNote', labelKey: 'annotations.tool.Text', group: 'annotation', icon: 'StickyNote', testid: 'ann-tool-note', order: 14, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().armMarkup('Text') } },
  { id: 'ann.toolFreeText', labelKey: 'annotations.tool.FreeText', group: 'annotation', icon: 'Type', testid: 'ann-tool-freetext', order: 15, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().armMarkup('FreeText') } },
  // -- Textauswahl (§6 Canvas-Menü, ganz oben). Handler sind die ECHEN Pfade: addAnnotation und
  // applyRedaction (beide Endpunkte sind in §3/Dual-Library verifiziert — dies ist der erste
  // UI-Aufrufer von Redaction), Clipboard via Browser-API, AI über useAiStore.ask (echter Stream).
  { id: 'ts.copy', labelKey: 'selection.copy', group: 'textSelection', icon: 'Copy', testid: 'ts-copy', order: 1, isEnabled: (c) => c.textSelected, run: (c) => { const txt = c.selectionText ?? ''; if (txt !== '' && typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(txt) } },
  { id: 'ts.highlight', labelKey: 'selection.highlight', group: 'textSelection', icon: 'Highlighter', testid: 'ts-highlight', order: 2, isEnabled: markupEnabled, run: (c) => { addMarkup(c, 'Highlight') } },
  { id: 'ts.underline', labelKey: 'selection.underline', group: 'textSelection', icon: 'Underline', testid: 'ts-underline', order: 3, isEnabled: markupEnabled, run: (c) => { addMarkup(c, 'Underline') } },
  { id: 'ts.strikeout', labelKey: 'selection.strikeout', group: 'textSelection', icon: 'Strikethrough', testid: 'ts-strikeout', order: 4, isEnabled: markupEnabled, run: (c) => { addMarkup(c, 'StrikeOut') } },
  { id: 'ts.redact', labelKey: 'selection.redact', group: 'textSelection', icon: 'Eraser', testid: 'ts-redact', order: 5, destructive: true, isEnabled: markupEnabled, run: (c) => { const r = c.selectionRect; const p = c.selectionPage; if (r !== undefined && p !== undefined) void applyRedaction([{ page: p, x: r.x, y: r.y, width: r.width, height: r.height }]) } },
  { id: 'ts.askAi', labelKey: 'selection.ask', group: 'textSelection', icon: 'Sparkles', testid: 'ts-ask-ai', order: 6, isEnabled: (c) => c.textSelected && c.docOpen, run: (c) => { const q = c.selectionText ?? ''; if (q === '') return; useUiStore.getState().setActiveTab('ai'); void useAiStore.getState().ask(t('ai.askAboutSelection', { q })) } },
  // -- global (Menü-Bar + globale Shortcuts; Shortcut-IDs referenzieren SHORTCUTS -> kein Drift).
  // Handler = genau die Pfade, die AppShell-Tastatur und Datei-Menü vorher lokal kopiert hatten.
  { id: 'file.open', labelKey: 'sc.open', group: 'global', icon: 'FolderOpen', testid: 'kb-open', order: 1, shortcutId: 'open', isEnabled: () => true, run: () => { void window.pdfEditor.openPdfDialog().then((p) => { if (p) void openDocument(p) }) } },
  { id: 'file.encrypt', labelKey: 'encrypt.title', group: 'global', icon: 'Lock', testid: 'file-encrypt', order: 8, needsWritable: true, isEnabled: (c) => base(c, true), run: () => { ui().openEncryptDialog() } },
  { id: 'file.save', labelKey: 'sc.save', group: 'global', icon: 'Save', testid: 'kb-save', order: 2, shortcutId: 'save', isEnabled: (c) => c.docOpen, run: () => { void saveDocument('save') } },
  { id: 'file.saveAs', labelKey: 'sc.saveAs', group: 'global', icon: 'Save', testid: 'kb-save-as', order: 3, shortcutId: 'saveAs', isEnabled: (c) => c.docOpen, run: () => { void saveDocument('as') } },
  { id: 'file.saveCopy', labelKey: 'common.saveCopy', group: 'global', icon: 'Copy', testid: 'kb-save-copy', order: 4, isEnabled: (c) => c.docOpen, run: () => { void saveDocument('copy') } },
  { id: 'file.close', labelKey: 'sc.close', group: 'global', icon: 'X', testid: 'kb-close', order: 5, shortcutId: 'close', isEnabled: (c) => c.docOpen, run: () => { void closeDocument() } },
  { id: 'edit.undo', labelKey: 'sc.undo', group: 'global', icon: 'Undo2', testid: 'kb-undo', order: 6, shortcutId: 'undo', isEnabled: (c) => (c.canUndo ?? false), run: () => { void performUndo() } },
  { id: 'edit.redo', labelKey: 'sc.redo', group: 'global', icon: 'Redo2', testid: 'kb-redo', order: 7, shortcutId: 'redo', isEnabled: (c) => (c.canRedo ?? false), run: () => { void performRedo() } },
  // Zoom-Shortcuts (zoomFitWidth/zoomFitPage/zoom100) gehören zu view.fitWidth/view.fitPage/view.zoom100.
  { id: 'text.selectAll', labelKey: 'sc.selectAllText', group: 'global', icon: 'TextSelect', testid: 'kb-select-all-text', order: 11, shortcutId: 'selectAllText', isEnabled: (c) => c.docOpen, run: (c) => { selectAllTextOnPage(c.currentPage) } },
  { id: 'app.settings', labelKey: 'sc.settings', group: 'global', icon: 'Settings', testid: 'kb-settings', order: 12, shortcutId: 'settings', isEnabled: () => true, run: () => { ui().openSettings() } },
  { id: 'app.debug', labelKey: 'sc.debug', group: 'global', icon: 'Bug', testid: 'kb-debug', order: 13, shortcutId: 'debug', isEnabled: () => true, run: () => { useDebugStore.getState().toggle() } },
  { id: 'app.shortcuts', labelKey: 'sc.shortcuts', group: 'global', icon: 'Keyboard', testid: 'kb-shortcuts', order: 14, shortcutId: 'shortcuts', isEnabled: () => true, run: () => { ui().openShortcuts() } },
  { id: 'app.fullScreen', labelKey: 'sc.fullScreen', group: 'global', icon: 'Expand', testid: 'kb-fullscreen', order: 15, shortcutId: 'fullScreen', isEnabled: () => true, run: () => { ui().toggleFullScreen() } },
  { id: 'search.open', labelKey: 'sc.search', group: 'global', icon: 'Search', testid: 'kb-search', order: 16, shortcutId: 'search', isEnabled: (c) => c.docOpen, run: () => { useSearchStore.getState().setOpen(true) } },
  { id: 'search.next', labelKey: 'sc.searchNext', group: 'global', icon: 'ChevronDown', testid: 'kb-search-next', order: 17, shortcutId: 'searchNext', isEnabled: (c) => c.docOpen, run: () => { useSearchStore.getState().next() } },
  { id: 'search.prev', labelKey: 'sc.searchPrev', group: 'global', icon: 'ChevronUp', testid: 'kb-search-prev', order: 18, shortcutId: 'searchPrev', isEnabled: (c) => c.docOpen, run: () => { useSearchStore.getState().prev() } }
]

export function getCommand(id: string): CommandDef | undefined {
  return COMMANDS.find((c) => c.id === id)
}

// §6: Auswahl-Markierungen/Schwärzen brauchen Auswahl + echtes Dokument und Schreibrecht.
function markupEnabled(c: CommandContext): boolean {
  return c.textSelected && c.docOpen && !c.readOnly && !c.mutationLock && c.selectionRect !== undefined && c.selectionPage !== undefined
}

// Hebt die Textauswahl direkt auf die Seite — derselbe (in §3 verifizierte) Endpunkt wie der
// Markup-Dialog, nur ohne Zwischenschritt (Auswahlrechteck ist schon ein PDF-Rechteck).
function addMarkup(c: CommandContext, type: 'Highlight' | 'Underline' | 'StrikeOut'): void {
  const r = c.selectionRect
  const p = c.selectionPage
  if (r === undefined || p === undefined) return
  void addAnnotation({ page0: p - 1, type, x: r.x, y: r.y, width: r.width, height: r.height })
}

// §7.6: globale Shortcuts + Menü-Bar dispatchen durch DIESSE Registry — keine lokale Aktions-Kopie.
// Befehl für eine Shortcut-ID (zoom-* liegen auf den view.* Befehlen, Rest auf global/datei/edit/…).
export function commandByShortcutId(shortcutId: string): CommandDef | undefined {
  return COMMANDS.find((c) => c.shortcutId === shortcutId)
}

// Live-Kontext aus den Stores (Tastatur/Menü-Bar kennen keinen Seiten-Zielkontext).
export function liveCommandContext(): CommandContext {
  const a = useAppStore.getState()
  const u = useUiStore.getState()
  return { docOpen: a.docOpen, readOnly: a.readOnly, mutationLock: a.mutationLock, currentPage: a.currentPage, pageCount: a.pageCount, selected: u.selected, textSelected: false, stamping: false, canUndo: a.canUndo, canRedo: a.canRedo }
}

// Ein getroffener Shortcut führt den Registry-Befehl aus, wenn er aktiv ist (AppShell ruft nur noch
// matchShortcut + dies hier auf — die Aktions-Zuordnung existiert nirgends sonst).
export function dispatchShortcut(shortcutId: string): void {
  const cmd = commandByShortcutId(shortcutId)
  if (!cmd) return
  const ctx = liveCommandContext()
  if (cmd.isEnabled(ctx)) cmd.run(ctx)
}

// Menü-Bar-Eintrag (Main-Prozess) kennt nur die Befehls-id: gleiches Gate wie Tastatur/Kontext.
export function dispatchCommand(id: string): void {
  const cmd = COMMANDS.find((c) => c.id === id)
  if (!cmd) return
  const ctx = liveCommandContext()
  if (cmd.isEnabled(ctx)) cmd.run(ctx)
}

// Text der aktuellen Seite markieren (Shortcut selectAllText); echter DOM-Griff auf die Textschicht.
export function selectAllTextOnPage(pageNumber: number): void {
  const el = document.querySelector(`[data-testid="text-layer"][data-page="${pageNumber}"]`)
  if (!el) return
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.selectNodeContents(el)
  sel.removeAllRanges()
  sel.addRange(range)
}

// Toolbar: Gruppen in §5-Reihenfolge, je Gruppe nach order, nur aktive (isEnabled). Zerstörerisches
// bleibt in seiner Gruppe, wird aber durch das destructive-Flag vom UI mit Abstand/separator markiert.
export function toolbarGroups(ctx: CommandContext): { group: CommandGroup; items: CommandDef[] }[] {
  return TOOLBAR_GROUPS.map((group) => ({
    group,
    items: COMMANDS.filter((c) => c.group === group && c.isEnabled(ctx)).sort((a, b) => a.order - b.order)
  })).filter((g) => g.items.length > 0)
}

// Kontextmenü-Modell (§6): nicht zutreffende Einträge werden WEGGELASSEN (nicht ausgegraut);
// zerstörerische landen ZULETZT, getrennt. Liefert zwei Listen -> UI zieht einen Separator dazwischen.
export type ContextTarget = 'thumbnail' | 'canvas' | 'annotation'

export interface ContextMenuModel {
  primary: CommandDef[]
  destructive: CommandDef[]
  groups?: CommandGroupDef[]
}

// §6 Scope-Name für seitenbezogene Kontextmenüs: ganze Auswahl benennen, sonst die Einzelseite.
// EINE Regel für Thumbnail- UND Canvas-Menü (kein Drift zwischen beiden Flächen).
export function pageScopeLabel(t: (key: string, vars?: Record<string, string | number>) => string, page: number, selectedPages: number[]): string {
  return selectedPages.includes(page) ? t('pages.selected', { count: selectedPages.length }) : t('sidebar.pageLabel', { page })
}

// Seiten-Operationen für ein Ziel, scoped auf Auswahl bzw. aktuelle Seite.
export interface CommandGroupDef { id: string; labelKey: string; icon: string; items: CommandDef[] }

export function contextMenuFor(target: ContextTarget, ctx: CommandContext): ContextMenuModel {
  // §6: Annotation-Ziel: eigene Aktionen („Antworten" erst mit echtem Handler; §2).
  if (target === 'annotation') {
    const all = ['ann.edit', 'ann.delete'].map((id) => getCommand(id)).filter((c): c is CommandDef => c !== undefined && c.isEnabled(ctx))
    return { primary: all.filter((c) => !c.destructive), destructive: all.filter((c) => c.destructive) }
  }
  // §6: Thumbnail = volle Seiten-/Inhalts-Ops; Canvas zusätzlich die Ansicht-Aktionen.
  // §6 Reihenfolge auf der Leinwand: ZUERST Textauswahl-Aktionen (wenn Auswahl existiert).
  const scopeIds = [] as string[]
  scopeIds.push('pg.clear') // destruktiv, aber nur die Auswahl -> immer vor dem echten Löschen (letzte Position gehört pg.delete)
  if (target === 'canvas' && ctx.textSelected) scopeIds.push('ts.copy', 'ts.highlight', 'ts.underline', 'ts.strikeout', 'ts.redact', 'ts.askAi')
  if (target === 'canvas') scopeIds.push('ann.toolHighlight', 'ann.toolUnderline', 'ann.toolStrikeOut', 'ann.toolSquiggly', 'ann.toolNote', 'ann.toolFreeText')
  scopeIds.push('pg.rotLeft', 'pg.rotRight', 'pg.rot180', 'pg.duplicate', 'pg.delete', 'pg.extract')
  if (target === 'thumbnail') scopeIds.push('pg.splitBefore', 'pg.insertBefore', 'pg.insertAfter')
  else scopeIds.push('pg.split', 'pg.insert')
  scopeIds.push('pg.numbers', 'pg.watermark', 'pg.stampText', 'pg.stampImage', 'pg.images', 'pg.flatten', 'pg.export')
  scopeIds.push('pg.selectAll') // (§6: Toolbar-Aktionen alle per Rechtsklick erreichbar)
  if (target === 'canvas') scopeIds.push('view.fitWidth', 'view.fitPage', 'view.zoom100')
  // Zwei Ebenen (Nutzerwunsch R55): Alltagsaktionen direkt, thematisch Viel-
  // zuegiges als Flyout-Gruppen (Einfuegen / Annotieren / PDF bearbeiten / Ansicht).
  const groupedIds = new Set<string>([
    'ann.toolHighlight', 'ann.toolUnderline', 'ann.toolStrikeOut', 'ann.toolSquiggly', 'ann.toolNote', 'ann.toolFreeText',
    'pg.rotLeft', 'pg.rotRight', 'pg.rot180', 'pg.duplicate', 'pg.extract', 'pg.split', 'pg.insert', 'pg.splitBefore', 'pg.insertBefore', 'pg.insertAfter',
    'pg.numbers', 'pg.watermark', 'pg.stampText', 'pg.stampImage', 'pg.images', 'pg.flatten', 'pg.export',
    'view.fitWidth', 'view.fitPage', 'view.zoom100',
    'pg.sortPages', 'pg.removeSigs',
  ])
  const resolve = (ids: string[]): CommandDef[] => ids.map((id) => getCommand(id)).filter((c): c is CommandDef => c !== undefined && c.isEnabled(ctx))
  const mk = (id: string, labelKey: string, icon: string, ids: string[]): CommandGroupDef | null => {
    const items = resolve(ids)
    return items.length ? { id, labelKey, icon, items } : null
  }
  const groups = [
    mk('grp.insert', 'ctx.group.insert', 'Plus', target === 'thumbnail' ? ['ins.sigField', 'pg.stampImage', 'pg.stampText', 'pg.insertBefore'] : ['ins.sigField', 'pg.stampImage', 'pg.stampText']),
    target === 'canvas' ? mk('grp.annotate', 'ctx.group.annotate', 'PenLine', ['ann.toolHighlight', 'ann.toolUnderline', 'ann.toolStrikeOut', 'ann.toolSquiggly', 'ann.toolNote', 'ann.toolFreeText']) : null,
    mk('grp.pdf', 'ctx.group.pdf', 'FileCog', target === 'thumbnail'
      ? ['pg.rotLeft', 'pg.rotRight', 'pg.rot180', 'pg.duplicate', 'pg.extract', 'pg.splitBefore', 'pg.insertAfter', 'pg.numbers', 'pg.watermark', 'pg.images', 'pg.flatten', 'pg.export']
      : ['pg.rotLeft', 'pg.rotRight', 'pg.rot180', 'pg.duplicate', 'pg.extract', 'pg.split', 'pg.insert', 'pg.numbers', 'pg.watermark', 'pg.images', 'pg.flatten', 'pg.export', 'pg.sortPages', 'pg.removeSigs']),
    target === 'canvas' ? mk('grp.view', 'ctx.group.view', 'Maximize', ['view.fitWidth', 'view.fitPage', 'view.zoom100']) : null,
  ].filter((g): g is CommandGroupDef => g !== null)
  const flatIds = scopeIds.filter((id) => !groupedIds.has(id))
  const all = resolve(flatIds)
  const primary = all.filter((c) => !c.destructive)
  const destructive = all.filter((c) => c.destructive)
  return { primary, destructive, groups }
}
