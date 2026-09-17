import { describe, it, expect } from 'vitest'
import { parseListeningLine, parseBackendLogLine, computeBackoffSchedule } from '../../src/main/backendProcess'

describe('parseListeningLine (Section 2)', () => {
  it('akzeptiert eine korrekte Listening-Zeile', () => {
    const r = parseListeningLine('{"event":"listening","port":41234,"pid":8123,"protocolVersion":"1.0"}')
    expect(r).toEqual({ ok: true, port: 41234, pid: 8123, protocolVersion: '1.0' })
  })
  it('lehnt Nicht-JSON ab', () => {
    expect(parseListeningLine('Starting ...').ok).toBe(false)
  })
  it('lehnt falsches Event ab', () => {
    expect(parseListeningLine('{"event":"ready","port":1,"pid":1,"protocolVersion":"1.0"}').ok).toBe(false)
  })
  it('erkennt Protocol-Mismatch als Fehler (nicht stilles Ignorieren)', () => {
    const r = parseListeningLine('{"event":"listening","port":1,"pid":1,"protocolVersion":"2.0"}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Protocol-Mismatch/)
  })
  it('lehnt ungueltigen Port ab', () => {
    expect(parseListeningLine('{"event":"listening","port":0,"pid":1,"protocolVersion":"1.0"}').ok).toBe(false)
    expect(parseListeningLine('{"event":"listening","port":99999,"pid":1,"protocolVersion":"1.0"}').ok).toBe(false)
  })
})

describe('parseBackendLogLine (Log-Bridge, Section 6)', () => {
  it('uebernimmt Felder eines Backend-JSON-Eintrags', () => {
    const e = parseBackendLogLine(
      '{"ts":"2026-09-13T14:22:01.412Z","level":"error","action":"PDF_ROTATE","correlationId":"c7f1","payload":{"page":4},"error":{"type":"FileDataError","message":"x"}}'
    )
    expect(e.source).toBe('backend')
    expect(e.level).toBe('error')
    expect(e.action).toBe('PDF_ROTATE')
    expect(e.correlationId).toBe('c7f1')
    expect(e.payload).toEqual({ page: 4 })
    expect(e.error).toEqual({ type: 'FileDataError', message: 'x' })
    expect(e.ts).toBe('2026-09-13T14:22:01.412Z')
  })
  it('verpackt Nicht-JSON-Zeilen als Text, ohne zu crashen', () => {
    const e = parseBackendLogLine('plain warning text')
    expect(e.source).toBe('backend')
    expect(e.action).toBe('BACKEND_LOG')
    expect(e.payload).toEqual({ text: 'plain warning text' })
  })
  it('erzwingt source=backend selbst bei gefaelschtem source', () => {
    const e = parseBackendLogLine('{"level":"info","action":"A","source":"main"}')
    expect(e.source).toBe('backend')
  })
  it('unbekannter Level faellt auf info zurueck', () => {
    expect(parseBackendLogLine('{"level":"bogus","action":"A"}').level).toBe('info')
  })
})

describe('computeBackoffSchedule (max 15 s, Section 2)', () => {
  it('haelt das Gesamt-Budget exakt ein', () => {
    const s = computeBackoffSchedule(1000)
    const sum = s.reduce((a, b) => a + b, 0)
    expect(sum).toBeLessThanOrEqual(1000)
    expect(sum).toBeGreaterThan(900)
    expect(s.every((d) => d > 0)).toBe(true)
  })
  it('waechst exponentiell und ist gedeckelt', () => {
    const s = computeBackoffSchedule(15000, 100, 1.6, 1000)
    expect(s[0]).toBe(100)
    expect(Math.max(...s)).toBeLessThanOrEqual(1000)
    expect(s.length).toBeGreaterThan(5)
  })
})
