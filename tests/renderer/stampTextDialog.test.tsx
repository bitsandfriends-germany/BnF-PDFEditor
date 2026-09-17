import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const stampText = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/documents', () => ({ stampText: (...a: unknown[]) => stampText(...a) }))

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { StampTextDialog } = await import('@/components/StampTextDialog')

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  useAppStore.setState({ currentPage: 4, pageCount: 6, signedDoc: false, mutationLock: false, toasts: [] })
  useUiStore.setState({ selected: [], anchor: null, stampTool: null, stampTarget: { kind: 'text', x: 50, y: 60, width: 100, height: 40 } })
})

describe('StampTextDialog (freie Platzierung, Section 7)', () => {
  it('wendet Textstempel mit Anker unten-links an (Scope alle)', async () => {
    render(<StampTextDialog />)
    fireEvent.change(screen.getByTestId('stamp-text'), { target: { value: 'VERTRAULICH' } })
    fireEvent.click(screen.getByTestId('stamp-scope-all'))
    fireEvent.click(screen.getByTestId('stamp-run'))
    await waitFor(() =>
      expect(stampText).toHaveBeenCalledWith(expect.objectContaining({
        expr: 'all', x: 50, y: 60, text: 'VERTRAULICH', fontsize: 18, color: '#c00000', opacity: 1, rotation: 0, overlay: true
      }))
    )
  })

  it('Scope Auswahl nutzt die Auswahl als expr', async () => {
    useUiStore.setState({ selected: [2, 3] })
    render(<StampTextDialog />)
    fireEvent.change(screen.getByTestId('stamp-text'), { target: { value: 'X' } })
    fireEvent.click(screen.getByTestId('stamp-scope-selection'))
    fireEvent.click(screen.getByTestId('stamp-run'))
    await waitFor(() => expect(stampText).toHaveBeenCalledWith(expect.objectContaining({ expr: '2-3', x: 50, y: 60 })))
  })

  it('Scope Seite (Standard) nutzt die aktuelle Seite', async () => {
    useUiStore.setState({ selected: [], stampTarget: { kind: 'text', x: 10, y: 20, width: 30, height: 30 } })
    render(<StampTextDialog />)
    fireEvent.change(screen.getByTestId('stamp-text'), { target: { value: 'Y' } })
    fireEvent.click(screen.getByTestId('stamp-run'))
    await waitFor(() => expect(stampText).toHaveBeenCalledWith(expect.objectContaining({ expr: '4', x: 10, y: 20 })))
  })

  it('ohne Text kein Anwenden; Abbruch ohne Aufruf', () => {
    render(<StampTextDialog />)
    expect(screen.getByTestId('stamp-run')).toBeDisabled()
    fireEvent.click(screen.getByTestId('stamp-cancel'))
    expect(stampText).not.toHaveBeenCalled()
    expect(useUiStore.getState().stampTarget).toBeNull()
  })
})
