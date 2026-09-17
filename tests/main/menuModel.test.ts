import { describe, it, expect } from 'vitest'
import { buildMenuModel, catalogBarsCoverage } from '../../src/main/menuModel'
import { COMMAND_CATALOG } from '../../src/shared/commandCatalog.gen'

// §6: Die Menü-Bar ist aus demselben Katalog gebaut; der Klick transportiert NUR die id.
describe('buildMenuModel (§6, main-seitig, rein)', () => {
  it('jede Katalog-Aktion erscheint in genau einem Obermenü (keine Kopie, kein Verlust)', () => {
    expect(catalogBarsCoverage().missing).toEqual([])
    const sent: string[] = []
    const model = buildMenuModel({}, (id) => { sent.push(id) })
    const all = model.flatMap((b) => b.items.map((i) => i.label))
    expect(all.length).toBe(COMMAND_CATALOG.length)
    expect(new Set(all).size).toBe(COMMAND_CATALOG.length)
  })

  it('Klick sendet exakt die Befehls-id ans Fenster', () => {
    const sent: string[] = []
    const rot = COMMAND_CATALOG.find((c) => c.id === 'pg.rotRight')
    expect(rot).toBeDefined()
    const model = buildMenuModel({ [rot!.labelKey]: 'Rotate Right' }, (id) => { sent.push(id) })
    const pageBar = model.find((b) => b.label === 'Page')
    const item = pageBar?.items.find((i) => i.label === 'Rotate Right')
    expect(item).toBeDefined()
    item?.click()
    expect(sent).toEqual(['pg.rotRight'])
  })

  it('Gruppen sind nach order sortiert; leere Obermenüs fehlen', () => {
    const model = buildMenuModel({}, () => undefined)
    for (const bar of model) {
      expect(bar.items.length).toBeGreaterThan(0)
    }
    expect(model.map((b) => b.label)).toEqual(expect.arrayContaining(['File', 'Page', 'View']))
  })
})
