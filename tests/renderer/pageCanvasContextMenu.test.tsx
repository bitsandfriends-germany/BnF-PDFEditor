import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// §6: Der Rechtskicker-Handler sitzt am SEITEN-ELEMENT selbst (dem exakten Seitenkasten).
// pdfjs (`?url`-Worker-Import) und der Render-Hook werden gemockt — geprüft wird nur die
// Weitergabe von Seitenzahl + Cursorposition an die Menü-Instanz (AppShell setzt daran das Menü).

vi.mock('@/lib/pdfjs', () => ({ pdfjs: {} }))
vi.mock('@/hooks/usePdfPageRender', () => ({
  usePdfPageRender: () => ({ cssWidth: 400, cssHeight: 520, viewport: null, status: 'done' as const })
}))

const { PageCanvas } = await import('@/components/PageCanvas')

describe('PageCanvas Rechtsklick (§6)', () => {
  it('rechter Mausklick meldet Seitenzahl + Cursorposition', () => {
    const onRequestMenu = vi.fn()
    const { getByLabelText } = render(
      <PageCanvas doc={null} pageNumber={7} scale={1} onRequestMenu={onRequestMenu} />
    )
    const page = getByLabelText('Seite 7').closest('div') as HTMLElement
    fireEvent.contextMenu(page, { clientX: 123, clientY: 456 })
    expect(onRequestMenu).toHaveBeenCalledWith(7, 123, 456)
  })

  it('ohne Handler wird nichts verhindert und nichts gemeldet', () => {
    const { getByLabelText } = render(<PageCanvas doc={null} pageNumber={2} scale={1} />)
    const page = getByLabelText('Seite 2').closest('div') as HTMLElement
    expect(() => fireEvent.contextMenu(page)).not.toThrow()
  })
})
