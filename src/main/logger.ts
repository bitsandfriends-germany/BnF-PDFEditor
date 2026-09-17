import log from 'electron-log/main'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import type { LogEntry, LogLevel } from '@shared/ipc'
import { buildLogEntry, formatJsonlLine, type BuildEntryInput } from './logFormat'
import { makeArchiveLogFn, ROTATION } from './logRotation'

// Section 1: electron-log wird ausschliesslich als Datei-Transport im Main-Prozess verwendet
// (JSONL, Section 6). Der einzige persistente Zielort ist debug.jsonl. Console-Transport und
// IPC-Transport werden abgeschaltet, damit es genau EINEN Zielort gibt (Single-Writer, Section 6).

const LOG_DIR_NAME = 'pdf-editor'
const LOG_FILE_NAME = 'debug.jsonl'

function resolveLogDir(): string {
  const stateHome = process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME.trim() !== ''
    ? process.env.XDG_STATE_HOME
    : path.join(os.homedir(), '.local', 'state')
  return path.join(stateHome, LOG_DIR_NAME, 'logs')
}

export interface LoggerHandle {
  logDir: string
  logFile: string
  write(entry: LogEntry): void
  entry(input: BuildEntryInput): LogEntry
  // Letzte N gueltige JSONL-Zeilen der Logdatei (fuer die Debug-Konsole, Section 6). Fehlerhafte
  // Zeilen werden uebersprungen; die Rueckgabe ist zeitlich aufsteigend (aelteste zuerst).
  readTail(n: number): LogEntry[]
}

let configured = false
let cachedDir: string | null = null

export function initLogger(onWrite?: (entry: LogEntry) => void): LoggerHandle {
  const logDir = resolveLogDir()
  cachedDir = logDir
  // Verzeichnis mit beschraenkten Rechten anlegen (0700), wie in Section 2/6 vorgesehen.
  fs.mkdirSync(logDir, { recursive: true, mode: 0o700 })

  if (!configured) {
    // Datei-Transport: exklusiver Zielort
    log.transports.file.resolvePathFn = () => path.join(logDir, LOG_FILE_NAME)
    log.transports.file.level = 'silly'
    log.transports.file.maxSize = ROTATION.maxSizeBytes
    log.transports.file.sync = true
    log.transports.file.archiveLogFn = makeArchiveLogFn()
    // serialize: wir haben den Eintrag bereits als fertig strukturiertes Objekt reingegeben
    log.transports.file.format = (params) => {
      const first = params.data[0]
      if (first && typeof first === 'object' && 'ts' in first && 'level' in first && 'action' in first) {
        return [formatJsonlLine(first as LogEntry)]
      }
      // Fallback fuer fremde Aufrufe: als Nachrichtentext in einem Gueltigen JSONL-Eintrag
      const fallback = buildLogEntry({
        level: (params.level as LogLevel) ?? 'info',
        action: 'UNSTRUCTURED',
        payload: { text: params.data }
      })
      return [formatJsonlLine(fallback)]
    }

    // keine zweiten Zielorte
    log.transports.console.level = false
    log.transports.ipc.level = false
    log.transports.remote.level = false

    configured = true
  }

  const logFile = path.join(logDir, LOG_FILE_NAME)

  const write = (entry: LogEntry): void => {
    const fn = levelToFunction(entry.level)
    // Das vorbereitete Objekt ist der einzige Transport-Argument; der Format-String serialisiert es.
    fn(entry)
    // Live-Spiegel an die Debug-Konsole (main -> renderer). Kein zweiter Datei-Schreibvorgang.
    try {
      onWrite?.(entry)
    } catch {
      /* ein abgebrogener Renderer-empfaenger darf das Logging nie brechen */
    }
  }

  const readTail = (n: number): LogEntry[] => {
    let raw: string
    try {
      raw = fs.readFileSync(logFile, 'utf8')
    } catch {
      return []
    }
    const lines = raw.split('\n').filter((l) => l.trim() !== '')
    const out: LogEntry[] = []
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as LogEntry
        if (e && typeof e.ts === 'string' && typeof e.level === 'string') out.push(e)
      } catch {
        /* unvollstaendige Zeile (Rotation/Crash) ueberspringen */
      }
    }
    return out.slice(Math.max(0, out.length - n))
  }

  return {
    logDir,
    logFile,
    write,
    entry: (input: BuildEntryInput) => buildLogEntry(input),
    readTail
  }
}

type LogFn = (data: unknown) => void

function levelToFunction(level: LogLevel): LogFn {
  switch (level) {
    case 'error':
      return log.error
    case 'warn':
      return log.warn
    case 'info':
      return log.info
    case 'verbose':
      return log.verbose
    case 'debug':
      return log.debug
    case 'silly':
      return log.silly
    default:
      return log.info
  }
}

// Bequemer Einstiegspunkt fuer den Main-Prozess.
export function logMain(input: BuildEntryInput): void {
  const dir = cachedDir ?? resolveLogDir()
  void dir
  const fn = levelToFunction(input.level)
  fn(buildLogEntry(input))
}
