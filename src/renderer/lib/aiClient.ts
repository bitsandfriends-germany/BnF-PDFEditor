import { api, sseStream } from '@/lib/apiClient'
import type { AiChatEvent } from '@/lib/apiTypes'

// Getypter Client fuer die KI-Routen (Step 6 Backend). Spricht nur den getypten HTTP-Client.
// API-Keys reisen NIEMALS durch dieses Modul in den Renderer — dafuer ist das Backend zustaendig.

export interface TextModelCfg {
  baseUrl: string
  model: string
  contextWindow: number
  temperature: number
}
export interface VisionModelCfg {
  baseUrl: string
  model: string
  enabled: boolean
}
export interface DoclingCfg {
  available: boolean
  ocrEnabled: boolean
  ocrLanguages: string[]
  tableStructure: boolean
}
export interface PrivacyCfg {
  logPrompts: boolean
  confirmBeforeSend: boolean
  maxPagesPerRequest: number
}
export interface AiConfigView {
  textModel: TextModelCfg | null
  visionModel: VisionModelCfg | null
  docling: DoclingCfg
  privacy: PrivacyCfg
  textConfigured: boolean
  visionConfigured: boolean
  keyStatus?: Record<string, boolean>
  version?: number
}
export interface ModelsResult {
  ok: boolean
  models: string[]
  latencyMs?: number
  host?: string
  error?: string
  message?: string
}
export interface EstimateResult {
  estimatedInputTokens: number
  pagesAffected: number[]
  nonLocal: boolean
  host: string
  requireConfirm: boolean
}
export interface ChatRequest {
  contextId?: string | null
  question: string
  page?: number
  scope?: { from: number; to?: number }
}

export function getAiConfig(): Promise<AiConfigView> {
  return api.get<AiConfigView>('/config/ai')
}

export function putAiConfig(cfg: unknown): Promise<AiConfigView> {
  return api.put<AiConfigView>('/config/ai', cfg)
}

export function testAiConnection(section: 'text' | 'vision', candidate: { baseUrl: string; model?: string }): Promise<ModelsResult> {
  return api.post<ModelsResult>('/config/ai/test', { section, candidate })
}

export function listModels(section: 'text' | 'vision'): Promise<ModelsResult> {
  return api.get<ModelsResult>(`/ai/models?section=${encodeURIComponent(section)}`)
}

export function setAiKey(section: 'text' | 'vision', key: string, mode?: string): Promise<unknown> {
  return api.post('/config/ai/key', { section, key, ...(mode ? { mode } : {}) })
}

export function estimateChat(req: ChatRequest): Promise<EstimateResult> {
  return api.post<EstimateResult>('/ai/estimate', req)
}

export function streamChat(req: ChatRequest, signal: AbortSignal, onEvent: (e: AiChatEvent) => void): Promise<void> {
  return sseStream('/ai/chat', req, signal, onEvent)
}

export function cancelChat(streamId: string): Promise<{ streamId: string; status: string }> {
  return api.post('/ai/chat/cancel', { streamId })
}

// Basis-URL gilt als lokal, wenn Host localhost/127.0.0.1/::1 (Section 5.5 Bestaetigung nur sonst).
export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const h = new URL(baseUrl).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '::1'
  } catch {
    return false
  }
}
