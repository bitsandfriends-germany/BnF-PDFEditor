import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Tooltip } from '@/components/Tooltip'
import { useUiStore } from '@/store/useUiStore'

// R75 Nutzerwunsch: "gib den einstellungen und ALLEN Funktionen on Hover Tooltips was die Funktion
// macht. Auch in den Settings an- und ausschaltbar." Geprueft wird das Verhalten der EINEN
// Tooltip-Komponente: Hover/Fokus zeigen den Text, die Einstellung schaltet sie wirklich ab.
describe('Tooltip (R75)', () => {
  beforeEach(() => {
    useUiStore.setState({ tooltips: true })
  })

  const hover = async (el: Element): Promise<void> => {
    fireEvent.mouseEnter(el)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350)) // Anzeigeverzoegerung abwarten
    })
  }

  it('zeigt den Hilfetext nach kurzem Verweilen', async () => {
    render(
      <Tooltip text="Dreht die Seite" testid="tip-probe">
        <button data-testid="probe-btn">X</button>
      </Tooltip>
    )
    expect(screen.queryByTestId('tip-probe')).not.toBeInTheDocument()
    await hover(screen.getByTestId('probe-btn'))
    const tip = screen.getByTestId('tip-probe')
    expect(tip).toBeInTheDocument()
    expect(tip).toHaveTextContent('Dreht die Seite')
    expect(tip).toHaveAttribute('role', 'tooltip')
  })

  it('zeigt den Text auch bei Tastaturfokus (Barrierefreiheit)', async () => {
    render(
      <Tooltip text="Speichert die Datei" testid="tip-focus">
        <button data-testid="focus-btn">Y</button>
      </Tooltip>
    )
    fireEvent.focus(screen.getByTestId('focus-btn'))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350))
    })
    expect(screen.getByTestId('tip-focus')).toHaveTextContent('Speichert die Datei')
  })

  it('zeigt nichts, wenn Tooltips in den Einstellungen ausgeschaltet sind', async () => {
    useUiStore.setState({ tooltips: false })
    render(
      <Tooltip text="Oeffnet eine Datei" testid="tip-off">
        <button data-testid="off-btn">Z</button>
      </Tooltip>
    )
    await hover(screen.getByTestId('off-btn'))
    expect(screen.queryByTestId('tip-off')).not.toBeInTheDocument()
  })

  it('schaltet den laufenden Hinweis sofort ab, wenn die Einstellung kippt', async () => {
    render(
      <Tooltip text="Druckt die Seite" testid="tip-toggle">
        <button data-testid="toggle-btn">P</button>
      </Tooltip>
    )
    await hover(screen.getByTestId('toggle-btn'))
    expect(screen.getByTestId('tip-toggle')).toBeInTheDocument()
    act(() => useUiStore.getState().setTooltips(false))
    expect(screen.queryByTestId('tip-toggle')).not.toBeInTheDocument()
  })

  it('Variante "native" setzt title und respektiert die Einstellung', () => {
    const { unmount } = render(
      <Tooltip text="Schliesst das Dokument" variant="native">
        <button data-testid="native-btn">C</button>
      </Tooltip>
    )
    expect(screen.getByTestId('native-btn').closest('span')).toHaveAttribute('title', 'Schliesst das Dokument')
    unmount()
    useUiStore.setState({ tooltips: false })
    render(
      <Tooltip text="Schliesst das Dokument" variant="native" testid="native-off">
        <button data-testid="native-btn2">C</button>
      </Tooltip>
    )
    expect(document.querySelector('[title="Schliesst das Dokument"]')).toBeNull()
  })
})
