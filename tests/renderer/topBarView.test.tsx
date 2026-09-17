import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@/lib/documents', () => ({ openDocument: vi.fn(), saveDocument: vi.fn(), closeDocument: vi.fn() }))

const { setLang } = await import('@/i18n')
const { useUiStore } = await import('@/store/useUiStore')
const { useAppStore } = await import('@/store/useAppStore')
const { TopBar } = await import('@/components/TopBar')

beforeEach(() => {
  setLang('de')
  useUiStore.setState({ viewRotation: 0, theme: 'light', invertPage: false })
  ;(window as unknown as { pdfEditor: unknown }).pdfEditor = {
    openPdfDialog: vi.fn().mockResolvedValue(null),
    savePdfDialog: vi.fn().mockResolvedValue(null)
  }
})

describe('TopBar Ansicht/Design', () => {
  it('Rechts-Drehen setzt Ansichtsdrehung + Badge', () => {
    render(<TopBar />)
    expect(screen.queryByTestId('view-rotation-badge')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('view-rot-right'))
    expect(useUiStore.getState().viewRotation).toBe(90)
    expect(screen.getByTestId('view-rotation-badge')).toBeInTheDocument()
  })
  it('Theme-Button wechselt auf dark', () => {
    render(<TopBar />)
    fireEvent.click(screen.getByTestId('view-theme'))
    expect(useUiStore.getState().theme).toBe('dark')
  })
  it('Invert-Button kippt aria-pressed', () => {
    render(<TopBar />)
    const b = screen.getByTestId('view-invert')
    expect(b).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(b)
    expect(useUiStore.getState().invertPage).toBe(true)
    expect(screen.getByTestId('view-invert')).toHaveAttribute('aria-pressed', 'true')
  })
})

// R73: Die Seitenzahl-Anzeige muss der aktuellen Seite folgen, auch wenn sie von aussen wechselt
// (Scroll-Spy beim Blaettern in Doppelseiten, Thumbnail-Klick, Pfeile). Vorher blieb der Wert auf
// der zuletzt getippten Seite stehen — Teil des Nutzerbefunds "nur die ersten Seiten".
describe('TopBar Seitenanzeige folgt der aktuellen Seite (R73)', () => {
  it('uebernimmt eine von aussen gesetzte Seite in das Eingabefeld', async () => {
    useAppStore.getState().setCurrentPage(1)
    render(<TopBar />)
    const input = screen.getByTestId('tb-page-input') as HTMLInputElement
    expect(input.value).toBe('1')
    act(() => {
      useAppStore.getState().setPageCount(9)
      useAppStore.getState().setCurrentPage(6)
    })
    await waitFor(() => expect((screen.getByTestId('tb-page-input') as HTMLInputElement).value).toBe('6'))
  })
})
