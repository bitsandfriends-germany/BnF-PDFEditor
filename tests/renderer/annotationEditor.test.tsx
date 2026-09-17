import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const getAnnotation = vi.fn()
const editAnnotation = vi.fn().mockResolvedValue(true)
const deleteAnnotation = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/documents', () => ({
  getAnnotation: (id: string) => getAnnotation(id),
  editAnnotation: (...a: unknown[]) => editAnnotation(...a),
  deleteAnnotation: (...a: unknown[]) => deleteAnnotation(...a)
}))

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { AnnotationEditor } = await import('@/components/AnnotationEditor')

const detail = { id: '1:0', page: 1, type: 'Highlight', text: 'alt', author: 'Anna', date: '', color: '#00ff00', opacity: 0.5, rect: { x: 1, y: 2, width: 3, height: 4 } }

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  useAppStore.setState({ readOnly: false, docVersion: 1 })
  useUiStore.setState({ selectedAnnotationId: '1:0', repositionAnnotationId: null })
  getAnnotation.mockResolvedValue({ ...detail })
  editAnnotation.mockResolvedValue(true); deleteAnnotation.mockResolvedValue(true)
})

describe('AnnotationEditor (Section 8.c)', () => {
  it('laedt Detail und fuellt die Felder voraus', async () => {
    render(<AnnotationEditor id="1:0" />)
    const ta = (await screen.findByTestId('ann-edit-text')) as HTMLTextAreaElement
    await waitFor(() => expect(ta.value).toBe('alt'))
    expect(screen.getByTestId('ann-edit-author')).toHaveValue('Anna')
    expect(screen.getByTestId('ann-edit-opacity')).toHaveValue(0.5)
  })

  it('Speichern sendet Text/Autor/Farbe/Deckkraft als Command', async () => {
    render(<AnnotationEditor id="1:0" />)
    await screen.findByTestId('ann-edit-text')
    fireEvent.change(screen.getByTestId('ann-edit-text'), { target: { value: 'neu' } })
    fireEvent.click(screen.getByTestId('ann-edit-save'))
    await waitFor(() => expect(editAnnotation).toHaveBeenCalledWith('1:0', expect.objectContaining({ text: 'neu', author: 'Anna' })))
  })

  it('Loeschen loescht und hebt Auswahl auf', async () => {
    render(<AnnotationEditor id="1:0" />)
    await screen.findByTestId('ann-edit-delete')
    fireEvent.click(screen.getByTestId('ann-edit-delete'))
    await waitFor(() => expect(deleteAnnotation).toHaveBeenCalledWith('1:0'))
    expect(useUiStore.getState().selectedAnnotationId).toBeNull()
  })

  it('"Position neu setzen" bewaffnet die Reposition', async () => {
    render(<AnnotationEditor id="1:0" />)
    await screen.findByTestId('ann-edit-reposition')
    fireEvent.click(screen.getByTestId('ann-edit-reposition'))
    expect(useUiStore.getState().repositionAnnotationId).toBe('1:0')
  })

  it('Detail-Fehler -> kein Editor', async () => {
    getAnnotation.mockRejectedValue(new Error('gone'))
    const { container } = render(<AnnotationEditor id="1:0" />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
