import { describe, it, expect } from 'vitest'
import { COMMANDS, TOOLBAR_GROUPS, getCommand, toolbarGroups, contextMenuFor, dispatchCommand, type CommandContext } from '@/lib/commands'
import { SHORTCUTS } from '@/lib/shortcuts'
import { useUiStore } from '@/store/useUiStore'

// PART 3 §7.6 — Registry ist EINE Quelle. Diese Invarianten verhindern genau die Drift-/Tot-Klasse,
// die PART 3 abschafft: tote Kontrollen, Kopien, ausgegraute Nicht-Treffer, Shortcut-Abgleich.

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  return { docOpen: true, readOnly: false, mutationLock: false, currentPage: 1, pageCount: 5, selected: [], textSelected: false, stamping: false, ...over }
}

describe('Command-Registry Invarianten (§7.6)', () => {
  it('ids sind eindeutig', () => {
    const ids = COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('jeder shortcutId existiert in der SHORTCUTS-Tabelle (kein Drift)', () => {
    const sc = new Set(SHORTCUTS.map((s) => s.id))
    for (const c of COMMANDS) {
      if (c.shortcutId !== undefined) expect(sc.has(c.shortcutId), `${c.id} -> ${c.shortcutId}`).toBe(true)
    }
  })

  it('jede Kontrolle hat einen echten Handler (kein Stub) und ein enablement-Prädikat', () => {
    for (const c of COMMANDS) {
      expect(typeof c.run, c.id).toBe('function')
      expect(typeof c.isEnabled, c.id).toBe('function')
    }
  })

  it('testids sind eindeutig (UID-Quelle = Registry)', () => {
    const t = COMMANDS.map((c) => c.testid)
    expect(new Set(t).size).toBe(t.length)
  })
})

describe('Toolbar-Gruppen (§5)', () => {
  it('folgt der festen §5-Gruppenreihenfolge', () => {
    const groups = toolbarGroups(ctx()).map((g) => g.group)
    // nur belegte Gruppen, aber relative Reihenfolge == TOOLBAR_GROUPS
    const expected = TOOLBAR_GROUPS.filter((g) => groups.includes(g))
    expect(groups).toEqual(expected)
    expect(groups.indexOf('rotate')).toBeLessThan(groups.indexOf('arrange'))
    expect(groups.indexOf('arrange')).toBeLessThan(groups.indexOf('extractSplit'))
    expect(groups.indexOf('content')).toBeLessThan(groups.indexOf('layers'))
  })

  it('Löschen ist als zerstörerisch markiert', () => {
    expect(getCommand('pg.delete')?.destructive).toBe(true)
    expect(getCommand('pg.duplicate')?.destructive).toBeFalsy()
  })
})

// R55 Zwei-Ebenen-Modell: Tests pruefen die ERREICHBARKEIT ueber alle Ebenen.
function flatModel(m: ReturnType<typeof contextMenuFor>): string[] {
  return [...m.primary, ...(m.groups ?? []).flatMap((g) => g.items), ...m.destructive].map((c) => c.id)
}

describe('Kontextmenü-Scoping (§6)', () => {
  const sel = ctx({ selected: [3, 4, 5] })
  const m = contextMenuFor('thumbnail', sel)

  it('Seiten-Ops sind enthalten, zerstörerisches NICHT in der Primär-Liste', () => {
    const ids = flatModel(m)
    expect(ids).toContain('pg.rotRight')
    expect(ids).toContain('pg.duplicate')
    expect(ids).toContain('pg.extract')
    expect(ids).toContain('pg.insertBefore')
    expect(ids).toContain('pg.splitBefore')
    expect(m.primary.map((c) => c.id)).not.toContain('pg.delete') // zerstoererlich: nie Ebene 1
  })
  it('R55: Alltagsebene bleibt flach, Themengruppen als Flyout vorhanden', () => {
    const g = (m.groups ?? []).map((x) => x.id)
    expect(g).toContain('grp.insert')
    expect(g).toContain('grp.pdf')
    expect(m.primary.map((c) => c.id)).not.toContain('pg.rotRight') // in Flyout verschoben
    expect(m.primary.map((c) => c.id)).not.toContain('pg.delete')
  })

  it('zerstörerische Einträge stehen getrennt zuletzt', () => {
    expect(m.destructive.map((c) => c.id)).toEqual(['pg.clear', 'pg.delete']) // clear nur-Auswahl -> vor echtem Löschen
  })

  it('nicht zutreffende Einträge werden weggelassen, nicht ausgegraut (readOnly)', () => {
    const ro = contextMenuFor('thumbnail', ctx({ readOnly: true }))
    const all = flatModel(ro)
    expect(all).not.toContain('pg.delete')      // editier-bar -> fehlt komplett
    expect(all).not.toContain('pg.rotRight')
    expect(all).toContain('pg.extract')          // nur-lesen bleibt
  })
})

describe('Enablement-Ports (§2: nur was wirkt, ist da)', () => {
  it('kein Dokument -> keine Dokument-Aktion aktiv, leere Menüs; globale Befehle bleiben', () => {
    const c = ctx({ docOpen: false })
    const docScoped = COMMANDS.filter((x) => x.group !== 'global' && x.group !== 'view' && x.group !== 'annotation')
    expect(docScoped.every((x) => !x.isEnabled(c))).toBe(true)
    expect(toolbarGroups(c)).toEqual([])
    const m = contextMenuFor('thumbnail', c)
    expect(m.primary.length + (m.groups ?? []).length + m.destructive.length).toBe(0)
    expect(getCommand('app.settings')?.isEnabled(c)).toBe(true)
  })

  it('readOnly: Mutationen aus, reine Leseaktionen an', () => {
    const c = ctx({ readOnly: true })
    expect(getCommand('pg.rotRight')?.isEnabled(c)).toBe(false)
    expect(getCommand('pg.delete')?.isEnabled(c)).toBe(false)
    expect(getCommand('pg.extract')?.isEnabled(c)).toBe(true)
    expect(getCommand('pg.export')?.isEnabled(c)).toBe(true)
  })

  it('Auswahl löschen nur mit Auswahl', () => {
    expect(getCommand('pg.clear')?.isEnabled(ctx({ selected: [] }))).toBe(false)
    expect(getCommand('pg.clear')?.isEnabled(ctx({ selected: [2] }))).toBe(true)
  })
})

describe('Annotations-Werkzeuge als Canvas-Menüpunkte (§6)', () => {
  const toolIds = ['ann.toolHighlight', 'ann.toolUnderline', 'ann.toolStrikeOut', 'ann.toolSquiggly', 'ann.toolNote', 'ann.toolFreeText']
  it('alle sechs vorhanden und bewaffnen dasselbe Store-Werkzeug wie die Palette', () => {
    for (const id of toolIds) expect(getCommand(id)).toBeDefined()
    const ui = useUiStore
    getCommand('ann.toolNote')?.run(ctx())
    expect(ui.getState().markupTool).toBe('Text')
    getCommand('ann.toolSquiggly')?.run(ctx())
    expect(ui.getState().markupTool).toBe('Squiggly')
    ui.getState().cancelMarkup()
  })
  it('kein Dokument / readOnly -> deaktiviert; Canvas-Menü ohne Auswahl zeigt Tools, thumbnail nicht', () => {
    expect(toolIds.every((id) => !getCommand(id)?.isEnabled(ctx({ docOpen: false })))).toBe(true)
    expect(toolIds.every((id) => !getCommand(id)?.isEnabled(ctx({ readOnly: true })))).toBe(true)
    const canvas = contextMenuFor('canvas', ctx())
    expect(flatModel(canvas)).toContain('ann.toolHighlight')
    const th = contextMenuFor('thumbnail', ctx())
    expect(flatModel(th).filter((i) => i.startsWith('ann.tool'))).toEqual([])
  })
})

describe('§6-Regel: JEDE Toolbar-Aktion ist per Rechtsklick erreichbar (maschinell)', () => {
  it('Toolbar-Ids ⊆ Thumbnail-Menü ∪ Canvas-Menü (bei vollem, editierbarem Dokument)', () => {
    const full = ctx()
    const toolbarIds = toolbarGroups(full).flatMap((g) => g.items.map((c) => c.id))
    expect(toolbarIds.length).toBeGreaterThan(10) // Guard gegen sich selbst: echte Liste
    const menuIds = new Set([...flatModel(contextMenuFor('thumbnail', full)), ...flatModel(contextMenuFor('canvas', full))])
    const unreachable = toolbarIds.filter((id) => !menuIds.has(id))
    expect(unreachable).toEqual([])
  })
})

describe('dispatchCommand (Menü-Bar-Pfad, §6)', () => {
  it('unbekannte id -> No-Op; Gate aus (kein Dokument) -> kein Lauf; aktive id wirkt auf echten Store', () => {
    useUiStore.setState({ settingsOpen: false })
    dispatchCommand('gibt.es.nicht')                       // No-Op, kein Wurf
    dispatchCommand('app.settings')                        // aktiv ohne Dokument (global)
    expect(useUiStore.getState().settingsOpen).toBe(true)
    useUiStore.setState({ settingsOpen: false })
    dispatchCommand('file.save')                           // Gate: kein Dokument -> kein Lauf
    expect(useUiStore.getState().settingsOpen).toBe(false)
  })

  it('R58: Signaturen entfernen nur bei signedDoc, zerstoererisch, im PDF-Fluegel', () => {
    const base = { docOpen: true, readOnly: false, mutationLock: false, currentPage: 1, pageCount: 3, selected: [], textSelected: false, stamping: false } as const
    const ohne = contextMenuFor('canvas', { ...base })
    const mit = contextMenuFor('canvas', { ...base, signedDoc: true })
    const inAny = (m: ReturnType<typeof contextMenuFor>) =>
      m.primary.some((c) => c.id === 'pg.removeSigs') || m.destructive.some((c) => c.id === 'pg.removeSigs') || (m.groups ?? []).some((g) => g.items.some((c) => c.id === 'pg.removeSigs'))
    expect(inAny(ohne), 'ohne Signaturen: kein Eintrag').toBe(false)
    expect(inAny(mit), 'mit Signaturen: Eintrag da').toBe(true)
    const cmd = mit.groups?.find((g) => g.id === 'grp.pdf')?.items.find((c) => c.id === 'pg.removeSigs')
    expect(cmd?.destructive, 'rot/zerstoererisch').toBe(true)
    expect(mit.primary.some((c) => c.id === 'pg.removeSigs')).toBe(false)
  })
})
