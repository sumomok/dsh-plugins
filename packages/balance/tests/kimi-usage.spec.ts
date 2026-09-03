import { describe, expect, it, vi } from 'vitest'
import {
  parseKimiUsage, readKimiUsage, resetsAtOf, usedPercentOf,
} from '../src/kimi-usage.ts'
import type { KimiUsageRequest } from '../src/kimi-usage.ts'

const USAGE_BODY = {
  usage: { used: 42, limit: 100, remaining: 58, resetTime: '2026-09-07T00:00:00.000Z' },
  limits: [
    { window: { duration: 5, timeUnit: 'hour' }, detail: { used: 3, limit: 20, remaining: 17, resetTime: 1_788_000_000 } },
  ],
}

const REQUEST: KimiUsageRequest = {
  endpoint: 'https://api.kimi.com/coding/v1/usages',
  fallbackEndpoint: 'https://api.kimi.com/coding/v1/usage',
  apiKey: 'sk-kimi-test',
  userAgent: 'KimiCLI/1.6',
  timeoutMs: 1_000,
}

/** A fetch that answers one JSON body. */
function jsonFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof globalThis.fetch
}

/** A fetch that answers each queued outcome once, in order, repeating the last. */
function sequenceFetch(outcomes: { status?: number; body?: unknown; raw?: string; throw?: Error }[]): typeof globalThis.fetch {
  let call = 0
  return vi.fn(async () => {
    const outcome = outcomes[Math.min(call, outcomes.length - 1)]!
    call += 1
    if (outcome.throw !== undefined) throw outcome.throw
    const body = outcome.raw ?? (outcome.body === undefined ? '' : JSON.stringify(outcome.body))
    return new Response(body, { status: outcome.status ?? 200 })
  }) as unknown as typeof globalThis.fetch
}

describe('usedPercentOf', () => {
  it('reads used against limit', () => {
    expect(usedPercentOf({ used: 42, limit: 100 })).toBe(42)
  })

  it('falls back to limit minus remaining when used is absent', () => {
    expect(usedPercentOf({ limit: 100, remaining: 30 })).toBe(70)
  })

  it('prefers used over remaining when both are present', () => {
    expect(usedPercentOf({ used: 10, limit: 100, remaining: 999 })).toBe(10)
  })

  it('reads counts the endpoint encodes as decimal strings (protobuf-JSON int64)', () => {
    // The live endpoint's own encoding, observed 2026-09-02: every count a string.
    expect(usedPercentOf({ limit: '100', used: '12', remaining: '88' })).toBe(12)
    expect(usedPercentOf({ limit: '100', remaining: '64' })).toBe(36)
    expect(usedPercentOf({ limit: '100', used: '', remaining: '' })).toBeNull()
  })

  it('clamps an over-limit reading to 100 and an over-full remaining to 0', () => {
    expect(usedPercentOf({ used: 150, limit: 100 })).toBe(100)
    expect(usedPercentOf({ limit: 100, remaining: 150 })).toBe(0)
  })

  it('returns null with no positive limit, and null with no usable used or remaining', () => {
    expect(usedPercentOf({ used: 10, limit: 0 })).toBeNull()
    expect(usedPercentOf({ used: 10 })).toBeNull()
    expect(usedPercentOf({ limit: 100 })).toBeNull()
    expect(usedPercentOf({ limit: 100, used: 'x', remaining: 'y' })).toBeNull()
  })
})

describe('resetsAtOf', () => {
  it('reads an ISO string', () => {
    expect(resetsAtOf('2026-09-07T00:00:00.000Z')).toBe(Date.parse('2026-09-07T00:00:00.000Z'))
  })

  it('scales epoch seconds to milliseconds and leaves epoch milliseconds alone', () => {
    expect(resetsAtOf(1_788_000_000)).toBe(1_788_000_000_000)
    expect(resetsAtOf(1_788_000_000_000)).toBe(1_788_000_000_000)
  })

  it('returns null for an unparseable string, a boolean, and an absent value', () => {
    expect(resetsAtOf('not-a-date')).toBeNull()
    expect(resetsAtOf(true)).toBeNull()
    expect(resetsAtOf(undefined)).toBeNull()
    expect(resetsAtOf(Number.NaN)).toBeNull()
  })
})

describe('parseKimiUsage', () => {
  it('reads a body whose counts are all strings', () => {
    const body = {
      usage: { limit: '100', used: '12', remaining: '88', resetTime: '2026-09-07T00:21:48.181689Z' },
      limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: '36', remaining: '64', resetTime: '2026-09-02T11:21:48.181689Z' } }],
    }
    expect(parseKimiUsage(body)).toEqual([
      { key: '5h', usedPercent: 36, resetsAt: Date.parse('2026-09-02T11:21:48.181689Z') },
      { key: 'weekly', usedPercent: 12, resetsAt: Date.parse('2026-09-07T00:21:48.181689Z') },
    ])
  })

  it('reads each rolling window from limits first, then the weekly window from the top-level usage', () => {
    // The shorter window runs out first, so it is listed first.
    expect(parseKimiUsage(USAGE_BODY)).toEqual([
      { key: '5h', usedPercent: 15, resetsAt: 1_788_000_000_000 },
      { key: 'weekly', usedPercent: 42, resetsAt: Date.parse('2026-09-07T00:00:00.000Z') },
    ])
  })

  it('names a rolling window by its own span, and reads the reset from any of the three field names', () => {
    const body = {
      limits: [
        { window: { duration: 1, timeUnit: 'day' }, detail: { used: 1, limit: 4, reset_at: '2026-09-02T00:00:00.000Z' } },
        { window: { duration: 2, timeUnit: 'week' }, detail: { used: 1, limit: 4, resetsAt: 1_788_000_000_000 } },
        { window: { duration: 30, timeUnit: 'minute' }, detail: { used: 1, limit: 4 } },
        { window: { duration: 1, timeUnit: 'month' }, detail: { used: 1, limit: 4 } },
      ],
    }
    expect(parseKimiUsage(body)?.map(window => window.key)).toEqual(['1d', '2w', '30m', '1mo'])
    expect(parseKimiUsage(body)?.[0]?.resetsAt).toBe(Date.parse('2026-09-02T00:00:00.000Z'))
    expect(parseKimiUsage(body)?.[1]?.resetsAt).toBe(1_788_000_000_000)
    expect(parseKimiUsage(body)?.[2]?.resetsAt).toBeNull()
  })

  it('names a window whose span it cannot read by its position', () => {
    const body = {
      limits: [
        { window: { duration: 0, timeUnit: 'hour' }, detail: { used: 1, limit: 4 } },
        { window: { timeUnit: 'lightyear' }, detail: { used: 1, limit: 4 } },
        { detail: { used: 1, limit: 4 } },
      ],
    }
    expect(parseKimiUsage(body)?.map(window => window.key)).toEqual(['window1', 'window2', 'window3'])
  })

  it('reads a weekly-only body', () => {
    expect(parseKimiUsage({ usage: { used: 5, limit: 10 } })).toEqual([
      { key: 'weekly', usedPercent: 50, resetsAt: null },
    ])
  })

  it('skips a window with no usable allowance and a non-object row or detail', () => {
    const body = {
      usage: { limit: 0 },
      limits: [
        null,
        'nope',
        { detail: null },
        { detail: [] },
        { window: { duration: 5, timeUnit: 'hour' }, detail: { limit: 0 } },
        { window: { duration: 1, timeUnit: 'hour' }, detail: { used: 1, limit: 2 } },
      ],
    }
    expect(parseKimiUsage(body)).toEqual([{ key: '1h', usedPercent: 50, resetsAt: null }])
  })

  it('returns null when nothing usable is present, and for a non-object body', () => {
    expect(parseKimiUsage({ usage: { limit: 0 }, limits: [] })).toBeNull()
    expect(parseKimiUsage({ usage: 'x', limits: 'y' })).toBeNull()
    expect(parseKimiUsage(null)).toBeNull()
    expect(parseKimiUsage('<html>')).toBeNull()
  })
})

describe('readKimiUsage', () => {
  it('reads the quota windows and derives availability from every window', async () => {
    const result = await readKimiUsage(REQUEST, 1_000, jsonFetch(USAGE_BODY))
    expect(result).toEqual({
      state: 'quota',
      windows: [
        { key: '5h', usedPercent: 15, resetsAt: 1_788_000_000_000 },
        { key: 'weekly', usedPercent: 42, resetsAt: Date.parse('2026-09-07T00:00:00.000Z') },
      ],
      isAvailable: true,
      fetchedAt: 1_000,
      stale: false,
    })
  })

  it('reports the account cannot serve when any window is fully consumed', async () => {
    const weeklyOut = { usage: { used: 100, limit: 100 } }
    expect((await readKimiUsage(REQUEST, 5, jsonFetch(weeklyOut)) as { isAvailable: boolean }).isAvailable).toBe(false)
    const rollingOut = { usage: { used: 10, limit: 100 }, limits: [{ window: { duration: 5, timeUnit: 'hour' }, detail: { used: 100, limit: 100 } }] }
    expect((await readKimiUsage(REQUEST, 5, jsonFetch(rollingOut)) as { isAvailable: boolean }).isAvailable).toBe(false)
  })

  it('falls back to the singular endpoint when the first answers 404', async () => {
    const fetchImpl = sequenceFetch([{ status: 404 }, { body: USAGE_BODY }])
    const result = await readKimiUsage(REQUEST, 5, fetchImpl)
    expect(result).toMatchObject({ state: 'quota' })
    const calls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls
    expect(calls[0]![0]).toBe('https://api.kimi.com/coding/v1/usages')
    expect(calls[1]![0]).toBe('https://api.kimi.com/coding/v1/usage')
  })

  it('reports the 404 status when the fallback endpoint is also absent', async () => {
    expect(await readKimiUsage(REQUEST, 5, sequenceFetch([{ status: 404 }, { status: 404 }])))
      .toEqual({ state: 'unavailable', reason: 'http', status: 404, fetchedAt: 5 })
  })

  it('maps a non-404 error status to an http failure carrying the status', async () => {
    expect(await readKimiUsage(REQUEST, 5, jsonFetch({}, 401)))
      .toEqual({ state: 'unavailable', reason: 'http', status: 401, fetchedAt: 5 })
  })

  it('sends the subscription key as a bearer, the CLI user agent, and never the key in the URL', async () => {
    const fetchImpl = jsonFetch(USAGE_BODY)
    await readKimiUsage(REQUEST, 0, fetchImpl)
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('https://api.kimi.com/coding/v1/usages')
    expect(url).not.toContain('sk-kimi-test')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-kimi-test')
    expect(headers['User-Agent']).toBe('KimiCLI/1.6')
  })

  it('maps a transport failure to a network failure and an abort to a timeout', async () => {
    const failing = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof globalThis.fetch
    expect(await readKimiUsage(REQUEST, 5, failing)).toEqual({ state: 'unavailable', reason: 'network', fetchedAt: 5 })
    const aborted = (() => {
      const error = new Error('timed out')
      error.name = 'TimeoutError'
      return Promise.reject(error)
    }) as unknown as typeof globalThis.fetch
    expect(await readKimiUsage(REQUEST, 5, aborted)).toEqual({ state: 'unavailable', reason: 'timeout', fetchedAt: 5 })
  })

  it('maps a non-JSON body and a JSON body with no readable window to the same malformed failure', async () => {
    const html = sequenceFetch([{ raw: '<html>nope</html>' }])
    expect(await readKimiUsage(REQUEST, 5, html)).toEqual({ state: 'unavailable', reason: 'malformed', fetchedAt: 5 })
    expect(await readKimiUsage(REQUEST, 5, jsonFetch({ usage: { limit: 0 }, limits: [] })))
      .toEqual({ state: 'unavailable', reason: 'malformed', fetchedAt: 5 })
  })

  it('maps a fallback-attempt transport failure to a network failure', async () => {
    // The first endpoint answers 404, and the fallback attempt then throws.
    const fetchImpl = sequenceFetch([{ status: 404 }, { throw: new Error('ECONNRESET') }])
    expect(await readKimiUsage(REQUEST, 5, fetchImpl)).toEqual({ state: 'unavailable', reason: 'network', fetchedAt: 5 })
  })
})
