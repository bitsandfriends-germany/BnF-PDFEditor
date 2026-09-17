import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const openDocument = vi.fn().mockResolvedValue(true)
const saveDocument = vi.fn().mockResolvedValue(true)
const closeDocument = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/documents', () => ({
  openDocument: (...a: unknown[]) => openDocument(...a),
  saveDocument: (...a: unknown[]) => saveDocument(...a),
  closeDocument: (...a: unknown[]) => closeDocument(...a)
}))

const { setLang } = await import('@/i18n')
const { useUiStore } = await import('@/store/useUiStore')
const { useAppStore } = await import('@/store/useAppStore')
const { FileMenu } = await import('@/components/FileMenu')

const removeRecent = vi.fn().mockResolvedValue(undefined)
const openPdfDialog = vi.fn().mockResolvedValue('/picked.pdf')

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  const recentData = [
    { path: '/home/x/a.pdf', lastOpened: 't', exists: true },
    { path: '/home/x/gone.pdf', lastOpened: 't', exists: false }
  ]
  useAppStore.setState({ docOpen: true, toasts: [] })
  useUiStore.setState({ recent: recentData })
  ;(window as unknown as { pdfEditor: unknown }).pdfEditor = {
    openPdfDialog, removeRecent, listRecent: vi.fn().mockResolvedValue(recentData)
  }
})

const open = async (): Promise<void> => {
  fireEvent.click(screen.getByTestId('file-menu-button'))
  await waitFor(() => expect(screen.getByTestId('menu-save')).toBeInTheDocument())
}

describe('FileMenu', () => {
  it('Speichern/Speichern unter/Kopie speichern rufen die richtigen Modi auf', async () => {
    render(<FileMenu />)
    await open()
    fireEvent.click(screen.getByTestId('menu-save'))
    expect(saveDocument).toHaveBeenLastCalledWith('save')
    await open()
    fireEvent.click(screen.getByTestId('menu-save-as'))
    expect(saveDocument).toHaveBeenLastCalledWith('as')
    await open()
    fireEvent.click(screen.getByTestId('menu-save-copy'))
    expect(saveDocument).toHaveBeenLastCalledWith('copy')
  })
  it('Kopie speichern ist eigenstaendiger Eintrag', async () => {
    render(<FileMenu />)
    await open()
    expect(screen.getByTestId('menu-save-copy')).toBeInTheDocument()
  })
  it('Schliessen ruft closeDocument', async () => {
    render(<FileMenu />)
    await open()
    fireEvent.click(screen.getByTestId('menu-close'))
    expect(closeDocument).toHaveBeenCalled()
  })
  it('Recent: vorhandene oeffnet, fehlende entfernt + Toast', async () => {
    render(<FileMenu />)
    await open()
    fireEvent.click(screen.getByText('a.pdf'))
    expect(openDocument).toHaveBeenCalledWith('/home/x/a.pdf')
    await open()
    fireEvent.click(screen.getByText('gone.pdf'))
    await waitFor(() => expect(removeRecent).toHaveBeenCalledWith('/home/x/gone.pdf'))
    expect(useAppStore.getState().toasts.length).toBe(1)
  })
  it('ohne Dokument: Speichern/Schliessen deaktiviert', async () => {
    useAppStore.setState({ docOpen: false })
    render(<FileMenu />)
    await open()
    expect(screen.getByTestId('menu-save')).toBeDisabled()
    expect(screen.getByTestId('menu-close')).toBeDisabled()
  })
})
