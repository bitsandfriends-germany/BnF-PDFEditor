import { describe, it, expect } from 'vitest'
import { planRotation } from '../../src/main/logRotation'

const A = '/logs/debug.jsonl'

describe('planRotation (10 MB / max 5 Dateien)', () => {
  it('ohne vorhandene Archive: verschiebt aktive Datei auf .1', () => {
    expect(planRotation(A, [], 5)).toEqual([{ kind: 'rename', from: A, to: `${A}.1` }])
  })

  it('rotiert die Kette und loescht das aelteste Archiv (Index 4), Gesamtzahl bleibt 5', () => {
    const ops = planRotation(A, [1, 2, 3, 4], 5)
    expect(ops).toEqual([
      { kind: 'delete', target: `${A}.4` },
      { kind: 'rename', from: `${A}.3`, to: `${A}.4` },
      { kind: 'rename', from: `${A}.2`, to: `${A}.3` },
      { kind: 'rename', from: `${A}.1`, to: `${A}.2` },
      { kind: 'rename', from: A, to: `${A}.1` }
    ])
  })

  it('schiebt nur die Existierenden, keine Geister-Umbenennungen', () => {
    const ops = planRotation(A, [1], 5)
    expect(ops).toEqual([
      { kind: 'rename', from: `${A}.1`, to: `${A}.2` },
      { kind: 'rename', from: A, to: `${A}.1` }
    ])
  })

  it('maxFiles=1 (keine Archive) verwirft die aktive Datei', () => {
    expect(planRotation(A, [], 1)).toEqual([{ kind: 'delete', target: A }])
  })

  it('Invariante: nach Rotation existieren nie mehr als maxFiles Dateien', () => {
    // Ausgangslage: aktive + 4 Archive = 5. Nach Rotation: aktive(neu) + 4 Archive = 5.
    const existingArchives = [1, 2, 3, 4]
    let files = new Set([A, `${A}.1`, `${A}.2`, `${A}.3`, `${A}.4`])
    for (const op of planRotation(A, existingArchives, 5)) {
      if (op.kind === 'delete') files.delete(op.target)
      else {
        files.delete(op.from)
        files.add(op.to)
      }
    }
    // aktive Datei wird vom Logger neu angelegt
    files.add(A)
    expect(files.size).toBeLessThanOrEqual(5)
  })
})
