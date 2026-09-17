import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const openDocument = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/documents', () => ({ openDocument: (...a: unknown[]) => openDocument(...a) }))

const { setLang } = await import('@/i18n')
const { useUiStore } = await import('@/store/useUiStore')
const { useAppStore } = await import('@/store/useAppStore')
const { RecentFiles } = await import('@/components/RecentFiles')

const removeRecent = vi.fn().mockResolvedValue(undefined)
const listRecent = vi.fn()

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [] })
  useUiStore.setState({ recent: [] })
  listRecent.mockResolvedValue([
    { path: '/home/x/a.pdf', lastOpened: '2024-01-02T00:00:00Z', exists: true },
    { path: '/home/x/gone.pdf', lastOpened: '2024-01-01T00:00:00Z', exists: false }
  ])
  ;(window as unknown as { pdfEditor: unknown }).pdfEditor = {
    listRecent,
    removeRecent,
    openPdfDialog: vi.fn().mockResolvedValue('/pick.pdf')
  }
})

describe('RecentFiles', () => {
  it('zeigt Liste, fehlende ausgegraut', async () => {
    render(<RecentFiles />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())
    expect(screen.getByText('gone.pdf')).toBeInTheDocument()
    expect(screen.getByText('gone.pdf').closest('button')).toHaveClass('line-through')
  })
  it('Klick auf vorhandene Datei oeffnet sie', async () => {
    render(<RecentFiles />)
    fireEvent.click(await screen.findByText('a.pdf'))
    expect(openDocument).toHaveBeenCalledWith('/home/x/a.pdf')
  })
  it('Klick auf fehlende Datei entfernt sie + Toast', async () => {
    render(<RecentFiles />)
    fireEvent.click(await screen.findByText('gone.pdf'))
    await waitFor(() => expect(removeRecent).toHaveBeenCalledWith('/home/x/gone.pdf'))
    expect(openDocument).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts.length).toBe(1)
  })
  it('Leere Liste zeigt Hinweis', async () => {
    listRecent.mockResolvedValue([])
    render(<RecentFiles />)
    await waitFor(() => expect(screen.getByText('Noch keine Dokumente geöffnet.')).toBeInTheDocument())
  })
})
