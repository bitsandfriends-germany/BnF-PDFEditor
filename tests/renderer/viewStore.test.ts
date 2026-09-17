import { describe, it, expect, beforeEach } from 'vitest'
import { normalizeRotation, stepViewRotation, useUiStore } from '@/store/useUiStore'

// Section 5: Ansichtsdrehung (rein Anzeige), Dark Mode, invertierte Darstellung, Vollbild-Status.

describe('Ansichtsdrehung (nur Anzeige)', () => {
  it('normalisiert auf 0..270', () => {
    expect(normalizeRotation(0)).toBe(0)
    expect(normalizeRotation(90)).toBe(90)
    expect(normalizeRotation(360)).toBe(0)
    expect(normalizeRotation(-90)).toBe(270)
    expect(normalizeRotation(450)).toBe(90)
  })
  it('90-Grad-Schritte vor/zurueck', () => {
    expect(stepViewRotation(0, 1)).toBe(90)
    expect(stepViewRotation(270, 1)).toBe(0)
    expect(stepViewRotation(0, -1)).toBe(270)
  })
})

describe('useUiStore Ansicht/Design', () => {
  beforeEach(() => {
    useUiStore.setState({ viewRotation: 0, theme: 'light', invertPage: false, fullScreen: false })
  })
  it('rotateView haeuft und wickelt bei 360', () => {
    useUiStore.getState().rotateView(1)
    useUiStore.getState().rotateView(1)
    useUiStore.getState().rotateView(1)
    useUiStore.getState().rotateView(1)
    expect(useUiStore.getState().viewRotation).toBe(0)
  })
  it('resetViewRotation -> 0', () => {
    useUiStore.getState().rotateView(1)
    useUiStore.getState().resetViewRotation()
    expect(useUiStore.getState().viewRotation).toBe(0)
  })
  it('toggleTheme wechselt light<->dark', () => {
    useUiStore.getState().toggleTheme()
    expect(useUiStore.getState().theme).toBe('dark')
    useUiStore.getState().toggleTheme()
    expect(useUiStore.getState().theme).toBe('light')
  })
  it('toggleInvertPage kippt rein visuell', () => {
    useUiStore.getState().toggleInvertPage()
    expect(useUiStore.getState().invertPage).toBe(true)
  })
  it('setFullScreen spiegelt echten Zustand', () => {
    useUiStore.getState().setFullScreen(true)
    expect(useUiStore.getState().fullScreen).toBe(true)
  })
})
