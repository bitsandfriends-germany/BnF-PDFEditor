import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// R75: Einstellungen fuer Rendering (Automatik/GPU/Software) und Tooltips — inklusive Persistenz
// ueber die Bruecke. Nutzerwunsch: "er soll selber entscheiden ob gpu oder sw rendering besser
// funktioniert, in den einstellungen waehlbar … auch in den settings an- und ausschaltbar".
const setAppSettings = vi.fn().mockResolvedValue(null)
const getAppSettings = vi.fn().mockResolvedValue({
  settings: { renderMode: 'auto', tooltips: true, gpuFailures: 2 },
  plan: { effective: 'gpu', disableHardwareAcceleration: false, switches: [], reason: 'Automatik: GPU' }
})

vi.mock('@/lib/documents', () => ({ openDocument: vi.fn(), saveDocument: vi.fn() }))

const { useUiStore } = await import('@/store/useUiStore')
const { SettingsModal } = await import('@/components/SettingsModal')
const { setLang } = await import('@/i18n')

beforeEach(() => {
  setLang('de')
  setAppSettings.mockClear()
  getAppSettings.mockClear()
  useUiStore.setState({ settingsOpen: true, tooltips: true, renderInfo: null })
  ;(window as unknown as { pdfEditor: unknown }).pdfEditor = { getAppSettings, setAppSettings }
})

describe('SettingsModal Rendering + Tooltips (R75)', () => {
  it('liest die Einstellungen und zeigt den effektiven Render-Modus', async () => {
    render(<SettingsModal />)
    await waitFor(() => expect(screen.getByTestId('settings-render-effective')).toBeInTheDocument())
    expect(screen.getByTestId('settings-render-effective')).toHaveTextContent(/GPU|Software/)
    expect(getAppSettings).toHaveBeenCalled()
    expect((screen.getByTestId('settings-render-mode') as HTMLSelectElement).value).toBe('auto')
  })

  it('schaltet den Render-Modus um und persistiert ihn', async () => {
    render(<SettingsModal />)
    await waitFor(() => expect(getAppSettings).toHaveBeenCalled())
    fireEvent.change(screen.getByTestId('settings-render-mode'), { target: { value: 'software' } })
    await waitFor(() => expect(setAppSettings).toHaveBeenCalledWith({ renderMode: 'software' }))
    expect(screen.getByTestId('settings-render-hint')).toHaveTextContent(/Software|GPU/)
    expect(screen.getByTestId('settings-render-restart')).toHaveTextContent(/Neustart|restart/i)
  })

  it('schaltet Tooltips aus und persistiert das', async () => {
    render(<SettingsModal />)
    const box = screen.getByTestId('settings-tooltips') as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    await waitFor(() => expect(useUiStore.getState().tooltips).toBe(false))
    expect(setAppSettings).toHaveBeenCalledWith({ tooltips: false })
  })
})
