import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { cancelChat, estimateChat, getAiConfig, streamChat, type AiConfigView, type EstimateResult } from '@/lib/aiClient'
import type { AiChatEvent } from '@/lib/apiTypes'
import type { PdfRect } from '@/lib/pdfCoords'
import { notifyError, useAppStore } from '@/store/useAppStore'
import { errorMessage } from '@/i18n'
import type { OverlayTool } from '@/components/InteractionOverlay'

// KI-Flaeche (Section 5). Haelt Konfigurations-Snapshot, Chat-Verlauf, Streaming-Zustand, das aktive
// Overlay-Tool und die per Overlay gezogene VLM-Region (PDF-User-Space). AI-Aenderungen am Dokument
// laufen ausschliesslich durch einen bestaetigten Command — hier wird nichts automatisch geschrieben.

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  sources: number[] // Seiten, die als Quellen angegeben wurden (1-basiert)
  withoutSource: boolean // Antwort ohne zuordenbare Seitenreferenz (Section 5.5)
  streaming: boolean
  error?: string
}

interface AiState {
  config: AiConfigView | null
  messages: ChatMessage[]
  streaming: boolean
  streamId: string | null
  activeTool: OverlayTool
  pendingRegion: PdfRect | null
  lastEstimate: EstimateResult | null
}

interface AiActions {
  loadConfig: () => Promise<void>
  setConfig: (c: AiConfigView) => void
  ask: (question: string) => Promise<void>
  stop: () => Promise<void>
  clearChat: () => void
  setTool: (t: OverlayTool) => void
  setRegion: (r: PdfRect | null) => void
  setEstimate: (e: EstimateResult | null) => void
  estimate: (question: string) => Promise<void>
}

export type AiStore = AiState & AiActions

let controller: AbortController | null = null

export const useAiStore = create<AiStore>()(
  immer((set, get) => ({
    config: null,
    messages: [],
    streaming: false,
    streamId: null,
    activeTool: 'none',
    pendingRegion: null,
    lastEstimate: null,

    loadConfig: async () => {
      try {
        const c = await getAiConfig()
        set((s) => {
          s.config = c
        })
      } catch (err) {
        notifyError(err)
      }
    },
    setConfig: (c) => set((s) => { s.config = c }),

    estimate: async (question) => {
      const page = useAppStore.getState().currentPage
      try {
        const e = await estimateChat({ question, page })
        set((s) => { s.lastEstimate = e })
      } catch (err) {
        notifyError(err)
      }
    },

    ask: async (question) => {
      if (get().streaming) return
      const page = useAppStore.getState().currentPage
      const q = question.trim()
      if (!q) return
      controller = new AbortController()
      const userId = crypto.randomUUID()
      const aId = crypto.randomUUID()
      set((s) => {
        s.messages.push({ id: userId, role: 'user', text: q, sources: [], withoutSource: false, streaming: false })
        s.messages.push({ id: aId, role: 'assistant', text: '', sources: [], withoutSource: true, streaming: true })
        s.streaming = true
        s.streamId = null
      })
      const onEvent = (e: AiChatEvent): void => {
        set((s) => {
          const m = s.messages.find((x) => x.id === aId)
          if (!m) return
          if (e.kind === 'meta') s.streamId = e.streamId
          else if (e.kind === 'token') m.text += e.text
          else if (e.kind === 'done') {
            m.streaming = false
            m.sources = e.sources
            m.withoutSource = e.sources.length === 0
            s.streaming = false
          } else if (e.kind === 'cancelled') {
            m.streaming = false
            s.streaming = false
          } else if (e.kind === 'error') {
            m.streaming = false
            m.error = e.code
            m.text = m.text || errorMessage(e.code)
            s.streaming = false
          }
        })
        if (e.kind === 'error') {
          useAppStore.getState().addToast({ kind: 'error', message: errorMessage(e.code), details: e.code })
        }
      }
      try {
        await streamChat({ question: q, page }, controller.signal, onEvent)
      } catch (err) {
        notifyError(err)
      } finally {
        set((s) => {
          const m = s.messages.find((x) => x.id === aId)
          if (m) m.streaming = false
          s.streaming = false
        })
        controller = null
      }
    },

    stop: async () => {
      const sid = get().streamId
      controller?.abort()
      if (sid) {
        try {
          await cancelChat(sid)
        } catch (err) {
          notifyError(err)
        }
      }
      set((s) => {
        for (const m of s.messages) if (m.streaming) m.streaming = false
        s.streaming = false
      })
    },

    clearChat: () =>
      set((s) => {
        s.messages = []
        s.lastEstimate = null
      }),

    setTool: (t) => set((s) => { s.activeTool = t }),
    setRegion: (r) => set((s) => { s.pendingRegion = r }),
    setEstimate: (e) => set((s) => { s.lastEstimate = e })
  }))
)

// Quellen-Chip klickt -> Canvas springt auf die Seite und die Seite wird als Sprungmarke markiert.
export function jumpToSource(page: number): void {
  useAppStore.getState().setCurrentPage(page)
}
