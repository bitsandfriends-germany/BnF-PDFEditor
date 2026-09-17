import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useUiStore } from '@/store/useUiStore'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const describeCertificate = vi.fn()
const signDocument = vi.fn().mockResolvedValue(true)
const getDocumentProperties = vi.fn().mockResolvedValue({ pageWidth: 612, pageHeight: 792 })
const listSignatures = vi.fn().mockResolvedValue([])
const getSignatureImageB64 = vi.fn().mockResolvedValue('QUJD')
vi.mock('@/lib/documents', () => ({
  describeCertificate: (...a: unknown[]) => describeCertificate(...a),
  signDocument: (...a: unknown[]) => signDocument(...a),
  getDocumentProperties: (...a: unknown[]) => getDocumentProperties(...a),
  listSignatures: () => listSignatures(),
  getSignatureImageB64: (id: string) => getSignatureImageB64(id)
}))

const { setLang } = await import('@/i18n')
const { useAppStore } = await import('@/store/useAppStore')
const { CertificatePanel } = await import('@/components/CertificatePanel')

const pickCertDialog = vi.fn().mockResolvedValue('/cert/me.p12')
const okInfo = { subject: 'CN=Max', issuer: 'CN=CA', expired: false, notYetValid: false, selfSigned: false, hasPrivateKey: true, canSignWith: true, warnings: [] }

beforeEach(() => {
  setLang('de')
  vi.clearAllMocks()
  describeCertificate.mockResolvedValue(okInfo)
  listSignatures.mockResolvedValue([])
  getSignatureImageB64.mockResolvedValue('QUJD')
  useAppStore.setState({ docOpen: true, currentPage: 3, toasts: [] })
  ;(window as unknown as { pdfEditor: unknown }).pdfEditor = { pickCertDialog }
})

describe('CertificatePanel', () => {
  it('waehlt Datei und zeigt Ueberblick nach Pruefung', async () => {
    render(<CertificatePanel />)
    // R60: Abschnitte sind standardmaessig eingeklappt -> erst oeffnen.
    fireEvent.click(screen.getByTestId('cert-sec-p12'))
    fireEvent.click(screen.getByTestId('cert-choose'))
    await waitFor(() => expect(pickCertDialog).toHaveBeenCalled())
    expect(screen.getByTestId('cert-path')).toHaveValue('/cert/me.p12')
    fireEvent.change(screen.getByTestId('cert-pw'), { target: { value: 'geheim' } })
    fireEvent.click(screen.getByTestId('cert-describe'))
    await waitFor(() => expect(describeCertificate).toHaveBeenCalledWith('/cert/me.p12', 'geheim'))
    await waitFor(() => expect(screen.getByText(/CN=Max/)).toBeInTheDocument())
  })

  it('Signieren erst nach Pruefung moeglich; ruft 0-basierte Seite + Rechteck', async () => {
    render(<CertificatePanel />)
    // R60: Abschnitte sind standardmaessig eingeklappt -> erst oeffnen.
    fireEvent.click(screen.getByTestId('cert-sec-p12'))
    expect(screen.getByTestId('cert-sign')).toBeDisabled()
    fireEvent.click(screen.getByTestId('cert-choose'))
    await waitFor(() => expect(screen.getByTestId('cert-path')).toHaveValue('/cert/me.p12'))
    fireEvent.click(screen.getByTestId('cert-describe'))
    await screen.findByText(/CN=Max/)
    const signBtn = screen.getByTestId('cert-sign') as HTMLButtonElement
    await waitFor(() => expect(signBtn).toBeEnabled())
    useUiStore.getState().setSigField(3, { x: 300, y: 24, width: 200, height: 70 })
    fireEvent.click(signBtn)
    // R58: sigtes Feld ist gesetzt -> Seiten-Messung laeuft auf der Feldseite (3).
    await waitFor(() => expect(getDocumentProperties).not.toHaveBeenCalled())
    await waitFor(() => {
      const args = signDocument.mock.calls[0]
      expect(args).toBeTruthy()
      if (!args) return
      expect(args[0]).toBe('/cert/me.p12')
      expect(args[1]).toBe('') // Passwort wurde noch eingegeben -> '' (nur fuer diesen Aufruf)
      expect(args[2]).toBe(2) // currentPage 3 -> 0-basiert
      const rect = args[3] as { x: number; y: number; width: number; height: number }
      expect(rect.width).toBeGreaterThan(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(612)
    })
  })

  it('Signiert mit sichtbarem Wortlaut (Name/Grund/Ort)', async () => {
    render(<CertificatePanel />)
    // R60: Abschnitte sind standardmaessig eingeklappt -> erst oeffnen.
    fireEvent.click(screen.getByTestId('cert-sec-p12'))
    fireEvent.click(screen.getByTestId('cert-choose'))
    await waitFor(() => expect(screen.getByTestId('cert-path')).toHaveValue('/cert/me.p12'))
    fireEvent.click(screen.getByTestId('cert-describe'))
    await screen.findByText(/CN=Max/)
    fireEvent.change(screen.getByTestId('cert-sign-name'), { target: { value: 'Max Muster' } })
    fireEvent.change(screen.getByTestId('cert-sign-reason'), { target: { value: 'Abgenommen' } })
    fireEvent.change(screen.getByTestId('cert-sign-location'), { target: { value: 'Berlin' } })
    useUiStore.getState().setSigField(1, { x: 300, y: 24, width: 200, height: 70 })
    fireEvent.click(screen.getByTestId('cert-sign'))
    await waitFor(() => expect(signDocument).toHaveBeenCalled())
    const textArg = (signDocument.mock.calls[0] as unknown[])[4] as { name?: string; reason?: string; location?: string }
    expect(textArg).toMatchObject({ name: 'Max Muster', reason: 'Abgenommen', location: 'Berlin' })
  })

  it('"Nur kryptografisch" uebergibt invisible=true', async () => {
    render(<CertificatePanel />)
    // R60: Abschnitte sind standardmaessig eingeklappt -> erst oeffnen.
    fireEvent.click(screen.getByTestId('cert-sec-p12'))
    fireEvent.click(screen.getByTestId('cert-choose'))
    await waitFor(() => expect(screen.getByTestId('cert-path')).toHaveValue('/cert/me.p12'))
    fireEvent.click(screen.getByTestId('cert-describe'))
    await screen.findByText(/CN=Max/)
    fireEvent.click(screen.getByTestId('cert-sign-invisible'))
    useUiStore.getState().setSigField(1, { x: 300, y: 24, width: 200, height: 70 })
    fireEvent.click(screen.getByTestId('cert-sign'))
    await waitFor(() => expect(signDocument).toHaveBeenCalled())
    const textArg = (signDocument.mock.calls[0] as unknown[])[4] as { invisible?: boolean }
    expect(textArg).toMatchObject({ invisible: true })
  })

  it('Bibliotheksgrafik wird als Signatur-Erscheinungsbild uebergeben', async () => {
    listSignatures.mockResolvedValue([{ id: 'g1', name: 'Meine Unterschrift', fileName: 'g1.png', defaultSizePt: 120, defaultOpacity: 1, createdAt: null, mime: 'image/png', hasImage: true }])
    render(<CertificatePanel />)
    // R60: Abschnitte sind standardmaessig eingeklappt -> erst oeffnen.
    fireEvent.click(screen.getByTestId('cert-sec-p12'))
    fireEvent.click(screen.getByTestId('cert-choose'))
    await waitFor(() => expect(screen.getByTestId('cert-path')).toHaveValue('/cert/me.p12'))
    fireEvent.click(screen.getByTestId('cert-describe'))
    await screen.findByText(/CN=Max/)
    const sel = (await screen.findByTestId('cert-sign-graphic')) as HTMLSelectElement
    fireEvent.change(sel, { target: { value: 'g1' } })
    await waitFor(() => expect(getSignatureImageB64).toHaveBeenCalledWith('g1'))
    useUiStore.getState().setSigField(1, { x: 300, y: 24, width: 200, height: 70 })
    fireEvent.click(screen.getByTestId('cert-sign'))
    await waitFor(() => expect(signDocument).toHaveBeenCalled())
    const textArg = (signDocument.mock.calls[0] as unknown[])[4] as { imageB64?: string }
    expect(textArg).toMatchObject({ imageB64: 'QUJD' })
  })

  it('abgelaufenes Zertifikat blockiert das Signieren', async () => {
    describeCertificate.mockResolvedValue({ ...okInfo, expired: true, canSignWith: false, warnings: ['abgelaufen'] })
    render(<CertificatePanel />)
    // R60: Abschnitte sind standardmaessig eingeklappt -> erst oeffnen.
    fireEvent.click(screen.getByTestId('cert-sec-p12'))
    fireEvent.click(screen.getByTestId('cert-choose'))
    await waitFor(() => expect(screen.getByTestId('cert-path')).toHaveValue('/cert/me.p12'))
    fireEvent.click(screen.getByTestId('cert-describe'))
    await screen.findByText('abgelaufen')
    expect(screen.getByTestId('cert-sign')).toBeDisabled()
    expect(screen.getByText(/^Abgelaufenes oder noch nicht/)).toBeInTheDocument()
  })
})
