import type { LogEntry, LogLevel } from '@shared/ipc'

// Reine, electron-freie Kernfunktionen der Prozess-Orchestrierung — deshalb in Vitest testbar.

export const PROTOCOL_VERSION = '1.0'

export type ListeningResult =
  | { ok: true; port: number; pid: number; protocolVersion: string }
  | { ok: false; reason: string }

// Section 2: die allererste stdout-Zeile ist exakt
// {"event":"listening","port":<int>,"pid":<int>,"protocolVersion":"1.0"}.
// Passt sie nicht oder nicht pünktlich => Start gilt als Crash.
export function parseListeningLine(line: string): ListeningResult {
  const trimmed = line.trim()
  if (trimmed === '') return { ok: false, reason: 'leere erste Zeile' }
  let obj: unknown
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return { ok: false, reason: 'erste stdout-Zeile ist kein JSON' }
  }
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'erste stdout-Zeile ist kein Objekt' }
  const o = obj as Record<string, unknown>
  if (o.event !== 'listening') return { ok: false, reason: 'erstes Event ist nicht "listening"' }
  if (typeof o.port !== 'number' || !Number.isInteger(o.port) || o.port <= 0 || o.port > 65535) {
    return { ok: false, reason: 'ungueltiger Port in der Listening-Zeile' }
  }
  if (typeof o.pid !== 'number' || !Number.isInteger(o.pid) || o.pid <= 0) {
    return { ok: false, reason: 'ungueltige pid in der Listening-Zeile' }
  }
  if (typeof o.protocolVersion !== 'string' || o.protocolVersion.length === 0) {
    return { ok: false, reason: 'fehlende protocolVersion' }
  }
  if (o.protocolVersion !== PROTOCOL_VERSION) {
    return { ok: false, reason: `Protocol-Mismatch: Backend ${o.protocolVersion}, erwartet ${PROTOCOL_VERSION}` }
  }
  return { ok: true, port: o.port, pid: o.pid, protocolVersion: o.protocolVersion }
}

const ALLOWED_LEVELS: ReadonlySet<string> = new Set(['error', 'warn', 'info', 'verbose', 'debug', 'silly'])

function coerceLevel(value: unknown): LogLevel {
  return typeof value === 'string' && ALLOWED_LEVELS.has(value) ? (value as LogLevel) : 'info'
}

// Log-Bridge (Section 6): nach der Listening-Zeile ist jede stdout-Zeile ein JSON-Logeintrag
// des Backends. Fremde/Nicht-JSON-Zeilen werden als Text in einen gueltigen Eintrag verpackt.
export function parseBackendLogLine(line: string, fallbackCorrelationId?: string): LogEntry {
  const trimmed = line.trim()
  const base: LogEntry = {
    ts: new Date().toISOString(),
    source: 'backend',
    level: 'info',
    action: 'BACKEND_LOG'
  }
  if (trimmed === '') return base
  let obj: unknown
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return { ...base, payload: { text: trimmed } }
  }
  if (!obj || typeof obj !== 'object') return { ...base, payload: { text: trimmed } }
  const o = obj as Record<string, unknown>
  const entry: LogEntry = {
    ts: typeof o.ts === 'string' ? o.ts : base.ts,
    source: 'backend',
    level: coerceLevel(o.level),
    action: typeof o.action === 'string' ? o.action : 'BACKEND_LOG'
  }
  const corr = typeof o.correlationId === 'string' ? o.correlationId : fallbackCorrelationId
  if (corr !== undefined) entry.correlationId = corr
  if (o.payload && typeof o.payload === 'object') entry.payload = o.payload as Record<string, unknown>
  if (o.error && typeof o.error === 'object') {
    const e = o.error as Record<string, unknown>
    entry.error = {
      type: typeof e.type === 'string' ? e.type : 'Error',
      message: typeof e.message === 'string' ? e.message : '',
      ...(typeof e.stacktrace === 'string' ? { stacktrace: e.stacktrace } : {})
    }
  }
  return entry
}

// Exponentielles Backoff-Schema fuer /health bis zu einem Gesamt-Budget (Section 2: max 15 s).
// Laeufer: base * factor^n, gedeckelt pro Schritt, bis das Budget aufgebraucht ist.
export function computeBackoffSchedule(maxTotalMs: number, baseMs = 100, factor = 1.6, capMs = 1000): number[] {
  const schedule: number[] = []
  let spent = 0
  let delay = baseMs
  while (spent < maxTotalMs) {
    const step = Math.min(delay, capMs)
    if (spent + step > maxTotalMs) {
      schedule.push(maxTotalMs - spent)
      break
    }
    schedule.push(step)
    spent += step
    delay *= factor
  }
  return schedule
}
