import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const getFormFields = vi.fn()
const flatten = vi.fn().mockResolvedValue(true)
const saveDocument = vi.fn().mockResolvedValue(true)
const resetForm = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/documents', () => ({
  getFormFields: () => getFormFields(),
  flatten: (...a: unknown[]) => flatten(...a),
  saveDocument: (...a: unknown[]) => saveDocument(...a),
  resetForm: (...a: unknown[]) => resetForm(...a)
}))

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { FormPanel } = await import('@/components/FormPanel')

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  useAppStore.setState({ docOpen: true, docVersion: 1, readOnly: false, mutationLock: false })
  useUiStore.setState({ highlightFormFields: true, pendingConfirm: null })
  flatten.mockResolvedValue(true); saveDocument.mockResolvedValue(true); resetForm.mockResolvedValue(true)
  getFormFields.mockResolvedValue({ hasAcroForm: true, hasXfa: false, count: 2, fields: [] })
})

describe('FormPanel (Section 11)', () => {
  it('zeigt Anzahl + Bedienelemente bei vorhandenem Formular', async () => {
    render(<FormPanel />)
    await screen.findByTestId('form-count')
    expect(screen.getByTestId('form-count')).toHaveTextContent('2')
    expect(screen.getByTestId('form-save-editable')).toBeEnabled()
    expect(screen.getByTestId('form-highlight')).toBeChecked()
  })

  it('zeigt XFA-Hinweis, wenn XFA erkannt wird', async () => {
    getFormFields.mockResolvedValue({ hasAcroForm: true, hasXfa: true, count: 0, fields: [] })
    render(<FormPanel />)
    await screen.findByTestId('form-xfa-notice')
    expect(screen.getByTestId('form-xfa-notice')).toBeInTheDocument()
  })

  it('kein Formular -> Hinweistext, keine Buttons', async () => {
    getFormFields.mockResolvedValue({ hasAcroForm: false, hasXfa: false, count: 0, fields: [] })
    render(<FormPanel />)
    await screen.findByTestId('form-none')
    expect(screen.queryByTestId('form-reset')).toBeNull()
  })

  it('Zuruecksetzen erst nach Bestaetigung', async () => {
    render(<FormPanel />)
    await screen.findByTestId('form-reset')
    fireEvent.click(screen.getByTestId('form-reset'))
    await waitFor(() => expect(useUiStore.getState().pendingConfirm).not.toBeNull())
    useUiStore.getState().resolveConfirm(true)
    await waitFor(() => expect(resetForm).toHaveBeenCalled())
  })

  it('Flach-Speichern: Bestaetigung -> flatten([forms]) + saveDocument', async () => {
    render(<FormPanel />)
    await screen.findByTestId('form-save-flat')
    fireEvent.click(screen.getByTestId('form-save-flat'))
    await waitFor(() => expect(useUiStore.getState().pendingConfirm).not.toBeNull())
    useUiStore.getState().resolveConfirm(true)
    await waitFor(() => expect(flatten).toHaveBeenCalledWith(['forms']))
    expect(saveDocument).toHaveBeenCalledWith('save')
  })

  it('Abbruch der Bestaetigung fuehrt nichts aus', async () => {
    render(<FormPanel />)
    await screen.findByTestId('form-reset')
    fireEvent.click(screen.getByTestId('form-reset'))
    await waitFor(() => expect(useUiStore.getState().pendingConfirm).not.toBeNull())
    useUiStore.getState().resolveConfirm(false)
    await waitFor(() => expect(useUiStore.getState().pendingConfirm).toBeNull())
    expect(resetForm).not.toHaveBeenCalled()
  })
})
