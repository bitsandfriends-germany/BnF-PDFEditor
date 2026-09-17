import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const stampImageSelection = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/documents', () => ({ stampImageSelection: (...a: unknown[]) => stampImageSelection(...a) }))

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { useUiStore } = await import('@/store/useUiStore')
const { StampImageDialog } = await import('@/components/StampImageDialog')

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  useAppStore.setState({ currentPage: 2, pageCount: 5, signedDoc: false, mutationLock: false, toasts: [] })
  useUiStore.setState({ selected: [], anchor: null, stampTool: null, stampImage: { b64: 'AAEC', name: 'sign.png' }, stampTarget: { kind: 'image', x: 100, y: 40, width: 200, height: 80 } })
})

describe('StampImageDialog (Section 7)', () => {
  it('wendet Bild auf komplettes Rechteck an (Scope alle, aspect aus)', async () => {
    render(<StampImageDialog />)
    fireEvent.click(screen.getByTestId('stampimg-scope-all'))
    fireEvent.click(screen.getByTestId('stampimg-keep')) // standardmaessig an -> aus
    fireEvent.click(screen.getByTestId('stampimg-run'))
    await waitFor(() =>
      expect(stampImageSelection).toHaveBeenCalledWith(
        'all', { x: 100, y: 40, width: 200, height: 80 }, 'AAEC',
        { opacity: 1, rotation: 0, overlay: true, keepProportion: false }
      )
    )
  })

  it('Scope Auswahl -> Auswahl-expr; Seitenverhaeltnis bleibt standardmaessig an', async () => {
    useUiStore.setState({ selected: [1, 3] })
    render(<StampImageDialog />)
    fireEvent.click(screen.getByTestId('stampimg-scope-selection'))
    fireEvent.click(screen.getByTestId('stampimg-run'))
    await waitFor(() => {
      const args = stampImageSelection.mock.calls[0]
      if (!args) return
      expect(args[0]).toBe('1,3')
      const opts = args[3] as { keepProportion: boolean }
      expect(opts.keepProportion).toBe(true)
    })
  })

  it('ohne gewaehltes Bild ist Anwenden deaktiv', () => {
    useUiStore.setState({ stampImage: null })
    render(<StampImageDialog />)
    expect(screen.getByTestId('stampimg-run')).toBeDisabled()
    expect(stampImageSelection).not.toHaveBeenCalled()
  })
})
