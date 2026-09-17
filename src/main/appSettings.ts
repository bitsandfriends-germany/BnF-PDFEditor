// R75: Persistente App-Einstellungen (JSON in userData, atomar, 0600).
//
// Warum im Main-Prozess: der Render-Modus muss VOR app.whenReady bekannt sein (Hardware-
// Beschleunigung laesst sich zur Laufzeit nicht umschalten). Tooltips liest der Renderer ueber
// IPC. Parsen/Mischen sind reine Funktionen und damit ohne Electron testbar.
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RenderMode } from './renderPlan'

export interface AppSettings {
  renderMode: RenderMode
  tooltips: boolean
  /** Gezaehlte GPU-Prozess-Abstuerze (Grundlage fuer die Automatik). */
  gpuFailures: number
}

export const DEFAULT_SETTINGS: AppSettings = { renderMode: 'auto', tooltips: true, gpuFailures: 0 }

const RENDER_MODES: readonly RenderMode[] = ['auto', 'gpu', 'software']

/** Unbekannte/kaputte Felder fallen auf Defaults zurueck (defensiv gegen Handarbeit an der Datei). */
export function parseSettings(raw: unknown): AppSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const o = raw as Record<string, unknown>
  const renderMode = RENDER_MODES.includes(o['renderMode'] as RenderMode) ? (o['renderMode'] as RenderMode) : DEFAULT_SETTINGS.renderMode
  const tooltips = typeof o['tooltips'] === 'boolean' ? o['tooltips'] : DEFAULT_SETTINGS.tooltips
  const failures = Number(o['gpuFailures'])
  const gpuFailures = Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 0
  return { renderMode, tooltips, gpuFailures }
}

/** Nur erlaubte Felder uebernehmen; alles andere ignorieren. */
export function mergeSettings(current: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return parseSettings({ ...current, ...patch })
}

export function settingsPath(userDataDir: string): string {
  return path.join(userDataDir, 'settings.json')
}

export function readSettingsFile(file: string): AppSettings {
  try {
    return parseSettings(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Atomar schreiben (temp + rename), damit ein Absturz die Datei nicht zerreisst. */
export function writeSettingsFile(file: string, settings: AppSettings): void {
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
}
