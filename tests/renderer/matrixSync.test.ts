import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { COMMANDS } from '@/lib/commands'

// §7.1: Die Matrix ist aus der Registry gebaut und darf nichtdriften — dieser Test ist der
// Guard, das Skript scripts/verification-matrix.mjs prüft dasselbe in CI/lokal.

const BEGIN = '<!-- REGISTRY-MATRIX:BEGIN -->'
const END = '<!-- REGISTRY-MATRIX:END -->'

describe('Verifikations-Matrix == Command-Registry (§7.1)', () => {
  const doc = readFileSync(path.resolve(__dirname, '../../docs/verification-matrix.md'), 'utf8')
  const b = doc.indexOf(BEGIN)
  const e = doc.indexOf(END)
  const section = b !== -1 && e > b ? doc.slice(b, e) : ''

  it(' Abschnitt existiert', () => {
    expect(b).toBeGreaterThan(-1)
    expect(e).toBeGreaterThan(b)
  })

  it('jede Registry-Zeile fehlt in der Matrix', () => {
    const missing = COMMANDS.map((c) => c.id).filter((id) => !section.includes('`' + id + '`'))
    expect(missing).toEqual([])
  })

  it('keine Matrix-Zeile ohne Registry-Befehl (keine Geisterkontrollen)', () => {
    const ids = new Set(COMMANDS.map((c) => c.id))
    const ghosts = [...section.matchAll(/^\|\s*`([a-zA-Z0-9.]+)`\s*\|/gm)]
      .map((m) => m[1] as string)
      .filter((id) => !ids.has(id))
    expect(ghosts).toEqual([])
  })

  it('jede Zeile trägt eine Beweismarke (Testname oder OFFEN/kein Dokumenteffekt)', () => {
    const weak: string[] = []
    for (const m of section.matchAll(/^\|\s*`([a-zA-Z0-9.]+)`\s*\|.*\|$/gm)) {
      const line = m[0]
      if (!/\.py::|\.test\.tsx?|\.spec\.ts|selection\.test|OFFEN|kein Dokumenteffekt/.test(line)) {
        weak.push(m[1] as string)
      }
    }
    expect(weak).toEqual([])
  })
})
