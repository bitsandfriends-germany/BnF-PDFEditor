import { describe, it, expect } from 'vitest'
import { SHORTCUTS, matchShortcut, formatShortcut } from '@/lib/shortcuts'
import de from '@/locales/de.json'
import en from '@/locales/en.json'

const D = de as Record<string, string>
const E = en as Record<string, string>

function ev(key: string, ctrl = false, shift = false) {
  return { key, ctrlKey: ctrl, metaKey: ctrl, shiftKey: shift }
}

describe('matchShortcut', () => {
  it('Strg+S -> save, Strg+Umschalt+S -> saveAs', () => {
    expect(matchShortcut(ev('s', true))).toBe('save')
    expect(matchShortcut(ev('S', true, true))).toBe('saveAs') // shift => Grossbuchstabe moeglich
  })
  it('Strg+Z vs Strg+Y trennscharf; nacktes S ignoriert', () => {
    expect(matchShortcut(ev('z', true))).toBe('undo')
    expect(matchShortcut(ev('y', true))).toBe('redo')
    expect(matchShortcut(ev('z'))).toBeNull()
    expect(matchShortcut(ev('s'))).toBeNull()
  })
  it('F1 ohne Modifikator', () => {
    expect(matchShortcut(ev('f1'))).toBe('shortcuts')
    expect(matchShortcut(ev('f1', true))).toBeNull()
  })
})

describe('formatShortcut', () => {
  it('baut lesbare Folge', () => {
    const saveAs = SHORTCUTS.find((s) => s.id === 'saveAs')!
    expect(formatShortcut(saveAs, 'Strg', 'Umschalt')).toBe('Strg+Umschalt+S')
    expect(formatShortcut(SHORTCUTS.find((s) => s.id === 'shortcuts')!, 'Strg', 'Umschalt')).toBe('F1')
  })
})

describe('Tabellen-Integritaet (Referenzdialog == Bindungen)', () => {
  it('ids eindeutig', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length)
  })
  it('Tasten-Kombis eindeutig', () => {
    const combos = SHORTCUTS.map((s) => `${!!s.ctrl}+${!!s.shift}+${s.key}`)
    expect(new Set(combos).size).toBe(combos.length)
  })
  it('jedes labelKey existiert in de UND en', () => {
    for (const s of SHORTCUTS) {
      expect(D[s.labelKey], `de ${s.labelKey}`).toBeTruthy()
      expect(E[s.labelKey], `en ${s.labelKey}`).toBeTruthy()
    }
  })
  it('Gruppen-Labels vorhanden', () => {
    for (const g of ['file', 'edit', 'view', 'app']) {
      expect(D[`group.${g}`]).toBeTruthy()
      expect(E[`group.${g}`]).toBeTruthy()
    }
  })
})
