// Zentrale Shortcut-Tabelle (Section 5): EINE Quelle fuer Registrierung UND Referenz-Dialog.
// Der Modal wird aus genau dieser Liste gebaut — er kann also nie von den tatsaechlich
// gebundenen Tasten abweichen ("can never drift out of date", Section 5).

export type ShortcutGroup = 'file' | 'edit' | 'view' | 'app'

export interface Shortcut {
  id: string
  key: string // lowercase-Taste oder Funktionskey ('f1','f11', ',', '=', ...)
  ctrl?: boolean
  shift?: boolean
  labelKey: string
  group: ShortcutGroup
}

// Bewusst nur Bindungen, deren Aktion implementiert ist — keine toten Eintraege im Referenzdialog.
export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'open', key: 'o', ctrl: true, labelKey: 'sc.open', group: 'file' },
  { id: 'save', key: 's', ctrl: true, labelKey: 'sc.save', group: 'file' },
  { id: 'saveAs', key: 's', ctrl: true, shift: true, labelKey: 'sc.saveAs', group: 'file' },
  { id: 'close', key: 'w', ctrl: true, labelKey: 'sc.close', group: 'file' },
  { id: 'undo', key: 'z', ctrl: true, labelKey: 'sc.undo', group: 'edit' },
  { id: 'redo', key: 'y', ctrl: true, labelKey: 'sc.redo', group: 'edit' },
  { id: 'selectAllText', key: 'a', ctrl: true, shift: true, labelKey: 'sc.selectAllText', group: 'edit' },
  { id: 'zoomFitPage', key: '0', ctrl: true, labelKey: 'sc.zoomFitPage', group: 'view' },
  { id: 'zoom100', key: '1', ctrl: true, labelKey: 'sc.zoom100', group: 'view' },
  { id: 'zoomFitWidth', key: '2', ctrl: true, labelKey: 'sc.zoomFitWidth', group: 'view' },
  { id: 'settings', key: ',', ctrl: true, labelKey: 'sc.settings', group: 'app' },
  { id: 'debug', key: 'd', ctrl: true, shift: true, labelKey: 'sc.debug', group: 'app' },
  { id: 'shortcuts', key: 'f1', labelKey: 'sc.shortcuts', group: 'app' },
  { id: 'fullScreen', key: 'f11', labelKey: 'sc.fullScreen', group: 'view' },
  { id: 'search', key: 'f', ctrl: true, labelKey: 'sc.search', group: 'view' },
  { id: 'searchNext', key: 'f3', labelKey: 'sc.searchNext', group: 'view' },
  { id: 'searchPrev', key: 'f3', shift: true, labelKey: 'sc.searchPrev', group: 'view' }
]

// Liefert die id des passendsten Bindings fuer ein Tastenereignis oder null.
// Strg/Cmd werden gleich behandelt (Ziel Fedora -> Strg; Cmd toleriert). shift genau: ein
// Binding ohne shift verlangt !shiftKey, damit Strg+Z und Strg+Umschalt+Z auseinanderbleiben.
export function matchShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): string | null {
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  for (const s of SHORTCUTS) {
    if (s.key !== k) continue
    if (!!s.ctrl !== mod) continue
    if (s.shift ? !e.shiftKey : e.shiftKey) continue
    return s.id
  }
  return null
}

// Menschlich lesbare Tastenfolge fuer den Referenzdialog, z.B. "Strg+Umschalt+S".
export function formatShortcut(s: Shortcut, modName: string, shiftName: string): string {
  const parts: string[] = []
  if (s.ctrl) {
    parts.push(modName)
    if (s.shift) parts.push(shiftName)
  }
  parts.push(s.key === 'f1' ? 'F1' : s.key === 'f11' ? 'F11' : s.key.toUpperCase())
  return parts.join('+')
}
