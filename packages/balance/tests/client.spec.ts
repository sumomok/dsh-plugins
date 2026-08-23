import { describe, expect, it, vi } from 'vitest'
import { parseBalanceView, parseSpendView } from '../src/client/contribution.ts'
import { currencySymbol, fill, formatAmount, formatSpend, tintOf } from '../src/client/format.ts'
import { createBalanceStore } from '../src/client/store.ts'
import { en, zh } from '../src/client/locales.ts'
import type { BalanceUiConfig, BalanceView, SpendView } from '../src/types.ts'

const UI: BalanceUiConfig = {
  footer: true,
  sessionSpend: true,
  lowBalance: 10,
  criticalBalance: 1,
  refreshMs: 60_000,
}

function ok(total: string, isAvailable = true): Extract<BalanceView, { state: 'ok' }> {
  return {
    state: 'ok',
    currency: 'CNY',
    total,
    granted: '0',
    toppedUp: total,
    isAvailable,
    fetchedAt: 1_000,
    stale: false,
  }
}

const SPEND: SpendView = {
  today: { cost: 1, bySchedule: { peak: 1 }, requests: 1, unpricedTokens: 0 },
  month: { cost: 2, bySchedule: { peak: 2 }, requests: 2, unpricedTokens: 0 },
  allTime: { cost: 3, bySchedule: { peak: 3 }, requests: 3, unpricedTokens: 5 },
  since: 1_000,
  currency: 'USD',
  pricesAsOf: '2026-08-23',
  timezone: 'UTC',
  ui: UI,
}

describe('formatting', () => {
  it('prefixes the currencies the shipped tables use with their symbol', () => {
    expect(currencySymbol('CNY')).toBe('¥')
    expect(currencySymbol('USD')).toBe('$')
  })

  it('falls back to the code for a currency it has no symbol for', () => {
    expect(currencySymbol('SEK')).toBe('SEK ')
    expect(formatAmount('SEK', '12.3')).toBe('SEK 12.30')
  })

  it('renders the provider decimal string at two places', () => {
    expect(formatAmount('CNY', '12.3456')).toBe('¥12.35')
    expect(formatAmount('CNY', '0')).toBe('¥0.00')
  })

  it('has nothing to render for an amount that is not a number', () => {
    expect(formatAmount('CNY', 'unknown')).toBeUndefined()
  })

  it('keeps a small-but-nonzero spend from reading as zero', () => {
    expect(formatSpend('USD', 0.0004)).toBe('$0.0004')
    expect(formatSpend('USD', 0)).toBe('$0.00')
    expect(formatSpend('USD', 1.239)).toBe('$1.24')
  })

  it('fills placeholders and leaves an unknown one alone', () => {
    expect(fill('a {x} b', { x: '1' })).toBe('a 1 b')
    expect(fill('a {y} b', { x: '1' })).toBe('a {y} b')
  })
})

describe('tintOf', () => {
  it('is normal above the warning threshold', () => {
    expect(tintOf(ok('10'), UI)).toBe('normal')
    expect(tintOf(ok('10.01'), UI)).toBe('normal')
  })

  it('warns below the warning threshold', () => {
    expect(tintOf(ok('9.99'), UI)).toBe('warning')
    expect(tintOf(ok('1'), UI)).toBe('warning')
  })

  it('is critical below the critical threshold', () => {
    expect(tintOf(ok('0.99'), UI)).toBe('critical')
    expect(tintOf(ok('0'), UI)).toBe('critical')
  })

  it('is critical for a suspended account whatever the number says', () => {
    expect(tintOf(ok('1000', false), UI)).toBe('critical')
  })

  it('does not tint a total it cannot read as a number', () => {
    expect(tintOf(ok('n/a'), UI)).toBe('normal')
  })
})

describe('the consumer codecs', () => {
  it('accepts each state the host can send', () => {
    expect(parseBalanceView({ state: 'unconfigured' })).toEqual({ state: 'unconfigured' })
    expect(parseBalanceView(ok('1'))).toEqual(ok('1'))
    expect(parseBalanceView({ state: 'unavailable', reason: 'http', status: 404, fetchedAt: 1 }))
      .toEqual({ state: 'unavailable', reason: 'http', status: 404, fetchedAt: 1 })
    expect(parseBalanceView({ state: 'unavailable', reason: 'network', fetchedAt: 1 }))
      .toEqual({ state: 'unavailable', reason: 'network', fetchedAt: 1 })
  })

  it('rejects an unknown state and an unknown failure reason', () => {
    expect(() => parseBalanceView({ state: 'other' })).toThrow(/balance.state/)
    expect(() => parseBalanceView({ state: 'unavailable', reason: 'teapot', fetchedAt: 1 }))
      .toThrow(/balance.reason/)
  })

  it('rejects a wrongly typed field rather than rendering it', () => {
    expect(() => parseBalanceView({ ...ok('1'), total: 1 })).toThrow(/balance.total/)
    expect(() => parseBalanceView(null)).toThrow(/balance/)
  })

  it('round-trips a spend read, its schedule split, and its surface toggles', () => {
    expect(parseSpendView(JSON.parse(JSON.stringify(SPEND)))).toEqual(SPEND)
  })

  it('accepts an empty ledger, whose since is null', () => {
    const empty = { ...SPEND, since: null }
    expect(parseSpendView(JSON.parse(JSON.stringify(empty))).since).toBeNull()
  })

  it('rejects a spend read missing its display facts', () => {
    const noUi = { ...SPEND, ui: undefined }
    expect(() => parseSpendView(noUi)).toThrow(/spend.ui/)
  })
})

describe('the browser store', () => {
  const api = () => ({
    get: vi.fn(async () => ok('12.34')),
    spend: vi.fn(async () => SPEND),
  })

  it('starts empty and publishes both faces after one refresh', async () => {
    const calls = api()
    const store = createBalanceStore(calls, () => undefined)
    expect(store.getSnapshot()).toEqual({ balance: undefined, spend: undefined, loading: false })
    await store.refresh()
    expect(store.getSnapshot().balance).toEqual(ok('12.34'))
    expect(store.getSnapshot().spend).toEqual(SPEND)
    expect(store.getSnapshot().loading).toBe(false)
  })

  it('notifies subscribers and stops after the disposer', async () => {
    const store = createBalanceStore(api(), () => undefined)
    let seen = 0
    const stop = store.subscribe(() => { seen += 1 })
    await store.refresh()
    expect(seen).toBeGreaterThan(0)
    const after = seen
    stop()
    await store.refresh(true)
    expect(seen).toBe(after)
  })

  it('shares one unforced refresh between concurrent callers', async () => {
    const calls = api()
    const store = createBalanceStore(calls, () => undefined)
    await Promise.all([store.refresh(), store.refresh()])
    expect(calls.get).toHaveBeenCalledTimes(1)
  })

  it('runs a forced refresh even while one is in flight', async () => {
    const calls = api()
    const store = createBalanceStore(calls, () => undefined)
    await Promise.all([store.refresh(), store.refresh(true)])
    expect(calls.get).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good numbers when a read fails, and reports the failure once', async () => {
    const calls = api()
    const store = createBalanceStore(calls, errors)
    const seen: unknown[] = []
    function errors(error: unknown): void { seen.push(error) }
    await store.refresh()
    calls.get.mockRejectedValueOnce(new Error('offline') as never)
    await store.refresh(true)
    expect(store.getSnapshot().balance).toEqual(ok('12.34'))
    expect(store.getSnapshot().loading).toBe(false)
    expect(seen).toHaveLength(1)
  })
})

describe('the dictionaries', () => {
  it('carry the same keys in both locales', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('leave no key empty', () => {
    for (const dict of [zh, en]) {
      for (const [key, value] of Object.entries(dict)) expect(value, key).not.toBe('')
    }
  })

  it('use the same placeholders in both locales', () => {
    const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort()
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]))
    }
  })

  it('name both the price currency and its date in the prices line', () => {
    for (const dict of [zh, en]) {
      expect(dict['spend.pricesAsOf']).toContain('{currency}')
      expect(dict['spend.pricesAsOf']).toContain('{date}')
    }
  })

  it('leave no placeholder in a key rendered as a bare label', () => {
    // The popover renders these three as the label column and the amount as the
    // value column, so a `{amount}` here would reach the screen as literal text.
    for (const key of ['total', 'granted', 'toppedUp', 'spend.today', 'spend.month', 'spend.allTime'] as const) {
      for (const dict of [zh, en]) expect(dict[key], key).not.toMatch(/\{\w+\}/)
    }
  })

  it('name every failure reason the host can report', () => {
    for (const reason of ['http', 'network', 'timeout', 'malformed'] as const) {
      expect(en[`reason.${reason}`]).toBeTruthy()
    }
  })
})
