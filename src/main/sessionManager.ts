import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Session-/Arbeitsverzeichnis-Verwaltung nach Section 2 + 3.
// - Working-Copy + Context-Cache: $XDG_RUNTIME_DIR/pdf-editor/<sid>/ (tmpfs, 0700),
//   Fallback /tmp/pdf-editor-<uid>/<sid>/ (0700). NIE direkt in /tmp, nie world-readable.
// - Undo-Snapshots: ~/.cache/pdf-editor/sessions/<sid>/snapshots/ (0700) — gleiche Sid,
//   zusammen angelegt und zusammen geloescht.

export const DAY_MS = 24 * 60 * 60 * 1000

export interface SessionMarker {
  sessionId: string
  originalPath: string | null
  createdAt: string
  dirty: boolean
}

export type OrphanDecision = 'recover' | 'delete'

// Rein und testbar: ein Orphan wird nur zurueckgehalten, wenn er ungespeicherte Aenderungen
// traegt UND juenger als 24 h ist. Sonst loeschen (Section 3, Startup-Sweep).
export function classifyOrphan(session: Pick<SessionMarker, 'dirty'>, ageMs: number, maxAgeMs = DAY_MS): OrphanDecision {
  if (!session.dirty) return 'delete'
  return ageMs < maxAgeMs ? 'recover' : 'delete'
}

export function runtimeBaseDir(env: NodeJS.ProcessEnv = process.env, uid: number = process.getuid?.() ?? 0): string {
  const xdg = env.XDG_RUNTIME_DIR
  if (xdg && xdg.trim() !== '') return path.join(xdg, 'pdf-editor')
  return path.join('/tmp', `pdf-editor-${uid}`)
}

export function snapshotBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME && env.HOME.trim() !== '' ? env.HOME : os.homedir()
  return path.join(home, '.cache', 'pdf-editor', 'sessions')
}

export interface SweepResult {
  recoverable: string[] // Session-Ids mit wiederherstellbaren, frischen Aenderungen
  deleted: string[]
}

export class SessionManager {
  readonly runtimeBase: string
  readonly snapshotBase: string

  constructor(runtimeBase = runtimeBaseDir(), snapshotBase = snapshotBaseDir()) {
    this.runtimeBase = runtimeBase
    this.snapshotBase = snapshotBase
  }

  runtimeDir(sessionId: string): string {
    return path.join(this.runtimeBase, sessionId)
  }

  snapshotDir(sessionId: string): string {
    return path.join(this.snapshotBase, sessionId, 'snapshots')
  }

  markerPath(sessionId: string): string {
    return path.join(this.runtimeDir(sessionId), 'session.json')
  }

  private ensurePrivate(dir: string): void {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.chmodSync(dir, 0o700) // gegen schon vorhandene Verzeichnisse mit anderen Bits absichern
  }

  createSession(sessionId: string): SessionMarker {
    const runtime = this.runtimeDir(sessionId)
    this.ensurePrivate(this.runtimeBase)
    this.ensurePrivate(runtime)
    this.ensurePrivate(this.snapshotBase)
    this.ensurePrivate(path.join(this.snapshotBase, sessionId))
    this.ensurePrivate(this.snapshotDir(sessionId))
    const marker: SessionMarker = {
      sessionId,
      originalPath: null,
      createdAt: new Date().toISOString(),
      dirty: false
    }
    fs.writeFileSync(this.markerPath(sessionId), JSON.stringify(marker), { mode: 0o600 })
    return marker
  }

  setDirty(sessionId: string, dirty: boolean): void {
    const p = this.markerPath(sessionId)
    try {
      const current = JSON.parse(fs.readFileSync(p, 'utf8')) as SessionMarker
      current.dirty = dirty
      fs.writeFileSync(p, JSON.stringify(current), { mode: 0o600 })
    } catch {
      /* Marker fehlt — nichts zu tun */
    }
  }

  removeSession(sessionId: string): void {
    fs.rmSync(this.runtimeDir(sessionId), { recursive: true, force: true })
    fs.rmSync(path.join(this.snapshotBase, sessionId), { recursive: true, force: true })
  }

  private listDirs(base: string): string[] {
    try {
      return fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    } catch {
      return []
    }
  }

  // Startup-Sweep (Section 3): nur beim Start sieht man, was ein Crash/SIGKILL hinterlassen hat.
  private sweepBase(base: string, currentSessionId: string, nowMs: number, decideDirs: boolean): SweepResult {
    const result: SweepResult = { recoverable: [], deleted: [] }
    for (const sid of this.listDirs(base)) {
      if (sid === currentSessionId) continue
      const dir = path.join(base, sid)
      let marker: SessionMarker | null = null
      let ageMs = nowMs
      try {
        const stat = fs.statSync(dir)
        marker = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8')) as SessionMarker
        ageMs = nowMs - stat.mtimeMs
      } catch {
        // Kein lesbarer Marker => gefaehrlicher Waisenrest => loeschen.
        marker = null
      }
      if (marker && decideDirs && classifyOrphan(marker, ageMs) === 'recover') {
        result.recoverable.push(sid)
        continue
      }
      fs.rmSync(dir, { recursive: true, force: true })
      result.deleted.push(sid)
    }
    return result
  }

  sweepOrphans(currentSessionId: string, nowMs: number = Date.now()): SweepResult {
    // Decision-Findings nur aus dem Runtime-Base (dort liegt der session.json-Marker).
    const runtimeSweep = this.sweepBase(this.runtimeBase, currentSessionId, nowMs, true)
    // Snapshot-Base nur fuerSessions loeschen, die nicht wiederhergestellt werden.
    for (const sid of runtimeSweep.deleted) {
      fs.rmSync(path.join(this.snapshotBase, sid), { recursive: true, force: true })
    }
    // Snapshot-Verzeichnisse ohne passenden Runtime-Ordner sind reine Reste -> loeschen.
    const runtimeSids = new Set(this.listDirs(this.runtimeBase))
    for (const sid of this.listDirs(this.snapshotBase)) {
      if (sid === currentSessionId) continue
      if (!runtimeSids.has(sid) && !runtimeSweep.recoverable.includes(sid)) {
        fs.rmSync(path.join(this.snapshotBase, sid), { recursive: true, force: true })
      }
    }
    return runtimeSweep
  }
}
