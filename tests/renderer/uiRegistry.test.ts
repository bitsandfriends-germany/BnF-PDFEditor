// Wacht darueber, dass jedes UI-Element eine EIGENE (eindeutige) UID traegt.
// UID = data-testid. Zwei Regeln:
//  1) Jedes interaktive Control (button/input/select/textarea) muss ein data-testid haben.
//  2) Kein statisches data-testid darf doppelt vorkommen (dynamische `...-${x}` zaehlen als
//     ein Muster pro Datei und sind erlaubt, da sie zur Laufzeit eindeutig indiziert sind).
// So bleibt das UID-Register (docs/ui-registry.md) zuverlaessig: jede UID addressiert genau
// ein Element, das der Nutzer benennen und der Assistent bearbeiten kann.
import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.join(process.cwd(), 'src', 'renderer')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(fp))
    else if (entry.isFile() && fp.endsWith('.tsx')) out.push(fp)
  }
  return out
}

// Ende eines Oeffnungs-Tags finden (ignoriert "strings" und {exprs}, stoppt beim ersten '>' in Klammer-Tiefe 0).
function openingTagEnd(src: string, from: number): number {
  let depth = 0
  let j = from
  while (j < src.length) {
    const c = src[j]
    if (c === '"') { j++; while (j < src.length && src[j] !== '"') j++ }
    else if (c === "'") { j++; while (j < src.length && src[j] !== "'") j++ }
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return j
    j++
  }
  return src.length
}

const CONTROL = /<(button|input|select|textarea)\b/g
const STATIC_TESTID = /\sdata-testid="([^"]+)"/g
const DYN_TESTID = /\sdata-testid=\{/g

describe('UID-Integritaet (jedes Control traegt eine eigene UID)', () => {
  const files = walk(ROOT)

  it('hat jedes interaktive Control eine data-testid-UID', () => {
    const offenders: string[] = []
    for (const fp of files) {
      const src = fs.readFileSync(fp, 'utf8')
      let m: RegExpExecArray | null
      CONTROL.lastIndex = 0
      while ((m = CONTROL.exec(src))) {
        const end = openingTagEnd(src, m.index + m[0].length)
        const tag = src.slice(m.index, end)
        if (!tag.includes('data-testid')) {
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${path.relative(process.cwd(), fp)}:${line} <${m[1]}>`)
        }
      }
    }
    expect(offenders, `Controls ohne UID:\n${offenders.join('\n')}`).toEqual([])
  })

  it('verwendet keine statische UID zweimal', () => {
    const seen = new Map<string, string>()
    const dups: string[] = []
    for (const fp of files) {
      const src = fs.readFileSync(fp, 'utf8')
      let m: RegExpExecArray | null
      STATIC_TESTID.lastIndex = 0
      while ((m = STATIC_TESTID.exec(src))) {
        const id = m[1] as string
        const where = `${path.relative(process.cwd(), fp)}:${src.slice(0, m.index).split('\n').length}`
        const prev = seen.get(id)
        if (prev) dups.push(`${id}: ${prev} UND ${where}`)
        else seen.set(id, where)
      }
      // Dynamische UIDs nur zaehlen, damit das Muster nicht als statisch durchrauscht (kein Assert noetig).
      DYN_TESTID.lastIndex = 0
      while ((m = DYN_TESTID.exec(src))) { /* noop: bewusst erlaubt */ }
    }
    expect(dups, `Doppelte statische UIDs:\n${dups.join('\n')}`).toEqual([])
  })
})
