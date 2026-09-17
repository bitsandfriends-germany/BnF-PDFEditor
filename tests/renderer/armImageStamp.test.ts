import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

vi.mock('@/lib/apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), del: vi.fn(), getBytes: vi.fn() }, ApiError: class extends Error {}, sseStream: vi.fn() }))

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { armImageStamp } = await import('@/lib/documents')

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  useAppStore.setState({ toasts: [] })
  useUiStore.setState({ stampTool: null, stampTarget: null, stampImage: null })
})

describe('armImageStamp (pick -> base64 -> bewaffnen)', () => {
  it('waehlt Bild, liest Base64 und bewaffnet image-Platzierung', async () => {
    const pickImage = vi.fn().mockResolvedValue('/home/u/brief/stempel.png')
    const readImageAsBase64 = vi.fn().mockResolvedValue('QUJDRA==')
    ;(window as unknown as { pdfEditor: unknown }).pdfEditor = { pickImage, readImageAsBase64 }
    const ok = await armImageStamp()
    expect(ok).toBe(true)
    expect(readImageAsBase64).toHaveBeenCalledWith('/home/u/brief/stempel.png')
    expect(useUiStore.getState().stampImage).toEqual({ b64: 'QUJDRA==', name: 'stempel.png' })
    expect(useUiStore.getState().stampTool).toBe('image')
  })

  it('ohne Dateiauswahl passiert nichts', async () => {
    ;(window as unknown as { pdfEditor: unknown }).pdfEditor = { pickImage: vi.fn().mockResolvedValue(null), readImageAsBase64: vi.fn() }
    expect(await armImageStamp()).toBe(false)
    expect(useUiStore.getState().stampTool).toBeNull()
  })

  it('Lesefehler (null Base64) -> Fehler-Toast, nicht bewaffnet', async () => {
    ;(window as unknown as { pdfEditor: unknown }).pdfEditor = { pickImage: vi.fn().mockResolvedValue('/x/big.png'), readImageAsBase64: vi.fn().mockResolvedValue(null) }
    expect(await armImageStamp()).toBe(false)
    expect(useUiStore.getState().stampTool).toBeNull()
    expect(useAppStore.getState().toasts.some((t) => t.kind === 'error')).toBe(true)
  })
})
