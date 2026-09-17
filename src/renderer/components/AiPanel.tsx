import { useEffect, useRef, useState } from 'react'
import { Sparkles, Square, Send } from 'lucide-react'
import { useT } from '@/i18n'
import { useAiStore, jumpToSource } from '@/store/useAiStore'
import { useAppStore } from '@/store/useAppStore'
import { listModels } from '@/lib/aiClient'
import { useUiStore } from '@/store/useUiStore'

type Conn = 'unknown' | 'ok' | 'down'

export function AiPanel(): JSX.Element {
  const t = useT()
  const config = useAiStore((s) => s.config)
  const loadConfig = useAiStore((s) => s.loadConfig)
  const messages = useAiStore((s) => s.messages)
  const streaming = useAiStore((s) => s.streaming)
  const ask = useAiStore((s) => s.ask)
  const stop = useAiStore((s) => s.stop)
  const estimate = useAiStore((s) => s.estimate)
  const lastEstimate = useAiStore((s) => s.lastEstimate)
  const setTool = useAiStore((s) => s.setTool)
  const pendingRegion = useAiStore((s) => s.pendingRegion)
  const openSettings = useUiStore((s) => s.openSettings)
  const docOpen = useAppStore((s) => s.docOpen)

  const [draft, setDraft] = useState('')
  const [conn, setConn] = useState<Conn>('unknown')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  useEffect(() => {
    if (!config?.textConfigured) {
      setConn('unknown')
      return
    }
    let alive = true
    listModels('text')
      .then((r) => alive && setConn(r.ok ? 'ok' : 'down'))
      .catch(() => alive && setConn('down'))
    return () => {
      alive = false
    }
  }, [config?.textConfigured])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const docling = config?.docling.available ?? false
  const vision = config?.visionConfigured ?? false

  const send = (): void => {
    const q = draft.trim()
    if (!q) return
    setDraft('')
    void ask(q)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 p-2 text-xs">
        <Sparkles size={14} className="text-sky-600" aria-hidden />
        <span className="font-medium">{config?.textModel?.model || t('sidebar.tab.ai')}</span>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5">{connLabel(conn, config?.textConfigured ?? false, t)}</span>
        {!docling ? <span title={t('ai.basicExtraction')} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{t('ai.basicBadge')}</span> : null}
      </div>

      {!config?.textConfigured ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="text-sm text-slate-600">{t('ai.notConfigured')}</p>
          <button data-testid="ai-configure" type="button" onClick={openSettings} className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700">
            {t('ai.configure')}
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 space-y-2 overflow-auto p-2" role="log" aria-live="polite">
            {messages.map((m) => (
              <div key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'ml-6 bg-sky-50' : 'mr-6 bg-slate-50'}`}>
                {m.error ? <span className="font-medium text-red-600">{t('toast.errorPrefix')} </span> : null}
                <span className="whitespace-pre-wrap">{m.text}</span>
                {m.role === 'assistant' && !m.streaming && m.sources.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.sources.map((p) => (
                      <button data-testid={`ai-src-page-${p}`} key={p} type="button" onClick={() => jumpToSource(p)} data-src={p} className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500" title={t('pagination.goto', { page: p })}>
                        {t('pagination.page')} {p}
                      </button>
                    ))}
                  </div>
                ) : null}
                {m.role === 'assistant' && !m.streaming && m.withoutSource && !m.error ? (
                  <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{t('ai.withoutSource')}</span>
                ) : null}
              </div>
            ))}
            {streaming ? (
              <div className="mr-6 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
                <span className="animate-pulse">…</span>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="border-t border-slate-200 p-2">
            <div className="mb-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
              {lastEstimate ? (
                <span title={t('ai.costHint')}>
                  ≈ {lastEstimate.estimatedInputTokens} Tokens · {lastEstimate.pagesAffected.length} {t('ai.pagesSuffix')}
                  {lastEstimate.requireConfirm ? ` · ${t('ai.confirmSend', { n: lastEstimate.pagesAffected.length, host: lastEstimate.host })}` : ''}
                </span>
              ) : null}
              <div className="ml-auto flex gap-1">
                <button data-testid="ai-tables" type="button" disabled={!docOpen || !docling} title={docling ? t('ai.tables') : t('ai.needsDocling')} onClick={() => void ask(t('ai.tablesPrompt'))} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40">
                  {t('ai.tables')}
                </button>
                <button data-testid="ai-select-region" type="button" disabled={!vision} title={vision ? t('ai.selectRegion') : t('ai.visionOff')} onClick={() => setTool('select-rect')} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40">
                  {t('ai.selectRegion')}
                </button>
              </div>
            </div>
            {pendingRegion ? <div className="mb-1 text-xs text-slate-500">{t('ai.regionSet')} x={Math.round(pendingRegion.x)} y={Math.round(pendingRegion.y)} {Math.round(pendingRegion.width)}×{Math.round(pendingRegion.height)}pt <button data-testid="ai-cancel-region" type="button" onClick={() => setTool('none')} className="ml-1 underline">{t('common.cancel')}</button></div> : null}
            <div className="flex items-end gap-2">
              <textarea data-testid="ai-input"
                value={draft}
                rows={2}
                aria-label={t('ai.placeholder')}
                placeholder={t('ai.placeholder')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                onFocus={() => draft && void estimate(draft)}
                className="flex-1 resize-none rounded-md border border-slate-300 px-2 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
              />
              {streaming ? (
                <button data-testid="ai-stop" type="button" onClick={() => void stop()} title={t('ai.stop')} aria-label={t('ai.stop')} className="rounded-md bg-red-600 p-2 text-white hover:bg-red-700">
                  <Square size={16} />
                </button>
              ) : (
                <button data-testid="ai-send" type="button" onClick={send} disabled={!draft.trim()} title={t('ai.send')} aria-label={t('ai.send')} className="rounded-md bg-sky-600 p-2 text-white hover:bg-sky-700 disabled:opacity-50">
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function connLabel(conn: Conn, configured: boolean, t: (k: string) => string): string {
  if (!configured) return t('ai.statusNotConfigured')
  if (conn === 'ok') return t('ai.statusConnected')
  if (conn === 'down') return t('ai.statusUnreachable')
  return t('ai.statusConfigured')
}
