import { useEffect, useState } from 'react'
import { ShieldCheck, Info, CircleDot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PlatformInfo, BackendStatus, BackendStatusSnapshot } from '@shared/ipc'
import { useAppStore } from '@/store/useAppStore'
import { initApiClient } from '@/lib/apiClient'
import { refreshDocumentState } from '@/store/useAppStore'
import { ToastViewport } from '@/components/Toast'
import { AppShell } from '@/components/AppShell'
import { useT } from '@/i18n'
import { useUiStore } from '@/store/useUiStore'

interface Snapshot {
  version: string
  platform: PlatformInfo
}

const STATUS_KEY: Record<BackendStatus, string> = {
  starting: 'backend.status.starting',
  ready: 'backend.status.ready',
  crashed: 'backend.status.crashed'
}

const STATUS_CLASS: Record<BackendStatus, string> = {
  starting: 'bg-muted text-muted-foreground',
  ready: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  crashed: 'bg-destructive/15 text-destructive'
}

export function App(): React.JSX.Element {
  const t = useT()
  const backendStatus = useAppStore((s) => s.backendStatus)
  const setBackendStatus = useAppStore((s) => s.setBackendStatus)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [port, setPort] = useState<number | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  // R75: persistente Einstellungen laden (Tooltips, Render-Modus) und Aenderungen aus dem
  // Main-Prozess uebernehmen (z. B. wenn die Automatik nach GPU-Abstuerzen umschaltet).
  useEffect(() => {
    void useUiStore.getState().loadAppSettings()
    const bridge = window.pdfEditor as unknown as {
      onAppSettings?: (cb: (snap: { settings: { renderMode: 'auto' | 'gpu' | 'software'; tooltips: boolean; gpuFailures: number }; plan: { effective: 'gpu' | 'software'; reason: string } }) => void) => () => void
    }
    const off = bridge.onAppSettings?.((snap) => {
      useUiStore.getState().setTooltips(snap.settings.tooltips)
      useUiStore.getState().setRenderInfo({
        mode: snap.settings.renderMode,
        effective: snap.plan.effective,
        reason: snap.plan.reason,
        gpuFailures: snap.settings.gpuFailures
      })
    })
    return () => off?.()
  }, [])

  useEffect(() => {
    let cancelled = false
    let clientReady = false

    const apply = async (snap: BackendStatusSnapshot): Promise<void> => {
      if (cancelled) return
      // DEFECT-RACE (gefundet per gepacktem Smoke, argv-Open): 'ready' durfte nicht im Store
      // stehen, bevor der API-Client Token/Port hat — sonst feuert der argv-Open-Effekt der
      // AppShell ohne initialisierten Client ins Leere. Init zuerst, Status danach.
      let justInited = false
      if (snap.status === 'ready' && !clientReady) {
        clientReady = await initApiClient(window.pdfEditor)
        justInited = clientReady
      }
      if (cancelled) return
      setBackendStatus(snap.status, snap.restartCount)
      setPort(snap.port)
      if (justInited) void refreshDocumentState()
    }

    const off = window.pdfEditor.onBackendStatus((snap) => void apply(snap))
    void (async () => {
      try {
        const [version, platform, initialBackend] = await Promise.all([
          window.pdfEditor.getAppVersion(),
          window.pdfEditor.getPlatformInfo(),
          window.pdfEditor.getBackendStatus()
        ])
        if (!cancelled) {
          setSnapshot({ version, platform })
          window.pdfEditor.writeLog({ level: 'info', action: 'RENDERER_READY', payload: { version } })
          await apply(initialBackend)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      off()
    }
  }, [setBackendStatus])

  // Sobald das Backend bereit ist, lebt die echte UI-Shell; bis dahin bleibt die Boot-/Umgebungsansicht.
  if (backendStatus === 'ready' && !error) {
    return (
      <>
        <AppShell />
        <ToastViewport />
      </>
    )
  }

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-8 w-8 text-primary" aria-hidden />
        <h1 className="text-2xl font-semibold">{t('app.title')}</h1>
      </div>

      <div
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${STATUS_CLASS[backendStatus]}`}
      >
        <CircleDot className="h-4 w-4" aria-hidden />
        {t(STATUS_KEY[backendStatus])}
        {backendStatus === 'ready' && port ? <span className="font-mono text-xs opacity-70">:{port}</span> : null}
      </div>

      <p className="max-w-md text-sm text-muted-foreground">{t('app.subtitle')}</p>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {t('app.bridgeError')}: {error}
        </div>
      ) : snapshot ? (
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 text-left text-sm shadow-sm">
          <Row label="Electron" value={snapshot.platform.electron} />
          <Row label="Chromium" value={snapshot.platform.chrome} />
          <Row label="Node" value={snapshot.platform.node} />
          <Row label={t('app.version')} value={snapshot.version} />
          <Row label="Display‑Server" value={snapshot.platform.wayland ? 'Wayland' : 'X11'} />
          <Row label="Ozone‑Hint" value={snapshot.platform.ozoneHint ?? 'auto'} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('app.bridgeChecking')}</p>
      )}

      <Button variant="outline" aria-label={t('common.environment')} onClick={() => setSnapshot((s) => s)}>
        <Info aria-hidden />
        {t('common.environment')}
      </Button>

      <ToastViewport />
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex justify-between border-b border-border/60 py-1 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}
