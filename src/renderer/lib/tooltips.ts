// R75 Nutzerwunsch: "gib den einstellungen und ALLEN Funktionen on Hover Tooltips was die
// Funktion macht. Auch in den Settings an- und ausschaltbar."
//
// EINE Quelle fuer die Zuordnung:
//  - Befehle kommen aus der Registry (commands.ts) -> Schluessel 'tip.cmd.<id>'.
//  - Kontrollen der Shell (TopBar, Sidebar, Seitenleiste, Einstellungen) stehen hier als
//    testid -> i18n-Schluessel 'tip.shell.<testid>'.
// Der Guard scripts/tooltip-coverage.mjs prueft, dass jeder Befehl und jede hier gelistete
// Kontrolle in DE und EN einen Text hat und dass die testids wirklich im Quellbaum vorkommen.
export const SHELL_TOOLTIP_KEYS: Readonly<Record<string, string>> = {
  'tb-open': 'tip.shell.tb-open',
  'tb-save': 'tip.shell.tb-save',
  'btn-save': 'tip.shell.btn-save',
  'tb-print': 'tip.shell.tb-print',
  'tb-undo': 'tip.shell.tb-undo',
  'tb-redo': 'tip.shell.tb-redo',
  'tb-zoom-out': 'tip.shell.tb-zoom-out',
  'tb-zoom-in': 'tip.shell.tb-zoom-in',
  'tb-zoom-select': 'tip.shell.tb-zoom-select',
  'tb-page-prev': 'tip.shell.tb-page-prev',
  'tb-page-next': 'tip.shell.tb-page-next',
  'tb-page-input': 'tip.shell.tb-page-input',
  'tb-mode-hand': 'tip.shell.tb-mode-hand',
  'tb-mode-text': 'tip.shell.tb-mode-text',
  'view-rot-left': 'tip.shell.view-rot-left',
  'view-rot-right': 'tip.shell.view-rot-right',
  'layout-select': 'tip.shell.layout-select',
  'view-invert': 'tip.shell.view-invert',
  'view-theme': 'tip.shell.view-theme',
  'view-fullscreen': 'tip.shell.view-fullscreen',
  'file-menu-button': 'tip.shell.file-menu-button',
  'pages-more': 'tip.shell.pages-more',
  'sidebar-tab-thumbnails': 'tip.shell.sidebar-tab-thumbnails',
  'sidebar-tab-outline': 'tip.shell.sidebar-tab-outline',
  'sidebar-tab-annotations': 'tip.shell.sidebar-tab-annotations',
  'sidebar-tab-forms': 'tip.shell.sidebar-tab-forms',
  'sidebar-tab-metadata': 'tip.shell.sidebar-tab-metadata',
  'sidebar-tab-properties': 'tip.shell.sidebar-tab-properties',
  'sidebar-tab-signatures': 'tip.shell.sidebar-tab-signatures',
  'sidebar-tab-certificates': 'tip.shell.sidebar-tab-certificates',
  'settings-render-mode': 'tip.shell.settings-render-mode',
  'settings-tooltips': 'tip.shell.settings-tooltips',
  'settings-undo-disk': 'tip.shell.settings-undo-disk',
  'settings-lang': 'tip.shell.settings-lang'
}

/** i18n-Schluessel des Hilfetextes fuer einen Registry-Befehl. */
export function commandTooltipKey(commandId: string): string {
  return `tip.cmd.${commandId}`
}

/** testid -> i18n-Schluessel fuer Shell-Kontrollen; unbekannte Kontrollen liefern ''. */
export function shellTooltipKey(testid: string): string {
  return SHELL_TOOLTIP_KEYS[testid] ?? ''
}
