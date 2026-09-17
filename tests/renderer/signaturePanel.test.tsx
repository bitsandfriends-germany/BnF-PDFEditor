import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const listSignatures = vi.fn()
const listDocumentSignatures = vi.fn()
const importSignatureFile = vi.fn().mockResolvedValue('id1')
const createTextSignature = vi.fn().mockResolvedValue('id2')
const deleteSignature = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/documents', () => ({
  listSignatures: () => listSignatures(),
  listDocumentSignatures: () => listDocumentSignatures(),
  importSignatureFile: (...a: unknown[]) => importSignatureFile(...a),
  createTextSignature: (...a: unknown[]) => createTextSignature(...a),
  deleteSignature: (...a: unknown[]) => deleteSignature(...a)
}))

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { SignaturePanel } = await import('@/components/SignaturePanel')

const pickImage = vi.fn().mockResolvedValue('/sig/mine.png')

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  listSignatures.mockResolvedValue([{ id: 'a', name: 'Meine Signatur', fileName: 'a.png', defaultSizePt: 120, defaultOpacity: 1, createdAt: null, mime: 'image/png', hasImage: true }])
  listDocumentSignatures.mockResolvedValue([{ field: 'Signature1', intact: true, valid: true, trusted: false, modifiedAfterSigning: false, verdict: 'gültig, aber nicht vertrauenswürdiger Aussteller' }])
  useAppStore.setState({ docOpen: true, docVersion: 1, toasts: [] })
  ;(window as unknown as { pdfEditor: unknown }).pdfEditor = { pickImage }
})

describe('SignaturePanel', () => {
  it('listet Bibliothek + Dokument-Signatur', async () => {
    render(<SignaturePanel />)
    await waitFor(() => expect(screen.getByText('Meine Signatur')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Signature1')).toBeInTheDocument())
    expect(screen.getByText('gültig, aber nicht vertrauenswürdiger Aussteller')).toBeInTheDocument()
  })
  it('Löschen ruft deleteSignature', async () => {
    render(<SignaturePanel />)
    await waitFor(() => expect(screen.getByTestId('sig-del-a')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('sig-del-a'))
    await waitFor(() => expect(deleteSignature).toHaveBeenCalledWith('a'))
  })
  it('Erzeugen aus Text (nur mit Name+Text)', async () => {
    render(<SignaturePanel />)
    await screen.findByTestId('sig-create')
    expect(screen.getByTestId('sig-create')).toBeDisabled()
    fireEvent.change(screen.getByTestId('sig-name'), { target: { value: 'Chef' } })
    fireEvent.change(screen.getByTestId('sig-text'), { target: { value: 'Max Mustermann' } })
    fireEvent.click(screen.getByTestId('sig-create'))
    await waitFor(() => expect(createTextSignature).toHaveBeenCalledWith('Chef', 'Max Mustermann'))
  })
  it('Import ueber pickImage (Name aus Pfad abgeleitet)', async () => {
    render(<SignaturePanel />)
    await screen.findByTestId('sig-import')
    fireEvent.click(screen.getByTestId('sig-import'))
    await waitFor(() => expect(importSignatureFile).toHaveBeenCalledWith('mine', '/sig/mine.png', 120, 1))
  })
})
