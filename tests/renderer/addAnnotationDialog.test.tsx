import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const addAnnotation = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/documents', () => ({ addAnnotation: (...a: unknown[]) => addAnnotation(...a) }))

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { AddAnnotationDialog } = await import('@/components/AddAnnotationDialog')

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  useAppStore.setState({ currentPage: 3, toasts: [] })
  useUiStore.setState({ markupTarget: null, markupTool: null, markupAuthor: 'Karla' })
  addAnnotation.mockResolvedValue(true)
})

const rect = { x: 100, y: 200, width: 120, height: 30 }

describe('AddAnnotationDialog (Section 8.b)', () => {
  it('sendet Typ + Rechteck + Autor + Text ueber addAnnotation', async () => {
    useUiStore.setState({ markupTarget: { ...rect, kind: 'Text' } })
    render(<AddAnnotationDialog />)
    fireEvent.change(screen.getByTestId('ann-add-text'), { target: { value: 'Notiz' } })
    fireEvent.click(screen.getByTestId('ann-add-apply'))
    await waitFor(() => expect(addAnnotation).toHaveBeenCalledTimes(1))
    const arg = addAnnotation.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.page0).toBe(2)
    expect(arg.type).toBe('Text')
    expect(arg.x).toBe(100)
    expect(arg.y).toBe(200)
    expect(arg.author).toBe('Karla')
    expect(arg.text).toBe('Notiz')
    await waitFor(() => expect(useUiStore.getState().markupTarget).toBeNull())
  })

  it('Highlight benoetigt keinen Text und loescht das Ziel nach Abbruch', async () => {
    useUiStore.setState({ markupTarget: { ...rect, kind: 'Highlight' } })
    render(<AddAnnotationDialog />)
    expect(screen.queryByTestId('ann-add-text')).toBeNull()
    expect(screen.getByTestId('ann-add-apply')).toBeEnabled()
    fireEvent.click(screen.getByTestId('ann-add-cancel'))
    expect(useUiStore.getState().markupTarget).toBeNull()
    expect(addAnnotation).not.toHaveBeenCalled()
  })

  it('autor ist vorbelegt aus PlatformInfo wenn leer', async () => {
    useUiStore.setState({ markupTarget: { ...rect, kind: 'FreeText' }, markupAuthor: '' })
    window.pdfEditor = { getPlatformInfo: async () => ({ username: 'sysuser' }) } as never
    render(<AddAnnotationDialog />)
    await waitFor(() => expect(screen.getByTestId('ann-add-author')).toHaveValue('sysuser'))
  })
})
