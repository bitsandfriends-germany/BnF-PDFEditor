import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { setLang } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'
import { PinModal } from '@/components/PinModal'

// R58: PIN erst NACH Feldplatzierung; im Dialog wird sie geprueft (gruener Haken),
// und nur bei Erfolg uebergibt der Dialog die PIN.

describe('PinModal Verifikation (R58)', () => {
  beforeEach(() => {
    setLang('de')
    useUiStore.setState({ pendingPin: null })
  })

  it('zeigt gruenen Haken und uebergibt erst nach erfolgreicher Pruefung', async () => {
    render(<PinModal />)
    const verify = vi.fn(async () => ({ ok: true }))
    let result: unknown = 'pending'
    void useUiStore.getState().requestPin({ title: 'PIN', needSigPin: false, verify }).then((r) => { result = r })
    await screen.findByTestId('pin-input')
    fireEvent.change(screen.getByTestId('pin-input'), { target: { value: '123456' } })
    fireEvent.click(screen.getByTestId('pin-ok'))
    await waitFor(() => expect(screen.getByTestId('pin-verified')).toBeInTheDocument())
    expect(verify).toHaveBeenCalledWith('123456', undefined)
    await waitFor(() => expect(result).toEqual({ pin: '123456', sigPin: undefined }), { timeout: 2_000 })
  })

  it('Pruefung abgelehnt: Fehler im Dialog, KEINE Uebergabe, Retry moeglich', async () => {
    render(<PinModal />)
    let n = 0
    // (Dialog-Oeffnung ist asynchron wie oben)
    const verify = async () => { n += 1; return n === 1 ? { ok: false, message: 'PIN falsch (2 Versuche)' } : { ok: true } }
    let result: unknown = 'pending'
    void useUiStore.getState().requestPin({ title: 'PIN', needSigPin: false, verify }).then((r) => { result = r })
    await screen.findByTestId('pin-input')
    fireEvent.change(screen.getByTestId('pin-input'), { target: { value: '0000' } })
    fireEvent.click(screen.getByTestId('pin-ok'))
    await waitFor(() => expect(screen.getByTestId('pin-error')).toHaveTextContent('PIN falsch'))
    expect(useUiStore.getState().pendingPin, 'Dialog bleibt offen').not.toBeNull()
    expect(result, 'PIN nicht uebergeben').toBe('pending')
    fireEvent.click(screen.getByTestId('pin-ok')) // Retry mit selberm Wert, jetzt ok
    await waitFor(() => expect(result).toEqual({ pin: '0000', sigPin: undefined }), { timeout: 2_000 })
  })
})
