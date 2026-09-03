import { describe, expect, it, vi } from 'vitest'
import {
  createGenericPerform, DEFAULT_GENERIC_ENDPOINTS, type GenericBalanceRequest,
} from '../src/generic-adapter.ts'

const ORIGIN = 'https://gateway.example'

function jsonFetch(byPath: Record<string, unknown>): typeof globalThis.fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
    const body = byPath[url.pathname]
    if (body === undefined) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof globalThis.fetch
}

function request(overrides: Partial<GenericBalanceRequest> = {}): GenericBalanceRequest {
  return { origin: ORIGIN, apiKey: 'sk-test', timeoutMs: 1_000, shapes: DEFAULT_GENERIC_ENDPOINTS, ...overrides }
}

describe('the one-api-quota shape', () => {
  it('converts the quota to the configured currency at the configured ratio', async () => {
    const fetchImpl = jsonFetch({ '/api/user/self': { success: true, data: { quota: 5_000_000 } } })
    const perform = createGenericPerform()
    const result = await perform(request(), 1_000, fetchImpl)
    expect(result).toEqual({ state: 'ok', currency: 'USD', total: '10', isAvailable: true, fetchedAt: 1_000, stale: false })
  })

  it('sends the key as a bearer header and never in the URL', async () => {
    const fetchImpl = jsonFetch({ '/api/user/self': { success: true, data: { quota: 500_000 } } })
    await createGenericPerform()(request(), 1_000, fetchImpl)
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string | URL, RequestInit][] } }).mock.calls[0]!
    expect(String(url)).not.toContain('sk-test')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })
})

describe('the openai-billing shape', () => {
  it('is tried once the first shape fails, and subtracts usage from the limit', async () => {
    const fetchImpl = jsonFetch({
      '/dashboard/billing/subscription': { hard_limit_usd: 100 },
      '/dashboard/billing/usage': { total_usage: 2_500 },
    })
    const result = await createGenericPerform()(request(), 1_000, fetchImpl)
    expect(result).toEqual({ state: 'ok', currency: 'USD', total: '75', isAvailable: true, fetchedAt: 1_000, stale: false })
  })
})

describe('the same-origin fence', () => {
  it('never builds a candidate URL off the configured origin', async () => {
    const fetchImpl = vi.fn() as unknown as typeof globalThis.fetch
    const shapes = [{ kind: 'one-api-quota' as const, path: 'https://evil.example/steal', unitsPerCurrency: 1, currency: 'USD' }]
    const result = await createGenericPerform()(request({ shapes }), 1_000, fetchImpl)
    expect(result).toEqual({ state: 'unavailable', reason: 'malformed', fetchedAt: 1_000 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('total failure', () => {
  it('answers unavailable, quietly, once every shape has failed', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 404 })) as unknown as typeof globalThis.fetch
    const result = await createGenericPerform()(request(), 1_000, fetchImpl)
    expect(result).toEqual({ state: 'unavailable', reason: 'malformed', fetchedAt: 1_000 })
  })
})

describe('the remembered shape', () => {
  it('tries the last successful shape first on the next call', async () => {
    const order: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
      order.push(url.pathname)
      if (url.pathname === '/dashboard/billing/subscription') return new Response(JSON.stringify({ hard_limit_usd: 10 }), { status: 200 })
      if (url.pathname === '/dashboard/billing/usage') return new Response(JSON.stringify({ total_usage: 0 }), { status: 200 })
      return new Response('nope', { status: 404 })
    }) as unknown as typeof globalThis.fetch
    const perform = createGenericPerform()
    await perform(request(), 1_000, fetchImpl)
    // The first call had to fail the one-api shape before reaching openai-billing.
    expect(order[0]).toBe('/api/user/self')
    order.length = 0
    await perform(request(), 2_000, fetchImpl)
    // The second call tries the shape that answered last time first.
    expect(order[0]).not.toBe('/api/user/self')
  })
})
