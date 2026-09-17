import { describe, it, expect, vi } from 'vitest'
import { handleSecondInstance, type WindowLike } from '../../src/main/singleInstance'

// R74 Nutzerbefund "das programm laesst sich nicht starten": Die Single-Instance-Sperre beendet
// jeden weiteren Start. Ohne nutzbares Fenster passierte dabei sichtbar nichts. Diese Regel wird
// hier deterministisch geprueft (Fakes statt Electron).
function fakeWindow(state: { visible?: boolean; minimized?: boolean; destroyed?: boolean } = {}): WindowLike & {
  calls: string[]
} {
  const calls: string[] = []
  const visible = state.visible ?? true
  const minimized = state.minimized ?? false
  const destroyed = state.destroyed ?? false
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    isVisible: () => visible,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus')
  }
}

describe('handleSecondInstance (R74)', () => {
  it('fokussiert ein sichtbares Fenster', () => {
    const w = fakeWindow()
    const create = vi.fn()
    const r = handleSecondInstance({ mainWindow: w, allWindows: [w], createWindow: create })
    expect(r).toBe('focused')
    expect(w.calls).toEqual(['focus'])
    expect(create).not.toHaveBeenCalled()
  })

  it('holt ein minimiertes Fenster zurueck', () => {
    const w = fakeWindow({ minimized: true })
    const r = handleSecondInstance({ mainWindow: w, allWindows: [w], createWindow: vi.fn() })
    expect(r).toBe('focused')
    expect(w.calls).toEqual(['restore', 'focus'])
  })

  it('zeigt ein verstecktes Fenster wieder an (sonst passiert fuer den Nutzer nichts)', () => {
    const w = fakeWindow({ visible: false })
    const r = handleSecondInstance({ mainWindow: w, allWindows: [w], createWindow: vi.fn() })
    expect(r).toBe('shown')
    expect(w.calls).toEqual(['show', 'focus'])
  })

  it('nutzt ein vorhandenes Fenster, wenn die Hauptreferenz zerstoert ist', () => {
    const dead = fakeWindow({ destroyed: true })
    const alive = fakeWindow()
    const r = handleSecondInstance({ mainWindow: dead, allWindows: [dead, alive], createWindow: vi.fn() })
    expect(r).toBe('focused')
    expect(alive.calls).toEqual(['focus'])
  })

  it('erzeugt ein Fenster, wenn gar keines existiert (Kern des Fixes)', () => {
    const create = vi.fn()
    const r = handleSecondInstance({ mainWindow: null, allWindows: [], createWindow: create })
    expect(r).toBe('created')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('erzeugt ein Fenster, wenn alle Fenster zerstoert sind', () => {
    const w = fakeWindow({ destroyed: true })
    const create = vi.fn()
    const r = handleSecondInstance({ mainWindow: w, allWindows: [w], createWindow: create })
    expect(r).toBe('created')
    expect(create).toHaveBeenCalledTimes(1)
  })
})
