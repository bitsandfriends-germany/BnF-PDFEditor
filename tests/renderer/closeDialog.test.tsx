import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { setLang } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'
import { CloseDialog } from '@/components/CloseDialog'

beforeEach(() => { setLang('de'); useUiStore.setState({ pendingClose: null }) })

describe('CloseDialog', () => {
  it('zeigt genau drei Optionen', () => {
    useUiStore.setState({ pendingClose: () => {} })
    render(<CloseDialog />)
    expect(screen.getByTestId('close-save')).toBeInTheDocument()
    expect(screen.getByTestId('close-discard')).toBeInTheDocument()
    expect(screen.getByTestId('close-cancel')).toBeInTheDocument()
  })
  it('loest mit der gewaehlten Option auf', async () => {
    let choice: string | null = null
    useUiStore.setState({ pendingClose: (c) => { choice = c } })
    render(<CloseDialog />)
    fireEvent.click(screen.getByTestId('close-discard'))
    await waitFor(() => expect(choice).toBe('discard'))
  })
  it('geschlossen -> rendert nichts', () => {
    const { container } = render(<CloseDialog />)
    expect(container).toBeEmptyDOMElement()
  })
})
