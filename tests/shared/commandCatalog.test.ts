import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildCatalogSource } from '../../scripts/command-catalog.mjs'

// Der generierte Katalog DARF nicht veraltet sein: wer commands.ts ändert, muss neu generieren
// (node scripts/command-catalog.mjs). Das verhindert, dass Menü-Bar und Registry driften.
describe('commandCatalog.gen.ts ist frisch (§6 eine Quelle)', () => {
  it('entspricht der Neu-Generierung aus commands.ts', () => {
    const src = readFileSync(path.resolve(__dirname, '../../src/renderer/lib/commands.ts'), 'utf8')
    const expected = buildCatalogSource(src)
    const actual = readFileSync(path.resolve(__dirname, '../../src/shared/commandCatalog.gen.ts'), 'utf8')
    expect(actual).toBe(expected)
  })
})
