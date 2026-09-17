import { describe, it, expect, beforeEach } from 'vitest'
import {
  configureForTest,
  buildHeaders,
  newCorrelationId,
  shouldRetry,
  backoffMs,
  mapError,
  api,
  ApiError,
  isApiClientReady
} from '@/lib/apiClient'

// Unit-Tests fuer die reinen Client-Helfer + einen Ende-zu-Ende-Pfad ueber einen Fake-Adapter.

beforeEach(() => {
  configureForTest({ baseUrl: 'http://127.0.0.1:1', token: 'tok-123' })
})

describe('apiClient-Helfer', () => {
  it('erzeugt eindeutige Correlation-Ids', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 500; i++) ids.add(newCorrelationId())
    expect(ids.size).toBe(500)
  })

  it('setzt Auth- und Correlation-Header', () => {
    const h = buildHeaders('cid-9')
    expect(h['X-Auth-Token']).toBe('tok-123')
    expect(h['X-Correlation-Id']).toBe('cid-9')
  })

  it('wiederholt nur idempotente GETs bei 5xx/Netzwerk, nie Mutationen/4xx', () => {
    expect(shouldRetry('GET', { response: { status: 503 } }, 0)).toBe(true)
    expect(shouldRetry('GET', { response: { status: 404 } }, 0)).toBe(false)
    expect(shouldRetry('POST', { response: { status: 500 } }, 0)).toBe(false)
    expect(shouldRetry('GET', {}, 0)).toBe(true) // Netzwerkfehler ohne response
    expect(shouldRetry('GET', { response: { status: 500 } }, 2)).toBe(false) // Budget aufgebraucht
  })

  it('Staffelung der Backoff-Zeiten', () => {
    expect(backoffMs(0)).toBe(200)
    expect(backoffMs(1)).toBe(600)
    expect(backoffMs(5)).toBe(600) // geklemmt
  })

  it('mappt HTTP-Fehlerbody auf ApiError mit Code + correlationId', () => {
    const err = { response: { status: 422, data: { error: 'bad_page', message: 'raus', correlationId: 'c1' }, headers: {} } }
    const e = mapError(err, 'fallback-cid')
    expect(e).toBeInstanceOf(ApiError)
    expect(e.code).toBe('bad_page')
    expect(e.correlationId).toBe('c1')
    expect(e.status).toBe(422)
  })

  it('mappt Netzwerkfehler auf Code network', () => {
    const e = mapError({ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout' }, 'cid')
    expect(e.code).toBe('network')
  })
})

describe('Ende-zu-Ende ueber Fake-Adapter', () => {
  it('GET wiederholt bei 500 und liefert dann Daten', async () => {
    let calls = 0
    const seenHeaders: Record<string, unknown>[] = []
    configureForTest({
      baseUrl: 'http://127.0.0.1:1',
      token: 'tok-xyz',
      adapter: ((config: { headers: Record<string, unknown> }) => {
        calls += 1
        seenHeaders.push(config.headers)
        if (calls < 2) {
          return Promise.reject({ config, response: { status: 500, data: {}, headers: {} }, isAxiosError: true })
        }
        return Promise.resolve({ data: { ok: true, n: calls }, status: 200, statusText: 'OK', headers: {}, config })
      }) as never
    })
    expect(isApiClientReady()).toBe(true)
    const res = await api.get<{ ok: boolean; n: number }>('/document/state')
    expect(res).toEqual({ ok: true, n: 2 })
    expect(calls).toBe(2)
    expect(seenHeaders[0]?.['X-Auth-Token']).toBe('tok-xyz')
    expect(typeof seenHeaders[0]?.['X-Correlation-Id']).toBe('string')
  })

  it('POST wird bei 500 nicht wiederholt und wirft ApiError', async () => {
    let calls = 0
    configureForTest({
      baseUrl: 'http://127.0.0.1:1',
      token: 'tok-xyz',
      adapter: ((config: { headers: Record<string, unknown> }) => {
        calls += 1
        return Promise.reject({
          config,
          isAxiosError: true,
          response: { status: 500, data: { error: 'read_only', message: 'ro', correlationId: 'c' }, headers: {} }
        })
      }) as never
    })
    await expect(api.post('/document/rotate', { page: 1 })).rejects.toBeInstanceOf(ApiError)
    expect(calls).toBe(1)
  })
})
