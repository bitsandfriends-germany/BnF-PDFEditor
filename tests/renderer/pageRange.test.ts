// Konformitaetstests fuer den Renderer-Spiegel des Seitenbereichs-Parsers (Section 3).
// Laedt dieselbe tests/pagerange.table.json wie der Backend-Test — die Paritaet ist damit
// erzwungen: weichen Parser oder Spiegel voneinander ab, schlaegt genau eine Suite fehl.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parsePageRange, parsePageRangeSet } from '@/lib/pageRange'

interface Case {
  expr: string
  total: number
  pages?: number[]
  error?: boolean
}

// Vitest laeuft mit process.cwd() auf dem Projekt-Wurzelverzeichnis; import.meta.url hat hier
// kein file:-Schema, daher der Pfad relativ zu cwd (kein URL-Parsing — der Pfad enthaelt '&').
const tablePath = join(process.cwd(), 'tests', 'pagerange.table.json')
const cases = (JSON.parse(readFileSync(tablePath, 'utf8')) as { cases: Case[] }).cases

describe('pageRange Spiegel ≡ gemeinsame Konformitaetstabelle', () => {
  it('laedt die geteilte Tabelle', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30)
  })

  for (const c of cases) {
    const label = `${JSON.stringify(c.expr)}/${c.total}`
    it(label, () => {
      const r = parsePageRange(c.expr, c.total)
      if (c.error) {
        expect(r.ok).toBe(false)
      } else {
        expect(r.ok).toBe(true)
        if (r.ok) expect(r.pages).toEqual(c.pages)
      }
    })
  }
})

describe('pageRange Invarianten', () => {
  for (const c of cases) {
    if (c.error) continue
    it(`Gueltigkeit ${JSON.stringify(c.expr)}/${c.total}`, () => {
      const r = parsePageRange(c.expr, c.total)
      if (!r.ok) return
      expect(new Set(r.pages).size).toBe(r.pages.length)
      for (const p of r.pages) expect(p).toBeGreaterThanOrEqual(1)
      for (const p of r.pages) expect(p).toBeLessThanOrEqual(c.total)
    })
  }
})

describe('pageRange Set-Helfer', () => {
  it('liefert aufsteigende, deduplizierte Menge', () => {
    const r = parsePageRangeSet('5,3,5,3,1', 10)
    expect(r).toEqual({ ok: true, pages: [1, 3, 5] })
  })
})
