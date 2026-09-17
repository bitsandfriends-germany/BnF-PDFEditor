import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const listAnnotations = vi.fn()
const removeAnnotations = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/documents', () => ({
  listAnnotations: () => listAnnotations(),
  removeAnnotations: (...a: unknown[]) => removeAnnotations(...a)
}))

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { AnnotationListPanel } = await import('@/components/AnnotationListPanel')

const two = [
  { id: '1:0', page: 1, type: 'Text', author: 'Anna', date: 'D:20200101', text: 'Erster Kommentar' },
  { id: '2:0', page: 2, type: 'Highlight', author: 'Ben', date: 'D:20200202', text: 'wichtig' }
]

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  useAppStore.setState({ docOpen: true, docVersion: 1, readOnly: false, mutationLock: false, pageCount: 5, currentPage: 1, toasts: [] })
  useUiStore.setState({ pendingConfirm: null })
  listAnnotations.mockResolvedValue(two)
})

describe('AnnotationListPanel (Section 8)', () => {
  it('listet, filtert nach Typ und navigiert per Klick', async () => {
    render(<AnnotationListPanel />)
    await waitFor(() => expect(screen.getByText('Erster Kommentar')).toBeInTheDocument())
    expect(screen.getByText('wichtig')).toBeInTheDocument()
    // Nur Highlight behalten -> Text-Eintrag verschwindet, genau ein Eintrag bleibt
    fireEvent.change(screen.getByTestId('ann-filter-type'), { target: { value: 'Highlight' } })
    await waitFor(() => expect(screen.queryByText('Erster Kommentar')).toBeNull())
    expect(screen.getByTestId('ann-item-0')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ann-item-0'))
    expect(useAppStore.getState().currentPage).toBe(2)
  })

  it('Entfernen: erst Bestaetigung, dann remove-annotations + Neuladen', async () => {
    listAnnotations.mockResolvedValue(two)
    render(<AnnotationListPanel />)
    await screen.findByTestId('ann-item-0')
    fireEvent.click(screen.getByTestId('ann-remove'))
    await waitFor(() => expect(useUiStore.getState().pendingConfirm).not.toBeNull())
    useUiStore.getState().resolveConfirm(true)
    await waitFor(() => expect(removeAnnotations).toHaveBeenCalledWith('all'))
    await waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(2))
    expect(useAppStore.getState().toasts.some((x) => x.kind === 'success')).toBe(true)
  })

  it('Abbruch der Bestaetigung entfernt nichts', async () => {
    render(<AnnotationListPanel />)
    await screen.findByTestId('ann-item-0')
    fireEvent.click(screen.getByTestId('ann-remove'))
    await waitFor(() => expect(useUiStore.getState().pendingConfirm).not.toBeNull())
    useUiStore.getState().resolveConfirm(false)
    await waitFor(() => expect(useUiStore.getState().pendingConfirm).toBeNull())
    expect(removeAnnotations).not.toHaveBeenCalled()
  })

  it('leere Liste -> Hinweistext', async () => {
    listAnnotations.mockResolvedValue([])
    render(<AnnotationListPanel />)
    await waitFor(() => expect(screen.getByText('Keine Annotationen.')).toBeInTheDocument())
  })

  it('"Auf Seite platzieren" bewaffnet das Markup-Werkzeug mit dem gewaehlten Typ', async () => {
    render(<AnnotationListPanel />)
    await screen.findByTestId('ann-item-0')
    fireEvent.change(screen.getByTestId('ann-new-type'), { target: { value: 'Text' } })
    fireEvent.click(screen.getByTestId('ann-place'))
    expect(useUiStore.getState().markupTool).toBe('Text')
  })

  it('Platzier-Leiste bleibt auch ohne bestehende Annotationen (E2E-Fund r42)', async () => {
    listAnnotations.mockResolvedValue([])
    render(<AnnotationListPanel />)
    await screen.findByTestId('ann-place')
    fireEvent.change(screen.getByTestId('ann-new-type'), { target: { value: 'Highlight' } })
    fireEvent.click(screen.getByTestId('ann-place'))
    expect(useUiStore.getState().markupTool).toBe('Highlight')
  })
})
