import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getApiBase, addRequestInterceptor, addRequestErrorListener,
  get, post, put, patch,
} from '@/shared/api/http'
// delete is exported from http.ts via `export { del as delete }`
import * as httpModule from '@/shared/api/http'
const del = (httpModule as any).delete as typeof get

describe('HTTP client base utilities', () => {
  it('getApiBase returns /api', () => {
    expect(getApiBase()).toBe('/api')
  })
})

describe('HTTP request functions (with fetch mock)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('get sends GET request and parses API envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ code: 0, message: 'ok', data: { id: 1 } })),
    } as Response)

    const result = await get('/test')
    expect(result).toEqual({ id: 1 })
    expect(fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('post sends POST request with body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ code: 0, message: 'ok', data: null })),
    } as Response)

    await post('/test', { name: 'test' })
    expect(fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('put sends PUT request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ code: 0, message: 'ok', data: {} })),
    } as Response)

    await put('/test/1', { name: 'updated' })
    expect(fetch).toHaveBeenCalledWith(
      '/api/test/1',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('patch sends PATCH request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ code: 0, message: 'ok', data: {} })),
    } as Response)

    await patch('/test/1', { name: 'patched' })
    expect(fetch).toHaveBeenCalledWith(
      '/api/test/1',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('del sends DELETE request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ code: 0, message: 'ok', data: {} })),
    } as Response)

    await del('/test/1')
    expect(fetch).toHaveBeenCalledWith(
      '/api/test/1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('throws AppError for non-ok response with API envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ code: 1001, message: 'Validation failed', data: null })),
    } as Response)

    await expect(get('/test')).rejects.toMatchObject({
      type: 'validation',
      status: 400,
      code: '1001',
    })
  })

  it('handles 401 response by redirecting to login', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ code: 401, message: 'Unauthorized', data: null })),
    } as Response)

    await expect(get('/secure')).rejects.toMatchObject({
      type: 'auth',
      code: 'UNAUTHORIZED',
    })
  })

  it('supports request interceptors', async () => {
    const interceptor = vi.fn((ctx) => {
      ctx.headers.set('X-Custom', 'value')
      return ctx
    })
    const cleanup = addRequestInterceptor(interceptor)

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ code: 0, message: 'ok', data: {} })),
    } as Response)

    await get('/test')
    expect(interceptor).toHaveBeenCalledOnce()

    cleanup()
  })

  it('supports request error listeners', async () => {
    const listener = vi.fn()
    const cleanup = addRequestErrorListener(listener)

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ code: 500, message: 'Server error', data: null })),
    } as Response)

    await expect(get('/fail')).rejects.toBeDefined()
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/fail',
        method: 'GET',
      }),
    )

    cleanup()
  })

  it('handles timeout errors', { timeout: 10000 }, async () => {
    vi.useRealTimers()

    let abortSignal: AbortSignal | null = null

    vi.mocked(fetch).mockImplementationOnce((_url, init: any) => {
      abortSignal = init.signal
      return new Promise<never>((_, reject) => {
        abortSignal!.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'))
        })
      })
    })

    const promise = get('/slow', { timeout: 50 })
    await expect(promise).rejects.toMatchObject({
      type: 'network',
      code: 'TIMEOUT',
      status: 408,
    })
  })

  it('skipEnvelope returns raw response body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ custom: 'data' })),
    } as Response)

    const result = await get('/raw', { skipEnvelope: true })
    expect(result).toEqual({ custom: 'data' })
  })

  it('204 status returns undefined without envelope parsing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers(),
      text: () => Promise.resolve(''),
    } as Response)

    const result = await get('/empty')
    expect(result).toBeUndefined()
  })

  it('absolute URLs do not prepend /api', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ code: 0, message: 'ok', data: {} })),
    } as Response)

    await get('https://external.api/data')
    expect(fetch).toHaveBeenCalledWith(
      'https://external.api/data',
      expect.anything(),
    )
  })

  it('throws AppError for non-JSON error response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 502,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: () => Promise.resolve('Bad Gateway'),
    } as Response)

    await expect(get('/bad-gateway')).rejects.toMatchObject({
      type: 'network',
      status: 502,
    })
  })
})
