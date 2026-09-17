import { describe, it, expect } from 'vitest'
import { buildLogEntry, formatJsonlLine } from '../../src/main/logFormat'

const FIXED = () => new Date('2026-09-13T14:22:01.412Z')

describe('buildLogEntry', () => {
  it('erzeugt einen Eintrag exakt nach dem Section-6-Schema', () => {
    const entry = buildLogEntry({
      level: 'error',
      action: 'PDF_ROTATE',
      correlationId: 'c7f1',
      payload: { page: 4 },
      error: Object.assign(new Error('kaputt'), { name: 'FileDataError', stack: 'stack!' }),
      now: FIXED
    })
    expect(entry).toEqual({
      ts: '2026-09-13T14:22:01.412Z',
      source: 'main',
      level: 'error',
      action: 'PDF_ROTATE',
      correlationId: 'c7f1',
      payload: { page: 4 },
      error: { type: 'FileDataError', message: 'kaputt', stacktrace: 'stack!' }
    })
  })

  it('laesst optionale Felder weg, wenn nicht gesetzt', () => {
    const entry = buildLogEntry({ level: 'info', action: 'APP_START', now: FIXED })
    expect(entry).not.toHaveProperty('correlationId')
    expect(entry).not.toHaveProperty('payload')
    expect(entry).not.toHaveProperty('error')
  })

  it('serialisiert Fehler aus einem Nicht-Error-Objekt', () => {
    const entry = buildLogEntry({
      level: 'warn',
      action: 'A',
      error: { type: 'Timeout', message: 'zu langsam' },
      now: FIXED
    })
    expect(entry.error).toEqual({ type: 'Timeout', message: 'zu langsam' })
  })
})

describe('formatJsonlLine', () => {
  it('ist genau eine parsebare JSON-Zeile ohne umhuellendes Array', () => {
    const line = formatJsonlLine(buildLogEntry({ level: 'info', action: 'X', now: FIXED }))
    expect(line.includes('\n')).toBe(false)
    expect(() => JSON.parse(line)).not.toThrow()
    const round = JSON.parse(line)
    expect(round.action).toBe('X')
  })
})
