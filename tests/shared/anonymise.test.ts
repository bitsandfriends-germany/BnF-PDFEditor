import { describe, it, expect } from 'vitest'
import { createAnonymiser } from '@shared/anonymise'

describe('anonymise — Pfad-/Namen-Anonymisierung (Section 6)', () => {
  it('ersetzt absolute Unix-Pfade durch stabile Tokens', () => {
    const a = createAnonymiser()
    const out = a.anonymise('Datei /home/iambarth/Documents/geheim.pdf geladen') as string
    expect(out).not.toContain('/home')
    expect(out).not.toContain('geheim')
    expect(out).toMatch(/<PFAD-\d+>/)
  })

  it('gleicher Pfad -> gleicher Token (stabil), unterschiedlicher -> anderer', () => {
    const a = createAnonymiser()
    const s = a.anonymise({ a: '/var/log/x', b: '/var/log/x', c: '/var/log/y' }) as Record<string, string>
    expect(s.a).toBe(s.b)
    expect(s.a).not.toBe(s.c)
  })

  it('Home-Pfad wird zu <HOME>', () => {
    const a = createAnonymiser('/home/max')
    expect(a.anonymise('pfad=/home/max/doc.pdf')).toContain('<HOME>')
  })

  it('reist durch Objekte/Arrays und laesst Zahlen/Booles unangetastet', () => {
    const a = createAnonymiser()
    const out = a.anonymise({ p: ['/etc/passwd'], n: 42, b: true }) as { p: string[]; n: number; b: boolean }
    expect(out.p[0]).toMatch(/<PFAD-\d+>/)
    expect(out.n).toBe(42)
    expect(out.b).toBe(true)
  })

  it('Windows-Laufwerkspfad wird anonymisiert', () => {
    const a = createAnonymiser()
    expect(a.anonymise('C:\\Users\\bob\\a.pdf')).not.toContain('bob')
  })
})
