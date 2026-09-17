// Recent-Dateien (functional scope, Section 4). Reine fs-Logik, OHNE Electron-Import -> ohne
// Electron-Umgebung testbar. Es werden nur Pfade + Zeitstempel gespeichert, NIE Datei-Inhalt.
// Store: <configDir>/recent.json, maximal 15, juengste zuerst, Pfade dedupliziert.

import * as fs from 'node:fs'
import * as path from 'node:path'

export interface RecentEntry {
  path: string
  lastOpened: string // ISO-Zeitstempel
}

const MAX_ENTRIES = 15

function fileIn(dir: string): string {
  return path.join(dir, 'recent.json')
}

export function readRecent(dir: string): RecentEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(fileIn(dir), 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw
      .filter((e): e is RecentEntry => !!e && typeof e.path === 'string' && typeof e.lastOpened === 'string')
      .slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

function write(dir: string, entries: RecentEntry[]): void {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const tmp = fileIn(dir) + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(tmp, fileIn(dir))
  } catch {
    // Recent-Liste ist nicht kritisch; ein Schreibfehler darf nichts anderes kippen.
  }
}

export function addRecent(dir: string, filePath: string, now = new Date().toISOString()): RecentEntry[] {
  const rest = readRecent(dir).filter((e) => e.path !== filePath)
  const next: RecentEntry[] = [{ path: filePath, lastOpened: now }, ...rest].slice(0, MAX_ENTRIES)
  write(dir, next)
  return next
}

export function removeRecent(dir: string, filePath: string): RecentEntry[] {
  const next = readRecent(dir).filter((e) => e.path !== filePath)
  write(dir, next)
  return next
}

// Liste mit Existenz-Flag (fehlende Eintraege im UI ausgrauen, Section 4).
export function recentWithExistence(dir: string): (RecentEntry & { exists: boolean })[] {
  return readRecent(dir).map((e) => ({ ...e, exists: fs.existsSync(e.path) }))
}
