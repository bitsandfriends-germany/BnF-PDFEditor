import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const getOutline = vi.fn()
vi.mock('@/lib/documents', () => ({ getOutline: () => getOutline() }))

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { OutlinePanel } = await import('@/components/OutlinePanel')

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  useAppStore.setState({ docOpen: true, docVersion: 1, currentPage: 1, pageCount: 5, toasts: [] })
  getOutline.mockResolvedValue([
    { level: 1, title: 'Kapitel 1', page: 1 },
    { level: 2, title: 'Abschnitt 1.1', page: 2 },
    { level: 1, title: 'Kapitel 2', page: 4 }
  ])
})

describe('OutlinePanel (Section 5)', () => {
  it('zeigt Gliederung und navigiert per Klick', async () => {
    render(<OutlinePanel />)
    await waitFor(() => expect(screen.getByTestId('outline-item-2')).toBeInTheDocument())
    expect(screen.getByText('Abschnitt 1.1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('outline-item-2'))
    expect(useAppStore.getState().currentPage).toBe(4)
  })

  it('leere Gliederung -> Hinweistext', async () => {
    getOutline.mockResolvedValue([])
    render(<OutlinePanel />)
    await waitFor(() => expect(screen.getByText('Dieses Dokument hat keine Gliederung.')).toBeInTheDocument())
  })
})
