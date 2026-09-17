import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { setLang } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'
import { ShortcutReferenceModal } from '@/components/ShortcutReferenceModal'

beforeEach(() => {
  setLang('de')
  useUiStore.setState({ shortcutsOpen: true })
})

describe('ShortcutReferenceModal', () => {
  it('listet Bindungen aus der Tabelle mit formatierter Taste', () => {
    render(<ShortcutReferenceModal />)
    expect(screen.getByText('Speichern')).toBeInTheDocument()
    expect(screen.getByText('Strg+S')).toBeInTheDocument()
    expect(screen.getByText('Strg+Umschalt+S')).toBeInTheDocument()
    expect(screen.getByText('F1')).toBeInTheDocument()
  })
  it('Suche filtert; ohne Treffer Leer-Meldung', () => {
    render(<ShortcutReferenceModal />)
    fireEvent.change(screen.getByTestId('sc-search'), { target: { value: 'rückgängig' } })
    expect(screen.getByText('Rückgängig')).toBeInTheDocument()
    expect(screen.queryByText('Speichern')).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('sc-search'), { target: { value: 'zzzz' } })
    expect(screen.getByText('Keine Treffer')).toBeInTheDocument()
  })
  it('geschlossen -> rendert nichts', () => {
    useUiStore.setState({ shortcutsOpen: false })
    const { container } = render(<ShortcutReferenceModal />)
    expect(container).toBeEmptyDOMElement()
  })
})
