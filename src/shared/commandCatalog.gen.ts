// GENERIERT aus src/renderer/lib/commands.ts — NICHT von HAND EDITIEREN.
// Neu erzeugen: node scripts/command-catalog.mjs   (Frische erzwingt tests/shared/commandCatalog.test.ts)
export interface CatalogCommand { id: string; labelKey: string; group: string; order: number; destructive?: boolean; shortcutId?: string }
export const COMMAND_CATALOG: readonly CatalogCommand[] = [
 {
  "id": "pg.rotLeft",
  "labelKey": "pages.rotateLeft",
  "group": "rotate",
  "order": 1
 },
 {
  "id": "pg.rotRight",
  "labelKey": "pages.rotateRight",
  "group": "rotate",
  "order": 2
 },
 {
  "id": "pg.rot180",
  "labelKey": "pages.rotate180",
  "group": "rotate",
  "order": 3
 },
 {
  "id": "pg.duplicate",
  "labelKey": "pages.duplicate",
  "group": "arrange",
  "order": 1
 },
 {
  "id": "pg.delete",
  "labelKey": "pages.delete",
  "group": "arrange",
  "order": 2,
  "destructive": true
 },
 {
  "id": "pg.insert",
  "labelKey": "pages.insert",
  "group": "insert",
  "order": 1
 },
 {
  "id": "pg.insertBefore",
  "labelKey": "pages.insertBefore",
  "group": "menu",
  "order": 1
 },
 {
  "id": "pg.insertAfter",
  "labelKey": "pages.insertAfter",
  "group": "menu",
  "order": 2
 },
 {
  "id": "pg.splitBefore",
  "labelKey": "pages.splitBefore",
  "group": "menu",
  "order": 3
 },
 {
  "id": "pg.extract",
  "labelKey": "pages.extract",
  "group": "extractSplit",
  "order": 1
 },
 {
  "id": "pg.split",
  "labelKey": "pages.split",
  "group": "extractSplit",
  "order": 2
 },
 {
  "id": "pg.numbers",
  "labelKey": "pages.numbers",
  "group": "content",
  "order": 1
 },
 {
  "id": "pg.watermark",
  "labelKey": "pages.watermark",
  "group": "content",
  "order": 2
 },
 {
  "id": "pg.stampText",
  "labelKey": "stamp.arm",
  "group": "content",
  "order": 3
 },
 {
  "id": "pg.stampImage",
  "labelKey": "stamp.armImage",
  "group": "content",
  "order": 4
 },
 {
  "id": "pg.images",
  "labelKey": "images.title",
  "group": "content",
  "order": 5
 },
 {
  "id": "pg.removeSigs",
  "labelKey": "certs.removeSigs",
  "group": "menu",
  "order": 7,
  "destructive": true
 },
 {
  "id": "pg.sortPages",
  "labelKey": "pages.sortPages",
  "group": "menu",
  "order": 6
 },
 {
  "id": "ins.sigField",
  "labelKey": "certs.field.arm",
  "group": "insert",
  "order": 1
 },
 {
  "id": "pg.flatten",
  "labelKey": "flatten.title",
  "group": "layers",
  "order": 1
 },
 {
  "id": "pg.export",
  "labelKey": "tools.export",
  "group": "layers",
  "order": 2
 },
 {
  "id": "pg.selectAll",
  "labelKey": "pages.selectAll",
  "group": "selection",
  "order": 1
 },
 {
  "id": "pg.clear",
  "labelKey": "pages.clear",
  "group": "selection",
  "order": 2,
  "destructive": true
 },
 {
  "id": "view.fitWidth",
  "labelKey": "sc.zoomFitWidth",
  "group": "view",
  "order": 1,
  "shortcutId": "zoomFitWidth"
 },
 {
  "id": "view.fitPage",
  "labelKey": "sc.zoomFitPage",
  "group": "view",
  "order": 2,
  "shortcutId": "zoomFitPage"
 },
 {
  "id": "view.zoom100",
  "labelKey": "sc.zoom100",
  "group": "view",
  "order": 3,
  "shortcutId": "zoom100"
 },
 {
  "id": "ann.edit",
  "labelKey": "annotations.properties",
  "group": "annotation",
  "order": 1
 },
 {
  "id": "ann.delete",
  "labelKey": "common.delete",
  "group": "annotation",
  "order": 2,
  "destructive": true
 },
 {
  "id": "ann.toolHighlight",
  "labelKey": "annotations.tool.Highlight",
  "group": "annotation",
  "order": 10
 },
 {
  "id": "ann.toolUnderline",
  "labelKey": "annotations.tool.Underline",
  "group": "annotation",
  "order": 11
 },
 {
  "id": "ann.toolStrikeOut",
  "labelKey": "annotations.tool.StrikeOut",
  "group": "annotation",
  "order": 12
 },
 {
  "id": "ann.toolSquiggly",
  "labelKey": "annotations.tool.Squiggly",
  "group": "annotation",
  "order": 13
 },
 {
  "id": "ann.toolNote",
  "labelKey": "annotations.tool.Text",
  "group": "annotation",
  "order": 14
 },
 {
  "id": "ann.toolFreeText",
  "labelKey": "annotations.tool.FreeText",
  "group": "annotation",
  "order": 15
 },
 {
  "id": "ts.copy",
  "labelKey": "selection.copy",
  "group": "textSelection",
  "order": 1
 },
 {
  "id": "ts.highlight",
  "labelKey": "selection.highlight",
  "group": "textSelection",
  "order": 2
 },
 {
  "id": "ts.underline",
  "labelKey": "selection.underline",
  "group": "textSelection",
  "order": 3
 },
 {
  "id": "ts.strikeout",
  "labelKey": "selection.strikeout",
  "group": "textSelection",
  "order": 4
 },
 {
  "id": "ts.redact",
  "labelKey": "selection.redact",
  "group": "textSelection",
  "order": 5,
  "destructive": true
 },
 {
  "id": "ts.askAi",
  "labelKey": "selection.ask",
  "group": "textSelection",
  "order": 6
 },
 {
  "id": "file.open",
  "labelKey": "sc.open",
  "group": "global",
  "order": 1,
  "shortcutId": "open"
 },
 {
  "id": "file.encrypt",
  "labelKey": "encrypt.title",
  "group": "global",
  "order": 8
 },
 {
  "id": "file.save",
  "labelKey": "sc.save",
  "group": "global",
  "order": 2,
  "shortcutId": "save"
 },
 {
  "id": "file.saveAs",
  "labelKey": "sc.saveAs",
  "group": "global",
  "order": 3,
  "shortcutId": "saveAs"
 },
 {
  "id": "file.saveCopy",
  "labelKey": "common.saveCopy",
  "group": "global",
  "order": 4
 },
 {
  "id": "file.close",
  "labelKey": "sc.close",
  "group": "global",
  "order": 5,
  "shortcutId": "close"
 },
 {
  "id": "edit.undo",
  "labelKey": "sc.undo",
  "group": "global",
  "order": 6,
  "shortcutId": "undo"
 },
 {
  "id": "edit.redo",
  "labelKey": "sc.redo",
  "group": "global",
  "order": 7,
  "shortcutId": "redo"
 },
 {
  "id": "text.selectAll",
  "labelKey": "sc.selectAllText",
  "group": "global",
  "order": 11,
  "shortcutId": "selectAllText"
 },
 {
  "id": "app.settings",
  "labelKey": "sc.settings",
  "group": "global",
  "order": 12,
  "shortcutId": "settings"
 },
 {
  "id": "app.debug",
  "labelKey": "sc.debug",
  "group": "global",
  "order": 13,
  "shortcutId": "debug"
 },
 {
  "id": "app.shortcuts",
  "labelKey": "sc.shortcuts",
  "group": "global",
  "order": 14,
  "shortcutId": "shortcuts"
 },
 {
  "id": "app.fullScreen",
  "labelKey": "sc.fullScreen",
  "group": "global",
  "order": 15,
  "shortcutId": "fullScreen"
 },
 {
  "id": "search.open",
  "labelKey": "sc.search",
  "group": "global",
  "order": 16,
  "shortcutId": "search"
 },
 {
  "id": "search.next",
  "labelKey": "sc.searchNext",
  "group": "global",
  "order": 17,
  "shortcutId": "searchNext"
 },
 {
  "id": "search.prev",
  "labelKey": "sc.searchPrev",
  "group": "global",
  "order": 18,
  "shortcutId": "searchPrev"
 }
] as const
