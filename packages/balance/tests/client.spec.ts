import { describe, expect, it, vi } from 'vitest'
import { parseBalanceView, parseProviderOptions, parseSpendView } from '../src/client/contribution.ts'
import { currencySymbol, fill, formatAmount, formatResetAt, formatSpend, remainingPercent, tintOf, windowSpan } from '../src/client/format.ts'
import { createBalanceStore } from '../src/client/store.ts'
import { en, zh } from '../src/client/locales.ts'
import type { BalanceUiConfig, BalanceView, ProviderOption, SpendView } from '../src/types.ts'

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
  provider: 'deepseek-official',
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

  it('turns a used percent into the whole-number percent remaining, clamped', () => {
    expect(remainingPercent(42)).toBe(58)
    expect(remainingPercent(4.6)).toBe(95)
    expect(remainingPercent(0)).toBe(100)
    expect(remainingPercent(100)).toBe(0)
    expect(remainingPercent(150)).toBe(0)
  })

  it('reads a rolling window key as a span, and the weekly key as none', () => {
    expect(windowSpan('5h')).toEqual({ n: 5, unit: 'hours' })
    expect(windowSpan('7d')).toEqual({ n: 7, unit: 'days' })
    expect(windowSpan('1mo')).toEqual({ n: 1, unit: 'months' })
    expect(windowSpan('30m')).toEqual({ n: 30, unit: 'minutes' })
    expect(windowSpan('weekly')).toBeNull()
    expect(windowSpan('window1')).toBeNull()
  })

  it('shows a reset within the day as a time and a later one with its date', () => {
    const now = Date.UTC(2026, 8, 2, 8, 0)
    const soon = formatResetAt(now + 3 * 3_600_000, now)
    const later = formatResetAt(now + 5 * 86_400_000, now)
    expect(soon).not.toMatch(/\d+\/\d+/)
    expect(later).toMatch(/\d+\/\d+|\d+-\d+|月/)
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

  it('parses the provider roster', () => {
    expect(parseProviderOptions([{ id: 'deepseek-official', displayName: 'DeepSeek' }]))
      .toEqual([{ id: 'deepseek-official', displayName: 'DeepSeek' }])
  })

  it('rejects a roster that is not an array, or a row missing a field', () => {
    expect(() => parseProviderOptions({})).toThrow(/providers/)
    expect(() => parseProviderOptions([{ id: 'x' }])).toThrow(/displayName/)
  })
})

const PROVIDERS: ProviderOption[] = [
  { id: 'deepseek-official', displayName: 'DeepSeek' },
  { id: 'other', displayName: 'Other' },
]

describe('the browser store', () => {
  const api = () => ({
    get: vi.fn(async () => ok('12.34')),
    spend: vi.fn(async () => SPEND),
    providers: vi.fn(async () => PROVIDERS),
  })

  it('starts empty and publishes every face after one refresh', async () => {
    const calls = api()
    const store = createBalanceStore(calls, () => undefined)
    expect(store.getSnapshot()).toEqual({
      followedProvider: '',
      balance: undefined,
      spend: undefined,
      loading: false,
      providers: [],
      selectedProvider: undefined,
      preview: undefined,
      previewSpend: undefined,
      previewLoading: false,
    })
    await store.refresh('deepseek-official')
    expect(store.getSnapshot().followedProvider).toBe('deepseek-official')
    expect(store.getSnapshot().balance).toEqual(ok('12.34'))
    expect(store.getSnapshot().spend).toEqual(SPEND)
    expect(store.getSnapshot().providers).toEqual(PROVIDERS)
    expect(store.getSnapshot().preview).toEqual(ok('12.34'))
    expect(store.getSnapshot().previewSpend).toEqual(SPEND)
    expect(store.getSnapshot().loading).toBe(false)
    expect(calls.get).toHaveBeenCalledWith('deepseek-official', false)
    expect(calls.spend).toHaveBeenCalledWith('deepseek-official')
  })

  it('notifies subscribers and stops after the disposer', async () => {
    const store = createBalanceStore(api(), () => undefined)
    let seen = 0
    const stop = store.subscribe(() => { seen += 1 })
    await store.refresh('deepseek-official')
    expect(seen).toBeGreaterThan(0)
    const after = seen
    stop()
    await store.refresh('deepseek-official', true)
    expect(seen).toBe(after)
  })

  it('shares one unforced refresh for the same provider between concurrent callers', async () => {
    const calls = api()
    const store = createBalanceStore(calls, () => undefined)
    await Promise.all([store.refresh('deepseek-official'), store.refresh('deepseek-official')])
    expect(calls.get).toHaveBeenCalledTimes(1)
  })

  it('runs a forced refresh even while one is in flight', async () => {
    const calls = api()
    const store = createBalanceStore(calls, () => undefined)
    await Promise.all([store.refresh('deepseek-official'), store.refresh('deepseek-official', true)])
    expect(calls.get).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good numbers when a read fails, and reports the failure once', async () => {
    const calls = api()
    const store = createBalanceStore(calls, errors)
    const seen: unknown[] = []
    function errors(error: unknown): void { seen.push(error) }
    await store.refresh('deepseek-official')
    calls.get.mockRejectedValueOnce(new Error('offline') as never)
    await store.refresh('deepseek-official', true)
    expect(store.getSnapshot().balance).toEqual(ok('12.34'))
    expect(store.getSnapshot().loading).toBe(false)
    expect(seen).toHaveLength(1)
  })

  it('ignores a slower followed-provider read settling after a newer one has already landed', async () => {
    let resolveStale: ((view: BalanceView) => void) | undefined
    const calls = {
      get: vi.fn(async (provider: string | undefined): Promise<BalanceView> => {
        if (provider === 'mock-gateway') {
          return new Promise<BalanceView>((resolve) => { resolveStale = resolve })
        }
        return ok('37.04')
      }),
      spend: vi.fn(async () => SPEND),
      providers: vi.fn(async () => PROVIDERS),
    }
    const store = createBalanceStore(calls, () => undefined)
    // A switch to Mock Gateway starts a slow read, left in flight — resolved
    // manually below, after a quicker switch back to DeepSeek has landed.
    const stale = store.refresh('mock-gateway', true)
    await store.refresh('deepseek-official', true)
    expect(store.getSnapshot().followedProvider).toBe('deepseek-official')
    expect(store.getSnapshot().balance).toEqual(ok('37.04'))
    // The stale Mock Gateway read finally settles; it must not overwrite the
    // newer DeepSeek state that already landed.
    resolveStale?.({ state: 'ok', currency: 'USD', total: '4.69', isAvailable: true, fetchedAt: 1, stale: false })
    await stale
    expect(store.getSnapshot().followedProvider).toBe('deepseek-official')
    expect(store.getSnapshot().balance).toEqual(ok('37.04'))
  })
})

describe('the provider picker', () => {
  const api = () => ({
    get: vi.fn(async (provider: string | undefined) => (provider === 'other' ? { state: 'unconfigured' as const } : ok('12.34'))),
    spend: vi.fn(async () => SPEND),
    providers: vi.fn(async () => PROVIDERS),
  })

  it('mirrors the followed balance until a different provider is chosen', async () => {
    const store = createBalanceStore(api(), () => undefined)
    await store.refresh('deepseek-official')
    expect(store.getSnapshot().preview).toEqual(ok('12.34'))
    store.selectProvider('deepseek-official')
    expect(store.getSnapshot().selectedProvider).toBeUndefined()
  })

  it('reads and shows a different provider — its balance and its own spend — without disturbing the followed reads', async () => {
    const calls = api()
    const otherSpend: SpendView = { ...SPEND, provider: 'other', allTime: { cost: 0, bySchedule: {}, requests: 1, unpricedTokens: 9 } }
    calls.spend.mockImplementation(async (provider: string) => provider === 'other' ? otherSpend : SPEND)
    const store = createBalanceStore(calls, () => undefined)
    await store.refresh('deepseek-official')
    store.selectProvider('other')
    expect(store.getSnapshot().previewLoading).toBe(true)
    expect(store.getSnapshot().previewSpend).toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(store.getSnapshot().preview).toEqual({ state: 'unconfigured' })
    expect(store.getSnapshot().previewSpend).toEqual(otherSpend)
    expect(calls.spend).toHaveBeenCalledWith('other')
    expect(store.getSnapshot().balance).toEqual(ok('12.34'))
    expect(store.getSnapshot().spend).toEqual(SPEND)
    expect(store.getSnapshot().followedProvider).toBe('deepseek-official')
  })

  it('reverts to following when the picker names the followed provider again', async () => {
    const store = createBalanceStore(api(), () => undefined)
    await store.refresh('deepseek-official')
    store.selectProvider('other')
    store.selectProvider('deepseek-official')
    expect(store.getSnapshot().selectedProvider).toBeUndefined()
    expect(store.getSnapshot().preview).toEqual(ok('12.34'))
  })

  it('lets a session switch move the preview along once the picker has reverted to following', async () => {
    const store = createBalanceStore(api(), () => undefined)
    await store.refresh('deepseek-official')
    await store.refresh('other')
    expect(store.getSnapshot().preview).toEqual({ state: 'unconfigured' })
  })

  it('ignores a slower preview settling after the picker has moved on', async () => {
    let resolveFirst: (() => void) | undefined
    const calls = {
      get: vi.fn(async (provider: string | undefined) => {
        if (provider === 'other') {
          await new Promise<void>((resolve) => { resolveFirst = resolve })
          return { state: 'unconfigured' as const }
        }
        return ok('12.34')
      }),
      spend: vi.fn(async () => SPEND),
      providers: vi.fn(async () => PROVIDERS),
    }
    const store = createBalanceStore(calls, () => undefined)
    await store.refresh('deepseek-official')
    store.selectProvider('other')
    store.selectProvider('deepseek-official')
    resolveFirst?.()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(store.getSnapshot().selectedProvider).toBeUndefined()
    expect(store.getSnapshot().preview).toEqual(ok('12.34'))
  })
})

describe('the followed provider always appears in the roster', () => {
  it('is prepended, with its own id as a display name, when the host\'s filtered roster omits it', async () => {
    const calls = {
      get: vi.fn(async () => ok('12.34')),
      spend: vi.fn(async () => SPEND),
      // The host filters to configured/supported providers with no notion of
      // "followed" — here it happens to have excluded the one being followed.
      providers: vi.fn(async () => [{ id: 'other', displayName: 'Other' }]),
    }
    const store = createBalanceStore(calls, () => undefined)
    await store.refresh('deepseek-official')
    expect(store.getSnapshot().providers).toEqual([
      { id: 'deepseek-official', displayName: 'deepseek-official' },
      { id: 'other', displayName: 'Other' },
    ])
  })

  it('is left alone, not duplicated, when the host\'s roster already names it', async () => {
    const calls = {
      get: vi.fn(async () => ok('12.34')),
      spend: vi.fn(async () => SPEND),
      providers: vi.fn(async () => PROVIDERS),
    }
    const store = createBalanceStore(calls, () => undefined)
    await store.refresh('deepseek-official')
    expect(store.getSnapshot().providers).toEqual(PROVIDERS)
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
