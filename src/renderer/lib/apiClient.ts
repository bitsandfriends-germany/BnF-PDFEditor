import axios, { type AxiosInstance, type AxiosError } from 'axios'
import type { ApiErrorBody, AiChatEvent } from './apiTypes'

// Typed HTTP-Client der Renderer-Schicht (Step 7). Setzt auf jeder Anfrage X-Auth-Token
// (Guard-Token aus preload, NICHT der Cloud-API-Key) und eine X-Correlation-Id, die Frontend-
// und Backend-Log verbindet (Section 6). Idempotente GETs werden mit Backoff wiederholt.

const AUTH_HEADER = 'X-Auth-Token'
const CORR_HEADER = 'X-Correlation-Id'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_RETRIES = 2
const BACKOFF_MS = [200, 600]

// Modul-Scope: Basis-URL + Guard-Token. Bewusst NICHT im zustand-Store (Sektion 5.1/3:
// Secrets gehören nicht in den Store) und nie geloggt.
let baseUrl: string | null = null
let token: string | null = null
let http: AxiosInstance = axios.create({ timeout: DEFAULT_TIMEOUT_MS })

export class ApiError extends Error {
  readonly code: string
  readonly correlationId?: string | undefined
  readonly status?: number | undefined

  constructor(code: string, message: string, correlationId?: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.correlationId = correlationId
    this.status = status
  }
}

// ---- Init (einmalig vom App-Boot aufgerufen, sobald Backend 'ready') ----
export async function initApiClient(bridge: {
  getBackendAuth(): Promise<{ baseUrl: string; token: string } | null>
}): Promise<boolean> {
  const auth = await bridge.getBackendAuth()
  if (!auth) return false
  baseUrl = auth.baseUrl
  token = auth.token
  http = axios.create({ baseURL: auth.baseUrl, timeout: DEFAULT_TIMEOUT_MS, headers: { [AUTH_HEADER]: auth.token } })
  return true
}

export function isApiClientReady(): boolean {
  return baseUrl !== null && token !== null
}

// Test-Seam: erlaubt das Einsetzen eines Adapter-Overrides ohne echtes Netzwerk.
export function configureForTest(cfg: {
  baseUrl: string
  token: string
  adapter?: (config: never) => Promise<unknown>
}): void {
  baseUrl = cfg.baseUrl
  token = cfg.token
  http = axios.create({
    baseURL: cfg.baseUrl,
    timeout: DEFAULT_TIMEOUT_MS,
    headers: { [AUTH_HEADER]: cfg.token },
    ...(cfg.adapter ? { adapter: cfg.adapter as never } : {})
  })
}

export function newCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'f' + Math.random().toString(16).slice(2) + Date.now().toString(16)
}

// Reine Helfer (unit-testbar, ohne Netz): Header, Retry-Politik, Backoff, Fehlerabbildung.
export function buildHeaders(correlationId: string): Record<string, string> {
  const h: Record<string, string> = { [CORR_HEADER]: correlationId }
  if (token) h[AUTH_HEADER] = token
  return h
}

export function backoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 600
}

// Nur idempotente Leseanfragen wiederholen; nie Mutationen (doppelte Seiteneingriffe vermeiden).
export function shouldRetry(method: string, error: unknown, attempt: number): boolean {
  if (attempt >= MAX_RETRIES) return false
  if (method.toUpperCase() !== 'GET') return false
  const ax = error as AxiosError
  const status = ax?.response?.status
  if (typeof status === 'number') return status >= 500 && status < 600
  return true // kein response-Feld => Netzwerk-/Timeout-Fehler => retryn
}

export function mapError(error: unknown, correlationId: string): ApiError {
  const ax = error as AxiosError<ApiErrorBody>
  if (ax?.response) {
    const body = ax.response.data
    const code = body?.error ?? 'pdf_error'
    const cid = body?.correlationId ?? ax.response.headers?.[CORR_HEADER.toLowerCase()] ?? correlationId
    const message = body?.message ?? `HTTP ${ax.response.status}`
    return new ApiError(code, message, cid, ax.response.status)
  }
  const timedOut = axios.isAxiosError(ax) && ax.code === 'ECONNABORTED'
  return new ApiError(timedOut ? 'network' : 'network', 'network', correlationId)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  data?: unknown,
  responseType?: 'json' | 'arraybuffer'
): Promise<T> {
  if (!isApiClientReady()) throw new ApiError('unauthorized', 'backend-not-ready')
  let attempt = 0
  for (;;) {
    const correlationId = newCorrelationId()
    try {
      const res = await http.request<T>({
        method,
        url,
        ...(data !== undefined ? { data } : {}),
        ...(responseType ? { responseType } : {}),
        headers: { [CORR_HEADER]: correlationId }
      })
      return res.data
    } catch (err) {
      if (shouldRetry(method, err, attempt)) {
        await sleep(backoffMs(attempt))
        attempt += 1
        continue
      }
      throw mapError(err, correlationId)
    }
  }
}

export const api = {
  get: <T>(url: string): Promise<T> => request<T>('GET', url),
  post: <T>(url: string, body?: unknown): Promise<T> => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown): Promise<T> => request<T>('PUT', url, body ?? {}),
  del: <T>(url: string): Promise<T> => request<T>('DELETE', url),
  // Rohe Bytes (z.B. PDF-Arbeitskopie fuer pdfjs). Kein JSON-Parse.
  getBytes: (url: string): Promise<ArrayBuffer> => request<ArrayBuffer>('GET', url, undefined, 'arraybuffer')
}

// ---- SSE (Server-Sent Events) für /ai/chat und Kontext-Fortschritt ----
// EventSource kann keine Header senden -> fetch + AbortController (Section 5.5: Abbruch).
// Normalisiert den Backend-SSE-Payload ({token} / {event:'done'|'error'|'cancelled'} / meta mit
// streamId) auf die interne AiChatEvent-Form. Eine einzelne Stelle verhindert Index/Query-Drift
// zwischen Senden und Empfang. Unbekannte Frames ergeben null und werden verworfen.
export function mapAiEvent(raw: Record<string, unknown>): AiChatEvent | null {
  if (typeof raw.token === 'string') return { kind: 'token', text: raw.token }
  if (typeof raw.event === 'string') {
    if (raw.event === 'done') return { kind: 'done', sources: numArray(raw.sources), pagesEntered: numArray(raw.pagesEntered) }
    if (raw.event === 'error') return { kind: 'error', code: String(raw.error ?? 'ai_unknown'), message: String(raw.message ?? '') }
    if (raw.event === 'cancelled') return { kind: 'cancelled' }
    return null
  }
  if (typeof raw.streamId === 'string') return { kind: 'meta', streamId: raw.streamId, pagesEntered: numArray(raw.pagesEntered) }
  return null
}

function numArray(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []
}

export async function sseStream(
  path: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: AiChatEvent) => void
): Promise<void> {
  if (!isApiClientReady()) throw new ApiError('unauthorized', 'backend-not-ready')
  const correlationId = newCorrelationId()
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: token ?? '', [CORR_HEADER]: correlationId },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok || !res.body) {
    let code = 'network'
    try {
      const data = (await res.json()) as ApiErrorBody
      code = data.error ?? code
    } catch {
      /* nicht-JSON-Fehlerbody: Code bleibt network */
    }
    throw new ApiError(code, 'stream-error', correlationId, res.status)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep = buffer.indexOf('\n\n')
    while (sep !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      for (const line of frame.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const norm = mapAiEvent(JSON.parse(payload) as Record<string, unknown>)
          if (norm) onEvent(norm)
        } catch {
          /* unvollständige/unparsbare Frame-Zeile ignorieren */
        }
      }
      sep = buffer.indexOf('\n\n')
    }
  }
}
