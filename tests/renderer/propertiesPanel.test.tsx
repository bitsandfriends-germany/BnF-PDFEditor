import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const post = vi.fn()
const get = vi.fn()
class ApiError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.name = 'ApiError'; this.code = code }
}
vi.mock('@/lib/apiClient', () => ({ api: { get, post, del: vi.fn(), getBytes: vi.fn() }, ApiError, sseStream: vi.fn() }))

const { useAppStore } = await import('@/store/useAppStore')
const { setLang } = await import('@/i18n')
const { PropertiesPanel } = await import('@/components/PropertiesPanel')

const full = {
  fileSizeBytes: 2097152, pageCount: 7, pdfVersion: '1.7', producer: 'PyMuPDF', creator: 'app',
  creationDate: '20200101', modDate: '20200202', currentPage: 2, pageWidth: 595, pageHeight: 842,
  pageRotation: 0, encrypted: false, encryptionAlgorithm: null, permissions: -4, pendingEncryption: false,
  linearized: false, tagged: false, hasForms: true, attachmentCount: 0, hasJavaScript: false,
  fonts: [{ name: 'Helvetica', type: 'Type1', embedded: false }]
}

beforeEach(() => { setLang('de'); vi.clearAllMocks(); useAppStore.setState({ docOpen: true, currentPage: 2, docVersion: 1 }) })

describe('PropertiesPanel', () => {
  it('lädt Fakten und rendert Werte + Font-Status', async () => {
    post.mockResolvedValue(full)
    render(<PropertiesPanel />)
    await waitFor(() => expect(post).toHaveBeenCalledWith('/document/properties', { page: 2 }))
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument())
    expect(screen.getByText('PyMuPDF')).toBeInTheDocument()
    expect(screen.getByText('2.00 MB')).toBeInTheDocument()
    expect(screen.getByText('nicht eingebettet')).toBeInTheDocument()
  })
  it('fragt die aktuelle Seite nach, nicht 1', async () => {
    useAppStore.setState({ currentPage: 5 })
    post.mockResolvedValue(full)
    render(<PropertiesPanel />)
    await waitFor(() => expect(post).toHaveBeenCalledWith('/document/properties', { page: 5 }))
  })
  it('ohne Dokument: kein Request', () => {
    useAppStore.setState({ docOpen: false })
    render(<PropertiesPanel />)
    expect(post).not.toHaveBeenCalled()
  })
})
