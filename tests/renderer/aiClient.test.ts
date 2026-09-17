import { describe, it, expect } from 'vitest'
import { mapAiEvent } from '@/lib/apiClient'

describe('mapAiEvent — Backend-SSE -> AiChatEvent', () => {
  it('token -> token', () => {
    expect(mapAiEvent({ token: 'Hallo' })).toEqual({ kind: 'token', text: 'Hallo' })
  })
  it('done -> done mit Seiten', () => {
    expect(mapAiEvent({ event: 'done', sources: [2, 3], pagesEntered: [2, 3] })).toEqual({ kind: 'done', sources: [2, 3], pagesEntered: [2, 3] })
  })
  it('done ohne Felder -> leere Arrays', () => {
    expect(mapAiEvent({ event: 'done' })).toEqual({ kind: 'done', sources: [], pagesEntered: [] })
  })
  it('error -> error mit Code/Nachricht', () => {
    expect(mapAiEvent({ event: 'error', error: 'ai_timeout', message: 'Timeout' })).toEqual({ kind: 'error', code: 'ai_timeout', message: 'Timeout' })
  })
  it('cancelled -> cancelled', () => {
    expect(mapAiEvent({ event: 'cancelled' })).toEqual({ kind: 'cancelled' })
  })
  it('meta (streamId) -> meta', () => {
    expect(mapAiEvent({ streamId: 's1', pagesEntered: [1] })).toEqual({ kind: 'meta', streamId: 's1', pagesEntered: [1] })
  })
  it('unbekannt -> null', () => {
    expect(mapAiEvent({ foo: 'bar' })).toBeNull()
  })
})
