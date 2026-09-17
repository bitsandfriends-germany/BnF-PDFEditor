import { describe, it, expect } from 'vitest'
import { planChromiumLaunch, detectWayland } from '../../src/main/platform'

describe('planChromiumLaunch (Wayland-Sektion 1)', () => {
  it('setzt Standard-Flags auto + WaylandWindowDecorations', () => {
    const plan = planChromiumLaunch({})
    expect(plan.switches).toContain('--ozone-platform-hint=auto')
    expect(plan.extraFeatures).toContain('WaylandWindowDecorations')
    expect(plan.waylandForcedOff).toBe(false)
  })

  it('respektiert ein gesetztes ELECTRON_OZONE_PLATFORM_HINT (nicht ueberschreiben)', () => {
    const plan = planChromiumLaunch({ ELECTRON_OZONE_PLATFORM_HINT: 'wayland' })
    expect(plan.switches).toContain('--ozone-platform-hint=wayland')
  })

  it('PDF_EDITOR_DISABLE_WAYLAND=1 erzwungen x11 ohne Window-Decoration-Feature', () => {
    const plan = planChromiumLaunch({ PDF_EDITOR_DISABLE_WAYLAND: '1' })
    expect(plan.switches).toContain('--ozone-platform-hint=x11')
    expect(plan.extraFeatures).toEqual([])
    expect(plan.waylandForcedOff).toBe(true)
  })
})

describe('detectWayland', () => {
  it('erkennt Wayland ueber WAYLAND_DISPLAY', () => {
    expect(detectWayland({ WAYLAND_DISPLAY: 'wayland-1' })).toBe(true)
  })
  it('DISABLE Wayland gewinnt gegen existierende DISPLAY', () => {
    expect(detectWayland({ WAYLAND_DISPLAY: 'wayland-1', PDF_EDITOR_DISABLE_WAYLAND: '1' })).toBe(false)
  })
  it('X11-Sitzung => kein Wayland', () => {
    expect(detectWayland({ XDG_SESSION_TYPE: 'x11' })).toBe(false)
  })
})
