import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ToastViewport } from '@/components/Toast'
import { useAppStore } from '@/store/useAppStore'
import { setLang } from '@/i18n'

beforeEach(() => {
  setLang('de')
  useAppStore.setState({ toasts: [] })
})

describe('ToastViewport', () => {
  it('zeigt einen persistenten Fehler-Toast mit correlationId und Prefix', () => {
    useAppStore.getState().addToast({ kind: 'error', message: 'Konnte Seite nicht rotieren.', correlationId: 'corr-42' })
    render(<ToastViewport />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Fehler: Konnte Seite nicht rotieren.')
    expect(alert).toHaveTextContent('corr-42')
    expect(screen.getByLabelText('Meldung schließen')).toBeInTheDocument()
  })

  it('entfernt einen Toast ueber den Dismiss-Button', () => {
    useAppStore.getState().addToast({ kind: 'success', message: 'Gespeichert' })
    render(<ToastViewport />)
    expect(screen.getByText('Gespeichert')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Meldung schließen'))
    expect(screen.queryByText('Gespeichert')).not.toBeInTheDocument()
  })

  it('Container ist aria-live (bildschirmleser-freundlich)', () => {
    useAppStore.getState().addToast({ kind: 'info', message: 'Hinweis' })
    render(<ToastViewport />)
    expect(screen.getByLabelText('Meldungen')).toHaveAttribute('aria-live', 'polite')
  })
})
