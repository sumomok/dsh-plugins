import { describe, expect, it, vi } from 'vitest'
import {
  balanceEndpoint, BalanceReader, parseAmount, parseBalanceResponse, readBalance, selectBalance,
} from '../src/balance.ts'
import type { BalanceRequest } from '../src/balance.ts'

const OK_BODY = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '12.34', granted_balance: '2.00', topped_up_balance: '10.34' },
    { currency: 'USD', total_balance: '1.70', granted_balance: '0.30', topped_up_balance: '1.40' },
  ],
}

const REQUEST: BalanceRequest = {
  endpoint: 'https://api.deepseek.com/user/balance',
  apiKey: 'sk-test',
  currency: ['CNY', 'USD'],
  timeoutMs: 1_000,
}

/** A fetch that answers one JSON body. */
function jsonFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof globalThis.fetch
}

describe('balanceEndpoint', () => {
  it('appends the account path to a base URL that carries no version segment', () => {
    expect(balanceEndpoint('https://api.deepseek.com')).toBe('https://api.deepseek.com/user/balance')
  })

  it('strips exactly one trailing version segment', () => {
    expect(balanceEndpoint('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/user/balance')
    expect(balanceEndpoint('https://api.deepseek.com/v42')).toBe('https://api.deepseek.com/user/balance')
    expect(balanceEndpoint('https://host/api/v1')).toBe('https://host/api/user/balance')
  })

  it('ignores a trailing slash', () => {
    expect(balanceEndpoint('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/user/balance')
    expect(balanceEndpoint('https://api.deepseek.com///')).toBe('https://api.deepseek.com/user/balance')
  })

  it('leaves a path that is not a version segment alone', () => {
    expect(balanceEndpoint('https://host/gateway')).toBe('https://host/gateway/user/balance')
  })

  it('keeps a non-default port on the same origin', () => {
    expect(balanceEndpoint('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080/user/balance')
  })

  it('refuses a base URL that is not http(s), so nothing is fetched off the provider plane', () => {
    expect(balanceEndpoint('file:///etc/passwd')).toBeNull()
    expect(balanceEndpoint('ftp://host/v1')).toBeNull()
    expect(balanceEndpoint('not a url')).toBeNull()
    expect(balanceEndpoint('')).toBeNull()
  })
})

describe('selectBalance', () => {
  it('takes the first row matching the preference, in preference order', () => {
    expect(selectBalance(OK_BODY.balance_infos, ['USD', 'CNY'])?.currency).toBe('USD')
    expect(selectBalance(OK_BODY.balance_infos, ['CNY', 'USD'])?.currency).toBe('CNY')
  })

  it('falls back to the first row when no preference matches', () => {
    expect(selectBalance(OK_BODY.balance_infos, ['EUR'])?.currency).toBe('CNY')
  })

  it('has nothing to select from an empty list', () => {
    expect(selectBalance([], ['CNY'])).toBeUndefined()
  })
})

describe('parseBalanceResponse', () => {
  it('accepts the documented body, whose amounts are strings', () => {
    const parsed = parseBalanceResponse(OK_BODY)
    expect(parsed?.is_available).toBe(true)
    expect(parsed?.balance_infos[0]?.total_balance).toBe('12.34')
  })

  it('rejects a body whose amounts are numbers rather than strings', () => {
    const numeric = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: 12.34, granted_balance: '0', topped_up_balance: '0' }] }
    expect(parseBalanceResponse(numeric)).toBeNull()
  })

  it('rejects a missing field, a missing list, and a non-object', () => {
    expect(parseBalanceResponse({ balance_infos: [] })).toBeNull()
    expect(parseBalanceResponse({ is_available: true })).toBeNull()
    expect(parseBalanceResponse('<html>404</html>')).toBeNull()
    expect(parseBalanceResponse(null)).toBeNull()
  })

  it('accepts an account with no balance rows, which the caller then reports as unreadable', () => {
    expect(parseBalanceResponse({ is_available: false, balance_infos: [] })?.balance_infos).toEqual([])
  })
})

describe('parseAmount', () => {
  it('reads a decimal string', () => {
    expect(parseAmount('12.34')).toBe(12.34)
    expect(parseAmount(' 0 ')).toBe(0)
    expect(parseAmount('-1.5')).toBe(-1.5)
  })

  it('refuses anything that is not a plain decimal', () => {
    expect(parseAmount('1e3')).toBeNull()
    expect(parseAmount('twelve')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
})

describe('readBalance', () => {
  it('reports the selected row and the provider availability verdict', async () => {
    const result = await readBalance(REQUEST, 1_000, jsonFetch(OK_BODY))
    expect(result).toEqual({
      state: 'ok',
      currency: 'CNY',
      total: '12.34',
      granted: '2.00',
      toppedUp: '10.34',
      isAvailable: true,
      fetchedAt: 1_000,
      stale: false,
    })
  })

  it('sends the key as a bearer header and never in the URL', async () => {
    const fetchImpl = jsonFetch(OK_BODY)
    await readBalance(REQUEST, 0, fetchImpl)
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('https://api.deepseek.com/user/balance')
    expect(url).not.toContain('sk-test')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('maps an error status to an http failure carrying the status', async () => {
    expect(await readBalance(REQUEST, 5, jsonFetch({}, 404)))
      .toEqual({ state: 'unavailable', reason: 'http', status: 404, fetchedAt: 5 })
  })

  it('maps a transport failure to a network failure with no status', async () => {
    const failing = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof globalThis.fetch
    expect(await readBalance(REQUEST, 5, failing))
      .toEqual({ state: 'unavailable', reason: 'network', fetchedAt: 5 })
  })

  it('maps an aborted request to a timeout', async () => {
    const aborted = (() => {
      const error = new Error('timed out')
      error.name = 'TimeoutError'
      return Promise.reject(error)
    }) as unknown as typeof globalThis.fetch
    expect(await readBalance(REQUEST, 5, aborted))
      .toEqual({ state: 'unavailable', reason: 'timeout', fetchedAt: 5 })
  })

  it('maps a non-JSON body and a JSON body missing its fields to the same malformed failure', async () => {
    const html = (() => Promise.resolve(new Response('<html>nope</html>', { status: 200 }))) as unknown as typeof globalThis.fetch
    expect(await readBalance(REQUEST, 5, html)).toEqual({ state: 'unavailable', reason: 'malformed', fetchedAt: 5 })
    expect(await readBalance(REQUEST, 5, jsonFetch({ ok: true })))
      .toEqual({ state: 'unavailable', reason: 'malformed', fetchedAt: 5 })
  })

  it('reports an account with no balance rows as malformed rather than as zero', async () => {
    expect(await readBalance(REQUEST, 5, jsonFetch({ is_available: true, balance_infos: [] })))
      .toEqual({ state: 'unavailable', reason: 'malformed', fetchedAt: 5 })
  })
})

describe('BalanceReader', () => {
  /** A reader over a fake clock and a counted fetch. */
  function reader(options: {
    resolve?: () => Promise<BalanceRequest | null>
    fetch?: typeof globalThis.fetch
    refreshMs?: number
    retryMs?: number
  } = {}) {
    let now = 1_000
    const calls = { count: 0 }
    const counted: typeof globalThis.fetch = async (...args) => {
      calls.count += 1
      return (options.fetch ?? jsonFetch(OK_BODY))(...args)
    }
    const instance = new BalanceReader({
      resolve: options.resolve ?? (() => Promise.resolve(REQUEST)),
      now: () => now,
      refreshMs: options.refreshMs ?? 60_000,
      retryMs: options.retryMs ?? 15_000,
      fetch: counted,
    })
    return { instance, calls, advance: (ms: number) => { now += ms } }
  }

  it('serves a successful read from cache inside the refresh window', async () => {
    const { instance, calls, advance } = reader()
    await instance.get()
    advance(30_000)
    await instance.get()
    expect(calls.count).toBe(1)
  })

  it('reads again once the refresh window has passed', async () => {
    const { instance, calls, advance } = reader()
    await instance.get()
    advance(60_000)
    await instance.get()
    expect(calls.count).toBe(2)
  })

  it('shares one in-flight request between concurrent callers', async () => {
    const { instance, calls } = reader()
    const [first, second] = await Promise.all([instance.get(), instance.get()])
    expect(calls.count).toBe(1)
    expect(first).toEqual(second)
  })

  it('joins an in-flight request even when forced', async () => {
    const { instance, calls } = reader()
    await Promise.all([instance.get(), instance.get(true)])
    expect(calls.count).toBe(1)
  })

  it('bypasses the refresh window when forced', async () => {
    const { instance, calls } = reader()
    await instance.get()
    await instance.get(true)
    expect(calls.count).toBe(2)
  })

  it('suppresses attempts for the retry window after a failure', async () => {
    const failing = (() => Promise.reject(new Error('down'))) as unknown as typeof globalThis.fetch
    const { instance, calls, advance } = reader({ fetch: failing })
    expect((await instance.get()).state).toBe('unavailable')
    advance(5_000)
    await instance.get()
    expect(calls.count).toBe(1)
    advance(10_000)
    await instance.get()
    expect(calls.count).toBe(2)
  })

  it('keeps the last good numbers and marks them stale when a refresh fails', async () => {
    let healthy = true
    const flaky: typeof globalThis.fetch = async (...args) => {
      if (!healthy) throw new Error('down')
      return jsonFetch(OK_BODY)(...args)
    }
    const { instance, advance } = reader({ fetch: flaky })
    const first = await instance.get()
    expect(first).toMatchObject({ state: 'ok', stale: false, fetchedAt: 1_000 })
    healthy = false
    advance(60_000)
    const second = await instance.get()
    expect(second).toMatchObject({ state: 'ok', stale: true, total: '12.34', fetchedAt: 1_000 })
  })

  it('keeps serving the stale value for the whole retry window', async () => {
    let healthy = true
    const flaky: typeof globalThis.fetch = async (...args) => {
      if (!healthy) throw new Error('down')
      return jsonFetch(OK_BODY)(...args)
    }
    const { instance, calls, advance } = reader({ fetch: flaky })
    await instance.get()
    healthy = false
    advance(60_000)
    await instance.get()
    expect(calls.count).toBe(2)
    advance(1_000)
    expect(await instance.get()).toMatchObject({ state: 'ok', stale: true })
    expect(calls.count).toBe(2)
  })

  it('clears the stale mark once a refresh succeeds again', async () => {
    let healthy = true
    const flaky: typeof globalThis.fetch = async (...args) => {
      if (!healthy) throw new Error('down')
      return jsonFetch(OK_BODY)(...args)
    }
    const { instance, advance } = reader({ fetch: flaky })
    await instance.get()
    healthy = false
    advance(60_000)
    await instance.get()
    healthy = true
    advance(20_000)
    expect(await instance.get()).toMatchObject({ state: 'ok', stale: false })
  })

  it('answers unconfigured without a request, and without caching the verdict', async () => {
    let configured = false
    const { instance, calls } = reader({ resolve: () => Promise.resolve(configured ? REQUEST : null) })
    expect(await instance.get()).toEqual({ state: 'unconfigured' })
    expect(calls.count).toBe(0)
    configured = true
    expect((await instance.get()).state).toBe('ok')
  })
})
