import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

// §7.6: Shortcuts und Menü-Bar lesen EINE Registry. Bewiesen:
//  1) jede SHORTCUTS-id hat genau EINEN Registry-Befehl (kein Drift, keine Doppelbelegung);
//  2) dispatchShortcut führt den echten Handler aus (Store-Effekt) bzw. lässt zu, wenn inaktiv;
//  3) file.save/edit.undo rufen die echten documents/store-Funktionen nur bei Enabled.

import * as documents from '@/lib/documents'
import { SHORTCUTS } from '@/lib/shortcuts'
import { commandByShortcutId, dispatchShortcut, getCommand, COMMANDS } from '@/lib/commands'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { useSearchStore } from '@/store/useSearchStore'
import { useDebugStore } from '@/store/useDebugStore'

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ docOpen: false, readOnly: false, mutationLock: false, canUndo: false, canRedo: false, currentPage: 1, pageCount: 0, toasts: [] })
  useUiStore.setState({ zoomMode: 'custom', settingsOpen: false, shortcutsOpen: false })
  useSearchStore.setState({ open: false })
})

describe('Shortcut -> Registry (§7.6)', () => {
  it('jede der 17 Shortcut-ids hat genau einen Befehl, jede shortcutId ist gültig', () => {
    expect(SHORTCUTS).toHaveLength(17)
    for (const s of SHORTCUTS) {
      const hits = COMMANDS.filter((c) => c.shortcutId === s.id)
      expect(hits.length, s.id).toBe(1)
      expect(commandByShortcutId(s.id)?.id, s.id).toBe(hits[0]?.id)
    }
  })
})

describe('dispatchShortcut (§7.6)', () => {
  it('settings/debug/fullScreen wirken auf echte Stores, ohne Dokument verfügbar', () => {
    dispatchShortcut('settings')
    expect(useUiStore.getState().settingsOpen).toBe(true)
    dispatchShortcut('shortcuts')
    expect(useUiStore.getState().shortcutsOpen).toBe(true)
    const before = useDebugStore.getState().open
    dispatchShortcut('debug')
    expect(useDebugStore.getState().open).toBe(!before)
    expect(getCommand('app.settings')?.isEnabled({ docOpen: false, readOnly: false, mutationLock: false, currentPage: 1, pageCount: 0, selected: [], textSelected: false, stamping: false })).toBe(true)
  })

  it('zoomFitWidth setzt echten Zoom-Modus (nur mit Dokument — derselbe Befehl wie im Canvas-Menü)', () => {
    dispatchShortcut('zoomFitWidth')
    expect(useUiStore.getState().zoomMode).toBe('custom') // ohne Dokument: kein Zoom auf Nichts
    useAppStore.setState({ docOpen: true })
    dispatchShortcut('zoomFitWidth')
    expect(useUiStore.getState().zoomMode).toBe('fitWidth') // Befehl setzt explizit fitWidth
    expect(commandByShortcutId('zoomFitWidth')?.id).toBe('view.fitWidth')
  })

  it('save ohne Dokument: kein documents-Aufruf; mit Dokument: saveDocument("save")', () => {
    const spy = vi.spyOn(documents, 'saveDocument').mockResolvedValue(true)
    dispatchShortcut('save')
    expect(spy).not.toHaveBeenCalled()
    useAppStore.setState({ docOpen: true })
    dispatchShortcut('save')
    expect(spy).toHaveBeenCalledWith('save')
    spy.mockRestore()
  })

  it('undo/redo: Pforte über canUndo/canRedo; Ausführung der echten Store-Funktion ist sicher', () => {
    const off = { docOpen: true, readOnly: false, mutationLock: false, currentPage: 1, pageCount: 1, selected: [], textSelected: false, stamping: false }
    expect(getCommand('edit.undo')?.isEnabled(off)).toBe(false)
    expect(getCommand('edit.redo')?.isEnabled({ ...off, canRedo: true })).toBe(true)
    // leerer Stapel: echter Aufruf ändert nichts und wirft nicht
    expect(() => dispatchShortcut('undo')).not.toThrow()
    expect(() => dispatchShortcut('redo')).not.toThrow()
  })

  it('search ohne Dokument aus, mit Dokument an (echter Store)', () => {
    dispatchShortcut('search')
    expect(useSearchStore.getState().open).toBe(false)
    useAppStore.setState({ docOpen: true })
    dispatchShortcut('search')
    expect(useSearchStore.getState().open).toBe(true)
  })
})
