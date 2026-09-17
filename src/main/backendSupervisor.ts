import * as crypto from 'node:crypto'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import * as readline from 'node:readline'
import type { BackendStatusSnapshot } from '@shared/ipc'
import type { LoggerHandle } from './logger'
import type { SessionManager } from './sessionManager'
import { parseListeningLine, parseBackendLogLine, computeBackoffSchedule, PROTOCOL_VERSION } from './backendProcess'

const AUTH_ENV = 'PDF_EDITOR_BACKEND_TOKEN'
const LISTEN_TIMEOUT_MS = 15_000
const HEALTH_BUDGET_MS = 15_000
const KILL_GRACE_MS = 3_000

export interface SupervisorDeps {
  // Dev/Quellbetrieb: Interpreter + main.py. Paketiert (Step 12): frozenBinary (PyInstaller-onedir).
  interpreter?: string | undefined
  scriptPath?: string | undefined
  frozenBinary?: string | undefined
  logger: LoggerHandle
  session: SessionManager
  onStatus: (snapshot: BackendStatusSnapshot) => void
  // ueberschreibbar fuer Tests/Wayland-Minimalprofile.
  maxRestarts?: number
}

interface BackendInfo {
  port: number
  pid: number
  protocolVersion: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

export class BackendSupervisor {
  private readonly deps: Required<Pick<SupervisorDeps, 'maxRestarts'>> & SupervisorDeps
  private proc: ChildProcessByStdio<null, Readable, Readable> | null = null
  private token: string | null = null
  private info: BackendInfo | null = null
  private status: BackendStatusSnapshot = { status: 'starting' }
  private restarts = 0
  private shuttingDown = false
  private started = false

  constructor(deps: SupervisorDeps) {
    this.deps = { maxRestarts: 1, ...deps }
  }

  getStatus(): BackendStatusSnapshot {
    return this.status
  }

  // Nur fuer den Main-Prozess bestimmt — das Token verlaesst den Main NIEMALS (nicht Richtung Renderer).
  getAuthToken(): string | null {
    return this.token
  }

  getBaseUrl(): string | null {
    return this.info ? `http://127.0.0.1:${this.info.port}` : null
  }

  private emitStatus(partial: BackendStatusSnapshot): void {
    this.status = partial
    this.deps.onStatus(partial)
  }

  start(): void {
    if (this.started) return
    this.started = true
    void this.launch('initial')
  }

  private async launch(reason: 'initial' | 'restart'): Promise<void> {
    this.token = crypto.randomBytes(32).toString('base64url')
    this.emitStatus({ status: 'starting', restartCount: this.restarts })

    const { frozenBinary, interpreter, scriptPath } = this.deps
    const frozen = Boolean(frozenBinary)
    const cmd = frozen ? (frozenBinary as string) : interpreter
    const cmdArgs = frozen ? ([] as string[]) : [scriptPath as string]
    if (!cmd) {
      // Kein Startziel konfiguriert (weder frozenBinary noch Interpreter) -> echter Konfigurationsfehler.
      this.emitStatus({ status: 'crashed', restartCount: this.restarts })
      return
    }

    const child = spawn(cmd, cmdArgs, {
      env: { ...process.env, [AUTH_ENV]: this.token, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.proc = child

    this.deps.logger.write(
      this.deps.logger.entry({
        level: 'info',
        action: 'BACKEND_SPAWN',
        payload: { reason, pid: child.pid ?? null, command: cmd, frozen }
      })
    )

    const gotListening = new Promise<BackendInfo | null>((resolve) => {
      const rl = readline.createInterface({ input: child.stdout })
      let first = true
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          resolve(null)
        }
      }, LISTEN_TIMEOUT_MS)

      rl.on('line', (line) => {
        if (first) {
          first = false
          clearTimeout(timer)
          const parsed = parseListeningLine(line)
          if (!parsed.ok) {
            this.deps.logger.write(
              this.deps.logger.entry({
                level: 'error',
                action: 'BACKEND_HANDSHAKE_FAILED',
                payload: { reason: parsed.reason, raw: line.slice(0, 200) }
              })
            )
            if (!settled) {
              settled = true
              resolve(null)
            }
            return
          }
          this.info = { port: parsed.port, pid: parsed.pid, protocolVersion: parsed.protocolVersion }
          if (!settled) {
            settled = true
            resolve(this.info)
          }
          return
        }
        // Log-Bridge (Section 6): Backend-JSON-Zeilen in den zentralen Logger ueberfuehren.
        this.deps.logger.write(parseBackendLogLine(line))
      })

      child.stderr.on('data', (buf: Buffer) => {
        const text = buf.toString('utf8').trimEnd()
        if (text === '') return
        this.deps.logger.write(
          this.deps.logger.entry({ level: 'error', source: 'backend', action: 'BACKEND_STDERR', payload: { text } })
        )
      })

      child.once('error', (err) => {
        this.deps.logger.write(
          this.deps.logger.entry({ level: 'error', action: 'BACKEND_SPAWN_ERROR', error: err })
        )
        clearTimeout(timer)
        if (!settled) {
          settled = true
          resolve(null)
        }
      })

      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          resolve(null)
        }
        this.handleExit(code, signal)
      })
    })

    const info = await gotListening
    if (!info) {
      this.handleCrash('Handshake/Start fehlgeschlagen')
      return
    }
    const ready = await this.pollHealth(info.port)
    if (!ready) {
      this.handleCrash('/health nicht erreichbar')
      return
    }
    this.emitStatus({ status: 'ready', port: info.port, pid: info.pid, restartCount: this.restarts })
    this.deps.logger.write(
      this.deps.logger.entry({ level: 'info', action: 'BACKEND_READY', payload: { port: info.port, protocolVersion: PROTOCOL_VERSION } })
    )
  }

  private async pollHealth(port: number): Promise<boolean> {
    const url = `http://127.0.0.1:${port}/health`
    for (const delay of computeBackoffSchedule(HEALTH_BUDGET_MS)) {
      await sleep(delay)
      const ac = new AbortController()
      const to = setTimeout(() => ac.abort(), 1000)
      try {
        const res = await fetch(url, { signal: ac.signal })
        if (res.status === 200) {
          clearTimeout(to)
          return true
        }
      } catch {
        /* noch nicht bereit — weiter zuruecksetzen */
      } finally {
        clearTimeout(to)
      }
    }
    return false
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.shuttingDown) return
    this.deps.logger.write(
      this.deps.logger.entry({
        level: 'warn',
        action: 'BACKEND_EXIT',
        payload: { code, signal, restarts: this.restarts }
      })
    )
    this.handleCrash(`Backend unerwartet beendet (code=${code} signal=${signal})`)
  }

  private handleCrash(_reason: string): void {
    if (this.shuttingDown) return
    if (this.restarts < this.deps.maxRestarts) {
      this.restarts += 1
      // Persistenter Hinweis "Backend neu gestartet" kommt ab Step 7 (Toast). Vorher: Log + Konsole.
      console.error('[backend] Backend neu gestartet')
      this.deps.logger.write(
        this.deps.logger.entry({ level: 'warn', action: 'BACKEND_RESTART', payload: { attempt: this.restarts } })
      )
      void this.launch('restart')
      return
    }
    // Zweiter Crash: blockierender Modal mit Dump-Link kommt ab Step 11. Vorher: Status 'crashed' + Log.
    console.error('[backend] Backend endgueltig abgestuerzt')
    this.deps.logger.write(
      this.deps.logger.entry({ level: 'error', action: 'BACKEND_CRASHED', payload: { restarts: this.restarts } })
    )
    this.emitStatus({ status: 'crashed', restartCount: this.restarts })
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const child = this.proc
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGTERM')
    const winner = await Promise.race([
      exited.then(() => 'exit' as const),
      sleep(KILL_GRACE_MS).then(() => 'timeout' as const)
    ])
    if (winner === 'timeout') {
      child.kill('SIGKILL')
      await exited
    }
  }
}
