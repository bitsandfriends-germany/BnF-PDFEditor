import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { App } from '@/App'
import { setLang } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import type { PdfEditorBridge, PlatformInfo, BackendStatusSnapshot } from '@shared/ipc'

// Der Test prueft die typisierte contextBridge-Grenze: App spricht ausschliesslich ueber
// window.pdfEditor (kein fs, kein Electron-Import im Renderer — Layering, Section 0.2).

const platform: PlatformInfo = {
  platform: 'linux',
  arch: 'x64',
  electron: '33.4.11',
  chrome: '130.0.0.0',
  node: '20.18.1',
  wayland: true,
  ozoneHint: null,
  username: 'tester'
}

const readyBackend: BackendStatusSnapshot = { status: 'ready', port: 41234, pid: 4242, restartCount: 0 }

function baseBridge(overrides: Partial<PdfEditorBridge> = {}): PdfEditorBridge {
  return {
    pathForFile: () => '',
    getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
    getPlatformInfo: vi.fn().mockResolvedValue(platform),
    getBackendStatus: vi.fn().mockResolvedValue(readyBackend),
    getBackendAuth: vi.fn().mockResolvedValue(null),
    onBackendStatus: vi.fn().mockReturnValue(() => {}),
    // R75: Einstellungen (Render-Modus/Tooltips) — Renderer liest sie beim Start.
    getAppSettings: vi.fn().mockResolvedValue({
      settings: { renderMode: 'auto', tooltips: true, gpuFailures: 0 },
      plan: { effective: 'gpu', disableHardwareAcceleration: false, switches: [], reason: 'Test' }
    }),
    setAppSettings: vi.fn().mockResolvedValue({
      settings: { renderMode: 'auto', tooltips: true, gpuFailures: 0 },
      plan: { effective: 'gpu', disableHardwareAcceleration: false, switches: [], reason: 'Test' }
    }),
    onAppSettings: vi.fn().mockReturnValue(() => {}),
    onMenuCommand: vi.fn().mockReturnValue(() => {}),
    writeLog: vi.fn(),
    openPdfDialog: vi.fn().mockResolvedValue(null),
    savePdfDialog: vi.fn().mockResolvedValue(null),
    pickCertDialog: vi.fn().mockResolvedValue(null),
    chooseDirectory: vi.fn().mockResolvedValue(null),
    pickImage: vi.fn().mockResolvedValue(null),
    listRecent: vi.fn().mockResolvedValue([]),
    addRecent: vi.fn().mockResolvedValue(undefined),
    removeRecent: vi.fn().mockResolvedValue(undefined),
    onLogLine: vi.fn().mockReturnValue(() => {}),
    logTail: vi.fn().mockResolvedValue([]),
    writeDebugDump: vi.fn().mockResolvedValue(null),
    getCodegraph: vi.fn().mockResolvedValue(null),
    getInitialFile: vi.fn().mockResolvedValue(null),
    ...overrides
  }
}

function installBridge(bridge: PdfEditorBridge): PdfEditorBridge {
  Object.defineProperty(window, 'pdfEditor', { value: bridge, configurable: true })
  return bridge
}

describe('App (Renderer ↔ Bridge)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setLang('de') // Deterministisch: Testsprache Deutsch, unabhängig von navigator.language.
    useAppStore.getState().setBackendStatus('starting', 0) // kein 'ready'-Leak aus dem Vorgängertest
  })

  it('zeigt die UI-Shell (Öffnen-Button), sobald das Backend bereit ist, und loggt RENDERER_READY', async () => {
    const bridge = installBridge(baseBridge())
    render(<App />)

    // Shell-Chrome ist erreichbar, sobald Backend 'ready' — der Oeffnen-Button spricht nur die Bridge.
    expect(await screen.findByRole('button', { name: 'Öffnen' })).toBeInTheDocument()

    await waitFor(() =>
      expect(bridge.writeLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info', action: 'RENDERER_READY' })
      )
    )
    // Der Renderer darf kein ts und kein source mitschicken (Main ist Single-Writer).
    const call = vi.mocked(bridge.writeLog).mock.calls[0]?.[0]
    if (!call) throw new Error('writeLog wurde nicht aufgerufen')
    const keys = Object.keys(call)
    expect(keys).not.toContain('ts')
    expect(keys).not.toContain('source')
  })

  it('zeigt vor der Backend-Bereitschaft die Boot-/Umgebungsansicht aus der Bridge', async () => {
    installBridge(
      baseBridge({
        getBackendStatus: vi.fn().mockResolvedValue({ status: 'starting', port: 0, pid: 0, restartCount: 0 })
      })
    )
    render(<App />)

    expect(await screen.findByText('33.4.11')).toBeInTheDocument()
    expect(screen.getByText('Wayland')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    // Noch kein Shell-Oeffnen-Button, solange nicht bereit.
    expect(screen.queryByRole('button', { name: 'Öffnen' })).not.toBeInTheDocument()
  })

  it('zeigt eine sichtbare Fehlermeldung, wenn die Bridge scheitert', async () => {
    installBridge(
      baseBridge({
        getAppVersion: vi.fn().mockRejectedValue(new Error('Bruecke nicht bereit'))
      })
    )
    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Bruecke nicht bereit')
  })
})

