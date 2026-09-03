import { describe, expect, it, vi } from 'vitest'
import {
  moonshotBalanceEndpoint, parseMoonshotBalanceResponse, readMoonshotBalance,
} from '../src/moonshot-balance.ts'
import type { MoonshotBalanceRequest } from '../src/moonshot-balance.ts'

const OK_BODY = {
  code: 0,
  data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 },
  scode: '0x0',
  status: true,
}

const REQUEST: MoonshotBalanceRequest = {
  endpoint: 'https://api.moonshot.ai/v1/users/me/balance',
  apiKey: 'sk-test',
  currency: 'USD',
  timeoutMs: 1_000,
}

/** A fetch that answers one JSON body. */
function jsonFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof globalThis.fetch
}

describe('moonshotBalanceEndpoint', () => {
  it('appends the documented path to the origin, discarding any configured path', () => {
    expect(moonshotBalanceEndpoint('https://api.moonshot.ai')).toBe('https://api.moonshot.ai/v1/users/me/balance')
    expect(moonshotBalanceEndpoint('https://api.moonshot.cn')).toBe('https://api.moonshot.cn/v1/users/me/balance')
  })

  it('discards a configured path — pi-ai\'s own chat base URL already carries /v1', () => {
    expect(moonshotBalanceEndpoint('https://api.moonshot.ai/v1')).toBe('https://api.moonshot.ai/v1/users/me/balance')
    expect(moonshotBalanceEndpoint('https://host/gateway')).toBe('https://host/v1/users/me/balance')
  })

  it('keeps a non-default port on the same origin', () => {
    expect(moonshotBalanceEndpoint('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/v1/users/me/balance')
  })

  it('refuses a base URL that is not http(s)', () => {
    expect(moonshotBalanceEndpoint('file:///etc/passwd')).toBeNull()
    expect(moonshotBalanceEndpoint('ftp://host')).toBeNull()
    expect(moonshotBalanceEndpoint('not a url')).toBeNull()
    expect(moonshotBalanceEndpoint('')).toBeNull()
  })
})

describe('parseMoonshotBalanceResponse', () => {
  it('accepts the documented body, whose amounts are numbers', () => {
    const parsed = parseMoonshotBalanceResponse(OK_BODY)
    expect(parsed?.data.available_balance).toBe(49.58894)
    expect(parsed?.data.voucher_balance).toBe(46.58893)
    expect(parsed?.data.cash_balance).toBe(3.00001)
    expect(parsed?.status).toBe(true)
  })

  it('accepts a negative cash_balance — the docs allow an outstanding-amount reading', () => {
    const negative = { ...OK_BODY, data: { ...OK_BODY.data, cash_balance: -1.5 } }
    expect(parseMoonshotBalanceResponse(negative)?.data.cash_balance).toBe(-1.5)
  })

  it('rejects a body whose amounts are strings rather than numbers', () => {
    const stringy = { code: 0, data: { available_balance: '49.58894', voucher_balance: '0', cash_balance: '0' }, scode: '0x0', status: true }
    expect(parseMoonshotBalanceResponse(stringy)).toBeNull()
  })

  it('rejects a missing field, a missing data object, and a non-object', () => {
    expect(parseMoonshotBalanceResponse({ data: OK_BODY.data, scode: '0x0', status: true })).toBeNull()
    expect(parseMoonshotBalanceResponse({ code: 0, scode: '0x0', status: true })).toBeNull()
    expect(parseMoonshotBalanceResponse({ code: 0, data: OK_BODY.data, status: true })).toBeNull()
    expect(parseMoonshotBalanceResponse({ code: 0, data: OK_BODY.data, scode: '0x0' })).toBeNull()
    expect(parseMoonshotBalanceResponse('<html>404</html>')).toBeNull()
    expect(parseMoonshotBalanceResponse(null)).toBeNull()
  })
})

describe('readMoonshotBalance', () => {
  it('maps available_balance/voucher_balance/cash_balance to total/granted/toppedUp in the request\'s fixed currency', async () => {
    const result = await readMoonshotBalance(REQUEST, 1_000, jsonFetch(OK_BODY))
    expect(result).toEqual({
      state: 'ok',
      currency: 'USD',
      total: '49.58894',
      granted: '46.58893',
      toppedUp: '3.00001',
      isAvailable: true,
      fetchedAt: 1_000,
      stale: false,
    })
  })

  it('tags the China route\'s fixed currency the same way, independent of the response', async () => {
    const cnRequest: MoonshotBalanceRequest = { ...REQUEST, endpoint: 'https://api.moonshot.cn/v1/users/me/balance', currency: 'CNY' }
    const result = await readMoonshotBalance(cnRequest, 1_000, jsonFetch(OK_BODY))
    expect(result).toMatchObject({ state: 'ok', currency: 'CNY' })
  })

  it('sends the key as a bearer header and never in the URL', async () => {
    const fetchImpl = jsonFetch(OK_BODY)
    await readMoonshotBalance(REQUEST, 0, fetchImpl)
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('https://api.moonshot.ai/v1/users/me/balance')
    expect(url).not.toContain('sk-test')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('reports isAvailable false when the envelope\'s own status flag is false', async () => {
    const suspended = { ...OK_BODY, status: false }
    expect((await readMoonshotBalance(REQUEST, 5, jsonFetch(suspended)) as { isAvailable: boolean }).isAvailable).toBe(false)
  })

  it('maps an error status to an http failure carrying the status — 401/403 with a credential resolve to unavailable, not unconfigured', async () => {
    expect(await readMoonshotBalance(REQUEST, 5, jsonFetch({}, 401)))
      .toEqual({ state: 'unavailable', reason: 'http', status: 401, fetchedAt: 5 })
    expect(await readMoonshotBalance(REQUEST, 5, jsonFetch({}, 403)))
      .toEqual({ state: 'unavailable', reason: 'http', status: 403, fetchedAt: 5 })
  })

  it('maps a transport failure to a network failure with no status', async () => {
    const failing = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof globalThis.fetch
    expect(await readMoonshotBalance(REQUEST, 5, failing))
      .toEqual({ state: 'unavailable', reason: 'network', fetchedAt: 5 })
  })

  it('maps an aborted request to a timeout', async () => {
    const aborted = (() => {
      const error = new Error('timed out')
      error.name = 'TimeoutError'
      return Promise.reject(error)
    }) as unknown as typeof globalThis.fetch
    expect(await readMoonshotBalance(REQUEST, 5, aborted))
      .toEqual({ state: 'unavailable', reason: 'timeout', fetchedAt: 5 })
  })

  it('maps a non-JSON body and a JSON body missing its fields to the same malformed failure', async () => {
    const html = (() => Promise.resolve(new Response('<html>nope</html>', { status: 200 }))) as unknown as typeof globalThis.fetch
    expect(await readMoonshotBalance(REQUEST, 5, html)).toEqual({ state: 'unavailable', reason: 'malformed', fetchedAt: 5 })
    expect(await readMoonshotBalance(REQUEST, 5, jsonFetch({ ok: true })))
      .toEqual({ state: 'unavailable', reason: 'malformed', fetchedAt: 5 })
  })
})
