import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionManager, classifyOrphan, DAY_MS, type SessionMarker } from '../../src/main/sessionManager'

describe('classifyOrphan (Section 3 Startup-Sweep)', () => {
  it('loescht saubere Sitzungen immer', () => {
    expect(classifyOrphan({ dirty: false }, 0)).toBe('delete')
  })
  it('haelt dirty + frisch (< 24 h) zur Wiederherstellung zurueck', () => {
    expect(classifyOrphan({ dirty: true }, DAY_MS - 1000)).toBe('recover')
  })
  it('loescht dirty, aber aelter als 24 h', () => {
    expect(classifyOrphan({ dirty: true }, DAY_MS + 1000)).toBe('delete')
  })
})

describe('SessionManager (temp-Verzeichnisse)', () => {
  let runtimeBase = ''
  let snapshotBase = ''
  let mgr: SessionManager

  function makeOrphan(sid: string, dirty: boolean, ageMs: number): void {
    const dir = path.join(runtimeBase, sid)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const marker: SessionMarker = { sessionId: sid, originalPath: '/tmp/x.pdf', createdAt: 'x', dirty }
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(marker), { mode: 0o600 })
    const when = new Date(Date.now() - ageMs)
    fs.utimesSync(dir, when, when)
  }

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-sess-'))
    runtimeBase = path.join(root, 'run')
    snapshotBase = path.join(root, 'snap')
    fs.mkdirSync(runtimeBase, { recursive: true })
    fs.mkdirSync(snapshotBase, { recursive: true })
    mgr = new SessionManager(runtimeBase, snapshotBase)
  })

  afterEach(() => {
    fs.rmSync(path.dirname(runtimeBase), { recursive: true, force: true })
  })

  it('createSession legt Runtime + Snapshots mit 0700 an und schreibt den Marker', () => {
    const sid = 'sess-1'
    const marker = mgr.createSession(sid)
    expect(marker.dirty).toBe(false)
    expect(fs.existsSync(mgr.markerPath(sid))).toBe(true)
    expect(fs.existsSync(mgr.snapshotDir(sid))).toBe(true)
    const runtimeMode = fs.statSync(mgr.runtimeDir(sid)).mode & 0o777
    expect(runtimeMode).toBe(0o700)
    const snapMode = fs.statSync(mgr.snapshotDir(sid)).mode & 0o777
    expect(snapMode).toBe(0o700)
  })

  it('setDirty setzt den Marker-Dirtyness', () => {
    mgr.createSession('s2')
    mgr.setDirty('s2', true)
    const m = JSON.parse(fs.readFileSync(mgr.markerPath('s2'), 'utf8')) as SessionMarker
    expect(m.dirty).toBe(true)
  })

  it('sweepOrphans: behaelt frische dirty, loescht den Rest inkl. Snapshot-Reste', () => {
    const current = 'cur'
    mgr.createSession(current)
    makeOrphan('fresh-dirty', true, 1000) // recover
    makeOrphan('stale-dirty', true, DAY_MS + 5000) // delete (zu alt)
    makeOrphan('clean', false, 1000) // delete (sauber)
    // Snapshot-Restehne ohne Runtime-Pendant -> delete
    fs.mkdirSync(path.join(snapshotBase, 'ghost', 'snapshots'), { recursive: true })

    const res = mgr.sweepOrphans(current)

    // deleted[] fuehrt nur die Marker-tragenden Runtime-Waisen; der markerlose Snapshot-ghost
    // wird zusaetzlich von der Platte entfernt (unten separat geprueft).
    expect(res.recoverable).toEqual(['fresh-dirty'])
    expect(res.deleted.sort()).toEqual(['clean', 'stale-dirty'])
    expect(fs.existsSync(path.join(runtimeBase, 'clean'))).toBe(false)
    expect(fs.existsSync(path.join(runtimeBase, 'stale-dirty'))).toBe(false)
    expect(fs.existsSync(path.join(runtimeBase, 'fresh-dirty'))).toBe(true)
    expect(fs.existsSync(path.join(snapshotBase, 'ghost'))).toBe(false)
    // aktuelle Session bleibt unangetastet
    expect(fs.existsSync(mgr.runtimeDir(current))).toBe(true)
  })

  it('removeSession loescht Runtime- und Snapshot-Baum zusammen', () => {
    mgr.createSession('del')
    mgr.removeSession('del')
    expect(fs.existsSync(mgr.runtimeDir('del'))).toBe(false)
    expect(fs.existsSync(path.join(snapshotBase, 'del'))).toBe(false)
  })
})
