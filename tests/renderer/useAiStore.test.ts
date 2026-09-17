import { describe, it, expect, vi, beforeEach } from 'vitest'

// Die Chat-Orchestrierung wird gegen einen gemockten KI-Client getestet: kein echtes SSE, kein fetch.
const streamChat = vi.fn()
const cancelChat = vi.fn()
const getAiConfig = vi.fn()
const estimateChat = vi.fn()

vi.mock('@/lib/aiClient', () => ({
  streamChat: (...a: unknown[]): unknown => streamChat(...a),
  cancelChat: (...a: unknown[]): unknown => cancelChat(...a),
  getAiConfig: (...a: unknown[]): unknown => getAiConfig(...a),
  estimateChat: (...a: unknown[]): unknown => estimateChat(...a)
}))

const { useAiStore } = await import('@/store/useAiStore')
const { useAppStore } = await import('@/store/useAppStore')
const { setLang } = await import('@/i18n')

function reset(): void {
  useAiStore.setState({ config: null, messages: [], streaming: false, streamId: null, activeTool: 'none', pendingRegion: null, lastEstimate: null })
  useAppStore.setState({ currentPage: 2 })
}

describe('useAiStore — Chat', () => {
  beforeEach(() => {
    setLang('de')
    vi.clearAllMocks()
    reset()
  })

  it('ask() sammelt Tokens und setzt Quellen am done-Ereignis', async () => {
    streamChat.mockImplementation((_req: unknown, _sig: AbortSignal, onEvent: (e: never) => void) => {
      onEvent({ kind: 'meta', streamId: 's1', pagesEntered: [2] } as never)
      onEvent({ kind: 'token', text: 'Teil' } as never)
      onEvent({ kind: 'token', text: 'text' } as never)
      onEvent({ kind: 'done', sources: [2, 4], pagesEntered: [2] } as never)
      return Promise.resolve()
    })
    await useAiStore.getState().ask('Frage?')
    const msgs = useAiStore.getState().messages
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(assistant?.text).toBe('Teiltext')
    expect(assistant?.sources).toEqual([2, 4])
    expect(assistant?.withoutSource).toBe(false)
    expect(assistant?.streaming).toBe(false)
    expect(useAiStore.getState().streaming).toBe(false)
    expect(useAiStore.getState().streamId).toBe('s1')
  })

  it('done ohne Quellen markiert "ohne Quellenangabe"', async () => {
    streamChat.mockImplementation((_r: unknown, _s: AbortSignal, onEvent: (e: never) => void) => {
      onEvent({ kind: 'done', sources: [], pagesEntered: [] } as never)
      return Promise.resolve()
    })
    await useAiStore.getState().ask('x')
    const a = useAiStore.getState().messages.find((m) => m.role === 'assistant')
    expect(a?.withoutSource).toBe(true)
  })

  it('error-Ereignis setzt Fehler + Fehler-Toast', async () => {
    streamChat.mockImplementation((_r: unknown, _s: AbortSignal, onEvent: (e: never) => void) => {
      onEvent({ kind: 'error', code: 'ai_timeout', message: 'Timeout' } as never)
      return Promise.resolve()
    })
    await useAiStore.getState().ask('x')
    const a = useAiStore.getState().messages.find((m) => m.role === 'assistant')
    expect(a?.error).toBe('ai_timeout')
    expect(useAppStore.getState().toasts.some((t) => t.kind === 'error')).toBe(true)
    expect(useAiStore.getState().streaming).toBe(false)
  })

  it('stop() bricht ab und ruft cancelChat mit der streamId', async () => {
    let resolveStream: (() => void) | null = null
    streamChat.mockImplementation(() => new Promise<void>((r) => (resolveStream = r)))
    useAiStore.setState({ streaming: true, streamId: 's42' })
    cancelChat.mockResolvedValue({ streamId: 's42', status: 'cancelling' })
    await useAiStore.getState().stop()
    expect(cancelChat).toHaveBeenCalledWith('s42')
    expect(useAiStore.getState().streaming).toBe(false)
    resolveStream?.()
  })

  it('leere Frage loest keinen Stream aus', async () => {
    await useAiStore.getState().ask('   ')
    expect(streamChat).not.toHaveBeenCalled()
  })
})
