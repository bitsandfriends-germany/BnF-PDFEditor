// Getypte Antworten des Backends (camelCase, exakt wie routers.py / session.state()).
// Der Renderer spricht ausschliesslich gegen diese Typen, nie gegen Backend-Code (Layering 0.2).

export interface DocumentState {
  open: boolean
  originalPath: string | null
  readOnly: boolean
  dirty: boolean
  encrypted: boolean
  canUndo: boolean
  canRedo: boolean
  undoDepth: number
  pageCount: number
}

export interface PageEntry {
  index: number
  width: number
  height: number
  rotation: number
}

export interface PagesResponse {
  pages: PageEntry[]
}

export interface MetadataPatch {
  title?: string
  author?: string
  subject?: string
  keywords?: string
}

// Fehlerbody des Error-Handlers (main.py) — stabil, kein Pfad-/Passwort-Leak.
export interface ApiErrorBody {
  error: string
  message?: string
  correlationId?: string
}

// Ein AI-Chat-Ereignis (SSE), normalisiert aus dem Backend-Payload. meta/done/error/cancelled
// tragen Steuerdaten, token trägt Text. done.quellen sind die Seiten, die im Kontext waren.
export type AiChatEvent =
  | { kind: 'meta'; streamId: string; pagesEntered: number[] }
  | { kind: 'token'; text: string }
  | { kind: 'done'; sources: number[]; pagesEntered: number[] }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'cancelled' }
