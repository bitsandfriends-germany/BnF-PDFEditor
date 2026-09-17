import { describe, it, expect } from 'vitest'
import { planRender, isGpuFailure, GPU_FAILURE_THRESHOLD } from '../../src/main/renderPlan'
import { parseSettings, mergeSettings, DEFAULT_SETTINGS, readSettingsFile, writeSettingsFile } from '../../src/main/appSettings'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// R75: Nutzerwunsch "er soll selber entscheiden ob gpu oder sw rendering besser funktioniert, in
// den einstellungen waehlbar". Die Entscheidung ist reine Logik und wird hier deterministisch
// geprueft (Automatik mit Schwellwert, erzwungene Modi, Zaehler-Reset).
describe('planRender (R75 Rendering-Wahl)', () => {
  it('Automatik startet mit GPU, solange keine Ausfaelle bekannt sind', () => {
    const p = planRender('auto', 0)
    expect(p.effective).toBe('gpu')
    expect(p.disableHardwareAcceleration).toBe(false)
    expect(p.switches).toEqual([])
    expect(p.reason).toContain('GPU')
  })

  it('Automatik schaltet ab der Schwelle auf Software um', () => {
    const below = planRender('auto', GPU_FAILURE_THRESHOLD - 1)
    expect(below.effective).toBe('gpu')
    const at = planRender('auto', GPU_FAILURE_THRESHOLD)
    expect(at.effective).toBe('software')
    expect(at.disableHardwareAcceleration).toBe(true)
    expect(at.switches).toContain('disable-gpu')
    expect(at.reason).toContain(String(GPU_FAILURE_THRESHOLD))
  })

  it('Software ist auch bei vielen Ausfaellen stabil Software', () => {
    const p = planRender('software', 99)
    expect(p.effective).toBe('software')
    expect(p.disableHardwareAcceleration).toBe(true)
  })

  it('GPU bleibt erzwungen, auch wenn die Automatik laengst umgeschaltet haette', () => {
    const p = planRender('gpu', 99)
    expect(p.effective).toBe('gpu')
    expect(p.disableHardwareAcceleration).toBe(false)
    expect(p.switches).toEqual([])
  })

  it('kaputte Zaehlerwerte werden wie 0 behandelt', () => {
    expect(planRender('auto', Number.NaN).effective).toBe('gpu')
    expect(planRender('auto', -5).effective).toBe('gpu')
  })

  it('nur echte GPU-Ausfaelle zaehlen (clean-exit ausgenommen)', () => {
    expect(isGpuFailure('GPU', 'crashed')).toBe(true)
    expect(isGpuFailure('GPU', 'abnormal-exit')).toBe(true)
    expect(isGpuFailure('GPU', 'clean-exit')).toBe(false)
    expect(isGpuFailure('Utility', 'crashed')).toBe(false)
    expect(isGpuFailure(undefined, undefined)).toBe(false)
  })
})

describe('appSettings (R75)', () => {
  it('Defaults: Automatik + Tooltips an', () => {
    expect(DEFAULT_SETTINGS).toEqual({ renderMode: 'auto', tooltips: true, gpuFailures: 0 })
  })

  it('parst gueltige Werte und ersetzt Unfug durch Defaults', () => {
    expect(parseSettings({ renderMode: 'software', tooltips: false, gpuFailures: 2 })).toEqual({
      renderMode: 'software',
      tooltips: false,
      gpuFailures: 2
    })
    expect(parseSettings({ renderMode: 'quatsch', tooltips: 'ja', gpuFailures: -1 })).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('text')).toEqual(DEFAULT_SETTINGS)
  })

  it('merge ignoriert unbekannte Felder', () => {
    const merged = mergeSettings({ renderMode: 'auto', tooltips: true, gpuFailures: 1 }, { tooltips: false, unbekannt: 1 } as never)
    expect(merged).toEqual({ renderMode: 'auto', tooltips: false, gpuFailures: 1 })
  })

  it('schreibt atomar und liest zurueck (auch nach defekter Datei)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-settings-'))
    const file = path.join(dir, 'settings.json')
    writeSettingsFile(file, { renderMode: 'software', tooltips: false, gpuFailures: 4 })
    expect(readSettingsFile(file)).toEqual({ renderMode: 'software', tooltips: false, gpuFailures: 4 })
    fs.writeFileSync(file, '{kaputt')
    expect(readSettingsFile(file)).toEqual(DEFAULT_SETTINGS)
    expect(fs.existsSync(`${file}.tmp`), 'keine temp-Reste').toBe(false)
  })
})
