import { describe, it, expect } from 'vitest'
import { toolbarLayout, groupWidth, overflowMenuModel, BTN_W, BTN_GAP, SEP_W, OVERFLOW_W } from '@/lib/toolbarOverflow'
import { COMMANDS, TOOLBAR_GROUPS, type CommandDef, type ToolbarGroup } from '@/lib/commands'

// §5: Die Leiste bricht nie um; Gruppen ziehen VOLLSTÄNDIG in den Überlauf, nie intern getrennt;
// der Überlauf behält die Gruppenreihenfolge. Reine Modell-Tests (Breitenmetrik bekannt).

const cmd = (id: string, destructive = false): CommandDef => ({
  id, labelKey: id, group: 'rotate', icon: 'X', testid: `x-${id}`, order: 1,
  isEnabled: () => true, run: () => {}, ...(destructive ? { destructive: true } : {})
})

function mapOf(spec: [ToolbarGroup, number][]): Map<ToolbarGroup, CommandDef[]> {
  return new Map(spec.map(([g, n]) => [g, Array.from({ length: n }, (_, i) => cmd(`${g}${i}`))]))
}

describe('toolbarLayout (§5)', () => {
  it('genug Platz -> alles inline, kein Überlauf', () => {
    const m = mapOf([['rotate', 3], ['arrange', 2]])
    const need = 5 * BTN_W + 4 * BTN_GAP + SEP_W
    expect(toolbarLayout(m, need)).toEqual({ inline: ['rotate', 'arrange'], overflow: [] })
  })

  it('Gruppe + Reservierung passen nicht -> vollständige Gruppen in den Überlauf (kein Teil einer Gruppe)', () => {
    const m = mapOf([['rotate', 3], ['arrange', 2]])
    // rotate braucht 3*28+2*4=92. available=120 reserviert 40 für ⋯ -> nur 80 inline: rotate passt
    // nicht komplett -> BOTH groups move whole. Gruppen werden nie intern getrennt.
    const l = toolbarLayout(m, 120)
    expect(l.inline).toEqual([])
    expect(l.overflow).toEqual(['rotate', 'arrange'])
  })

  it('mittenbreit: vordere Gruppen inline, hintere vollständig im Überlauf, Reihenfolge erhalten', () => {
    const m = mapOf([['rotate', 3], ['arrange', 2], ['content', 5]])
    // rotate 92; +SEP+arrange(64)=165 <= 260-40=220; +content(156) = 330 > 220 -> content raus.
    const l = toolbarLayout(m, 260)
    expect(l.inline).toEqual(['rotate', 'arrange'])
    expect(l.overflow).toEqual(['content'])
  })

  it('extrem schmaler Raum -> alles im Überlauf, nichts wird abgeschnitten', () => {
    const m = mapOf([['rotate', 3], ['arrange', 2], ['content', 5]])
    const l = toolbarLayout(m, 20)
    expect(l.inline).toEqual([])
    expect(l.overflow).toEqual(['rotate', 'arrange', 'content'])
  })

  it('Überlauf behält §5-Gruppenreihenfolge; Gesamtmenge unverändert', () => {
    const m = new Map<ToolbarGroup, CommandDef[]>(TOOLBAR_GROUPS.map((g) => [g, [cmd(`${g}a`), cmd(`${g}b`)]]))
    const l = toolbarLayout(m, 100)
    const all = [...l.inline, ...l.overflow]
    expect(all.length).toBe(TOOLBAR_GROUPS.length)
    const orderOk = TOOLBAR_GROUPS.filter((g) => all.includes(g))
    expect(all).toEqual(orderOk)
  })

  it('leere Gruppen zählen nicht', () => {
    const m = new Map<ToolbarGroup, CommandDef[]>([['rotate', [cmd('a'), cmd('b'), cmd('c')]], ['selection', []]])
    const l = toolbarLayout(m, 3 * BTN_W + 2 * BTN_GAP)
    expect(l.inline).toEqual(['rotate'])
    expect(l.overflow).toEqual([])
  })

  it('Breitenmetrik: n Knöpfe = n*28 + (n-1)*4; Gruppe separat', () => {
    expect(groupWidth([cmd('a')])).toBe(BTN_W)
    expect(groupWidth([cmd('a'), cmd('b')])).toBe(2 * BTN_W + BTN_GAP)
    expect(groupWidth([])).toBe(0)
  })

  it('Grenzfall exakte Passung ohne Überlauf (<= available)', () => {
    const m = mapOf([['rotate', 1], ['arrange', 1]])
    const exact = 2 * BTN_W + SEP_W
    expect(toolbarLayout(m, exact).overflow).toEqual([])
    expect(toolbarLayout(m, exact - 1).overflow.length).toBeGreaterThan(0)
  })

  it('Reservierung: Überfall-Knopf kostet OVERFLOW_W, daher kippt Earlier als naiv', () => {
    // Zwei Gruppen à 1 Knopf: 28+9+28=65. available=70 -> passt ohne Überlauf; available=60 ->
    // mit ⋯ bleiben nur 20 -> keine Gruppe passt inline.
    const m = mapOf([['rotate', 1], ['arrange', 1]])
    expect(toolbarLayout(m, 70).inline).toEqual(['rotate', 'arrange'])
    const l = toolbarLayout(m, 60)
    expect(l.inline).toEqual([])
    expect(l.overflow).toEqual(['rotate', 'arrange'])
    void OVERFLOW_W
  })
})

describe('overflowMenuModel', () => {
  it('zerstörerische Einträge in eigener Liste, Rest primär', () => {
    const m = mapOf([['arrange', 2]])
    const items = [cmd('dup'), cmd('del', true)]
    const mod = overflowMenuModel(['arrange'], () => items)
    expect(mod.primary.map((c) => c.id)).toEqual(['dup'])
    expect(mod.destructive.map((c) => c.id)).toEqual(['del'])
    void m
  })
})
