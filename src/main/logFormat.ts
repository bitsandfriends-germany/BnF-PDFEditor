import type { LogEntry, LogLevel } from '@shared/ipc'

const ALLOWED_LEVELS: ReadonlySet<LogLevel> = new Set([
  'error',
  'warn',
  'info',
  'verbose',
  'debug',
  'silly'
])

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && ALLOWED_LEVELS.has(value as LogLevel)
}

function serializeError(err: unknown): NonNullable<LogEntry['error']> | undefined {
  if (err === undefined || err === null) return undefined
  if (err instanceof Error) {
    return {
      type: err.name,
      message: err.message,
      ...(err.stack ? { stacktrace: err.stack } : {})
    }
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>
    const type = typeof obj.type === 'string' ? obj.type : 'Error'
    const message = typeof obj.message === 'string' ? obj.message : String(err)
    const stack = typeof obj.stack === 'string' ? obj.stack : undefined
    return stack ? { type, message, stacktrace: stack } : { type, message }
  }
  return { type: 'Error', message: String(err) }
}

export interface BuildEntryInput {
  level: LogLevel
  action: string
  source?: LogEntry['source']
  correlationId?: string
  payload?: Record<string, unknown>
  error?: unknown
  // injectierbar, damit der Aufrufer die Uhr für Tests kontrollieren kann
  now?: () => Date
}

export function buildLogEntry(input: BuildEntryInput): LogEntry {
  const ts = (input.now ?? (() => new Date()))().toISOString()
  const entry: LogEntry = {
    ts,
    source: input.source ?? 'main',
    level: isLogLevel(input.level) ? input.level : 'info',
    action: input.action
  }
  if (input.correlationId !== undefined) entry.correlationId = input.correlationId
  if (input.payload !== undefined) entry.payload = input.payload
  const error = serializeError(input.error)
  if (error !== undefined) entry.error = error
  return entry
}

// Genau ein JSON-Objekt pro Zeile (JSONL, Section 6): nach crash zeilenweise parsebar.
// Keine einbettende Array-Huelle, kein abschliessendes Newline (das fuegt der Transport an).
export function formatJsonlLine(entry: LogEntry): string {
  return JSON.stringify(entry)
}
