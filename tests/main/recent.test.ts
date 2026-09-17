import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { addRecent, removeRecent, readRecent, recentWithExistence } from '../../src/main/recentFiles'

// Reine fs-Logik der Recent-Liste, ohne Electron. tmp-Dir je Test.

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('recentFiles', () => {
  it('leer, wenn keine Datei', () => {
    expect(readRecent(dir)).toEqual([])
  })
  it('neueste zuerst, Dedupe nach Pfad', () => {
    addRecent(dir, '/a.pdf')
    addRecent(dir, '/b.pdf')
    addRecent(dir, '/a.pdf') // schon drin -> nach vorne
    const list = readRecent(dir)
    expect(list.map((e) => e.path)).toEqual(['/a.pdf', '/b.pdf'])
  })
  it('max 15, aelteste fallen raus', () => {
    for (let i = 0; i < 20; i++) addRecent(dir, `/f${i}.pdf`)
    const list = readRecent(dir)
    expect(list).toHaveLength(15)
    expect(list[0]?.path).toBe('/f19.pdf')
    expect(list.some((e) => e.path === '/f0.pdf')).toBe(false)
  })
  it('remove entfernt Eintrag', () => {
    addRecent(dir, '/a.pdf'); addRecent(dir, '/b.pdf')
    const next = removeRecent(dir, '/a.pdf')
    expect(next.map((e) => e.path)).toEqual(['/b.pdf'])
  })
  it('Existenz-Flag: vorhandene true, fehlende false', () => {
    const real = path.join(dir, 'real.pdf'); fs.writeFileSync(real, 'x')
    addRecent(dir, real); addRecent(dir, path.join(dir, 'ghost.pdf'))
    const w = recentWithExistence(dir)
    expect(w.find((e) => e.path === real)?.exists).toBe(true)
    expect(w.find((e) => e.path.endsWith('ghost.pdf'))?.exists).toBe(false)
  })
})
