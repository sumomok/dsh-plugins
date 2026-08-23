import { describe, expect, it } from 'vitest'
import { DEFAULT_PRICES } from '../src/default-prices.ts'
import {
  costOf, isSupportedTimezone, isWallClockTime, pricesFor, resolvePriceTable, resolveRates,
  selectPriceCurrency, wallClockAt, windowContains,
} from '../src/prices.ts'
import type { PriceEntry, PriceTable, TokenCounts } from '../src/prices.ts'

/** 2026-08-19 is a Wednesday; 2026-08-22 a Saturday. */
const WEDNESDAY_0230_UTC = Date.UTC(2026, 7, 19, 2, 30)
const WEDNESDAY_1200_UTC = Date.UTC(2026, 7, 19, 12, 0)
const SATURDAY_0230_UTC = Date.UTC(2026, 7, 22, 2, 30)

const NO_TOKENS: TokenCounts = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 }

describe('windowContains', () => {
  it('covers a same-day window from its start up to but not including its end', () => {
    const window = { start: '09:00', end: '17:00' }
    expect(windowContains(window, { day: 3, minutes: 9 * 60 })).toBe(true)
    expect(windowContains(window, { day: 3, minutes: 16 * 60 + 59 })).toBe(true)
    expect(windowContains(window, { day: 3, minutes: 17 * 60 })).toBe(false)
    expect(windowContains(window, { day: 3, minutes: 8 * 60 + 59 })).toBe(false)
  })

  it('wraps past midnight rather than covering the inverse of the day', () => {
    const window = { start: '22:00', end: '02:00' }
    expect(windowContains(window, { day: 3, minutes: 23 * 60 })).toBe(true)
    expect(windowContains(window, { day: 3, minutes: 1 * 60 })).toBe(true)
    expect(windowContains(window, { day: 3, minutes: 12 * 60 })).toBe(false)
  })

  it('anchors a wrapping window to the day it opened on', () => {
    // Opens Friday 22:00; Saturday's first two hours belong to Friday's window.
    const window = { start: '22:00', end: '02:00', days: [5] }
    expect(windowContains(window, { day: 5, minutes: 23 * 60 })).toBe(true)
    expect(windowContains(window, { day: 6, minutes: 1 * 60 })).toBe(true)
    expect(windowContains(window, { day: 5, minutes: 1 * 60 })).toBe(false)
    expect(windowContains(window, { day: 0, minutes: 1 * 60 })).toBe(false)
  })

  it('filters a same-day window by weekday', () => {
    const window = { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] }
    expect(windowContains(window, { day: 3, minutes: 10 * 60 })).toBe(true)
    expect(windowContains(window, { day: 6, minutes: 10 * 60 })).toBe(false)
    expect(windowContains(window, { day: 0, minutes: 10 * 60 })).toBe(false)
  })
})

describe('wallClockAt', () => {
  it('reads a fixed-offset zone', () => {
    expect(wallClockAt(WEDNESDAY_0230_UTC, 'UTC')).toEqual({ day: 3, minutes: 150 })
    expect(wallClockAt(WEDNESDAY_0230_UTC, 'Asia/Shanghai')).toEqual({ day: 3, minutes: 10 * 60 + 30 })
  })

  it('follows a DST zone across its own transition', () => {
    // New York is UTC-5 in January and UTC-4 in July.
    const january = Date.UTC(2026, 0, 15, 12, 0)
    const july = Date.UTC(2026, 6, 15, 12, 0)
    expect(wallClockAt(january, 'America/New_York').minutes).toBe(7 * 60)
    expect(wallClockAt(july, 'America/New_York').minutes).toBe(8 * 60)
  })

  it('rolls the weekday back when the zone is behind the date line', () => {
    const justAfterUtcMidnight = Date.UTC(2026, 7, 19, 0, 30)
    expect(wallClockAt(justAfterUtcMidnight, 'UTC').day).toBe(3)
    expect(wallClockAt(justAfterUtcMidnight, 'America/New_York').day).toBe(2)
  })
})

describe('resolveRates', () => {
  const table: PriceEntry[] = [{
    model: 'm',
    per: 1_000_000,
    timezone: 'UTC',
    base: { input: 1, inputCacheHit: 0.1, output: 3 },
    schedules: [
      { name: 'first', multiplier: 2, windows: [{ start: '01:00', end: '04:00', days: [1, 2, 3, 4, 5] }] },
      { name: 'second', rates: { input: 9, inputCacheHit: 9, output: 9 }, windows: [{ start: '00:00', end: '23:59' }] },
    ],
  }]

  it('takes the first schedule whose window contains the instant', () => {
    const hit = resolveRates(table, { model: 'm' }, WEDNESDAY_0230_UTC)
    expect(hit?.scheduleName).toBe('first')
    expect(hit?.scheduled).toBe(true)
    expect(hit?.rates.input).toBe(2)
  })

  it('falls through to a later schedule when the earlier window is closed', () => {
    const hit = resolveRates(table, { model: 'm' }, SATURDAY_0230_UTC)
    expect(hit?.scheduleName).toBe('second')
    expect(hit?.rates.input).toBe(9)
  })

  it('scales every base field with a multiplier, and settles the derived fields first', () => {
    const hit = resolveRates(table, { model: 'm' }, WEDNESDAY_0230_UTC)
    // cacheWrite defaults to input and reasoning to output BEFORE scaling.
    expect(hit?.rates).toEqual({ input: 2, inputCacheHit: 0.2, output: 6, cacheWrite: 2, reasoning: 6 })
  })

  it('settles explicit schedule rates the same way', () => {
    const hit = resolveRates(table, { model: 'm' }, SATURDAY_0230_UTC)
    expect(hit?.rates).toEqual({ input: 9, inputCacheHit: 9, output: 9, cacheWrite: 9, reasoning: 9 })
  })

  it('uses the base tier and its name outside every window', () => {
    const noSchedules: PriceEntry[] = [
      { model: 'm', per: 1_000, timezone: 'UTC', baseName: 'flat', base: { input: 1, inputCacheHit: 1, output: 1 } },
    ]
    const hit = resolveRates(noSchedules, { model: 'm' }, WEDNESDAY_1200_UTC)
    expect(hit).toEqual({
      rates: { input: 1, inputCacheHit: 1, output: 1, cacheWrite: 1, reasoning: 1 },
      per: 1_000,
      scheduleName: 'flat',
      scheduled: false,
    })
  })

  it('names the base tier "standard" when the entry does not', () => {
    const bare: PriceEntry[] = [{ model: 'm', per: 1, timezone: 'UTC', base: { input: 0, inputCacheHit: 0, output: 0 } }]
    expect(resolveRates(bare, { model: 'm' }, 0)?.scheduleName).toBe('standard')
  })

  it('prefers a provider-specific entry over the provider-less one for the same model', () => {
    const both: PriceEntry[] = [
      { model: 'm', per: 1, timezone: 'UTC', base: { input: 1, inputCacheHit: 1, output: 1 } },
      { model: 'm', provider: 'p', per: 1, timezone: 'UTC', base: { input: 5, inputCacheHit: 5, output: 5 } },
    ]
    expect(resolveRates(both, { model: 'm', provider: 'p' }, 0)?.rates.input).toBe(5)
    expect(resolveRates(both, { model: 'm', provider: 'other' }, 0)?.rates.input).toBe(1)
    expect(resolveRates(both, { model: 'm' }, 0)?.rates.input).toBe(1)
  })

  it('returns null for a model the table does not price', () => {
    expect(resolveRates(table, { model: 'unknown' }, WEDNESDAY_1200_UTC)).toBeNull()
  })

  it('prices a request in the zone the entry names, not the host zone', () => {
    const shanghai: PriceEntry[] = [{
      model: 'm',
      per: 1,
      timezone: 'Asia/Shanghai',
      base: { input: 1, inputCacheHit: 1, output: 1 },
      schedules: [{ name: 'night', multiplier: 0.5, windows: [{ start: '00:30', end: '08:30' }] }],
    }]
    // 18:00 UTC is 02:00 the next day in Shanghai, inside the night window.
    expect(resolveRates(shanghai, { model: 'm' }, Date.UTC(2026, 7, 19, 18, 0))?.scheduleName).toBe('night')
    expect(resolveRates(shanghai, { model: 'm' }, Date.UTC(2026, 7, 19, 6, 0))?.scheduled).toBe(false)
  })
})

describe('costOf', () => {
  it('bills every bucket at its own rate, per rate unit', () => {
    const rates = { input: 2, inputCacheHit: 1, output: 6, cacheWrite: 3, reasoning: 12 }
    const usage = { input: 1_000, cacheRead: 2_000, cacheWrite: 500, output: 300, reasoning: 100 }
    // 2000 + 2000 + 1500 + 1800 + 1200 = 8500 per million.
    expect(costOf(usage, rates, 1_000_000)).toBeCloseTo(0.0085, 10)
  })

  it('is zero for no tokens', () => {
    expect(costOf(NO_TOKENS, { input: 9, inputCacheHit: 9, output: 9, cacheWrite: 9, reasoning: 9 }, 1_000)).toBe(0)
  })
})

describe('resolvePriceTable', () => {
  const entry = { model: 'm', per: 1, timezone: 'UTC', base: { input: 1, inputCacheHit: 1, output: 1 } }
  /** A one-currency table, so each case states only what it is testing. */
  const table = (over: { asOf?: string; entries?: PriceEntry[]; tables?: PriceTable['tables'] } = {}): PriceTable => ({
    asOf: over.asOf ?? '2026-08-23',
    tables: over.tables ?? { USD: { entries: over.entries ?? [entry] } },
  })

  it('rejects an asOf that is not a date', () => {
    expect(() => resolvePriceTable(table({ asOf: 'August' }))).toThrow(/asOf/)
  })

  it('rejects a table pricing no currency at all', () => {
    expect(() => resolvePriceTable(table({ tables: {} }))).toThrow(/at least one currency/)
  })

  it('rejects a key that is not an ISO 4217 code', () => {
    expect(() => resolvePriceTable(table({ tables: { dollars: { entries: [entry] } } })))
      .toThrow(/three-letter ISO 4217 code/)
  })

  it('names the offending currency list in the diagnostic', () => {
    const broken = table({
      tables: { USD: { entries: [entry] }, CNY: { entries: [{ ...entry, timezone: 'Mars/Olympus' }] } },
    })
    expect(() => resolvePriceTable(broken)).toThrow(/tables\.CNY/)
  })

  it('rejects a schedule declaring both rates and a multiplier', () => {
    const both = table({
      entries: [{
        ...entry,
        schedules: [{
          name: 'x',
          multiplier: 2,
          rates: { input: 1, inputCacheHit: 1, output: 1 },
          windows: [{ start: '01:00', end: '02:00' }],
        }],
      }],
    })
    expect(() => resolvePriceTable(both)).toThrow(/exactly one of rates or multiplier/)
  })

  it('rejects a schedule declaring neither', () => {
    const neither = table({
      entries: [{ ...entry, schedules: [{ name: 'x', windows: [{ start: '01:00', end: '02:00' }] }] }],
    })
    expect(() => resolvePriceTable(neither)).toThrow(/exactly one of rates or multiplier/)
  })

  it('rejects a window that is not HH:MM', () => {
    const bad = table({
      entries: [{ ...entry, schedules: [{ name: 'x', multiplier: 1, windows: [{ start: '1:00', end: '02:00' }] }] }],
    })
    expect(() => resolvePriceTable(bad)).toThrow(/not HH:MM/)
  })

  it('rejects an empty window rather than pricing zero minutes at its rate', () => {
    const empty = table({
      entries: [{ ...entry, schedules: [{ name: 'x', multiplier: 1, windows: [{ start: '02:00', end: '02:00' }] }] }],
    })
    expect(() => resolvePriceTable(empty)).toThrow(/empty window/)
  })

  it('rejects a schedule with no windows', () => {
    const none = table({ entries: [{ ...entry, schedules: [{ name: 'x', multiplier: 1, windows: [] }] }] })
    expect(() => resolvePriceTable(none)).toThrow(/windows must not be empty/)
  })

  it('rejects a weekday outside 0 through 6', () => {
    const bad = table({
      entries: [{ ...entry, schedules: [{ name: 'x', multiplier: 1, windows: [{ start: '01:00', end: '02:00', days: [7] }] }] }],
    })
    expect(() => resolvePriceTable(bad)).toThrow(/outside 0 \(Sunday\)/)
  })

  it('rejects a timezone this runtime does not know', () => {
    expect(() => resolvePriceTable(table({ entries: [{ ...entry, timezone: 'Mars/Olympus' }] }))).toThrow(/IANA timezone/)
  })

  it('rejects a non-positive rate unit', () => {
    expect(() => resolvePriceTable(table({ entries: [{ ...entry, per: 0 }] }))).toThrow(/per must be a positive number/)
  })

  it('rejects a negative rate', () => {
    const negative = table({ entries: [{ ...entry, base: { input: -1, inputCacheHit: 1, output: 1 } }] })
    expect(() => resolvePriceTable(negative)).toThrow(/must be a non-negative number/)
  })

  it('rejects the same model declared twice for the same provider', () => {
    expect(() => resolvePriceTable(table({ entries: [entry, entry] }))).toThrow(/declared twice/)
  })
})

describe('the shipped DeepSeek tables', () => {
  const deepseek = (currency: string, model: string, atMs: number) =>
    resolveRates(pricesFor(DEFAULT_PRICES, currency), { model, provider: 'deepseek-official' }, atMs)

  it('prices both currencies DeepSeek bills in', () => {
    expect(Object.keys(DEFAULT_PRICES.tables).sort()).toEqual(['CNY', 'USD'])
    for (const list of Object.values(DEFAULT_PRICES.tables)) expect(list.entries).toHaveLength(3)
  })

  it('carries the USD numbers the English page prints', () => {
    const offPeak = deepseek('USD', 'deepseek-v4-pro', WEDNESDAY_1200_UTC)
    expect(offPeak?.rates).toMatchObject({ input: 0.66, inputCacheHit: 0.022, output: 1.98 })
    expect(offPeak?.scheduleName).toBe('off-peak')
    expect(deepseek('USD', 'deepseek-v4-pro', WEDNESDAY_0230_UTC)?.rates.output).toBeCloseTo(3.96, 10)
  })

  it('carries the CNY numbers the Chinese page prints', () => {
    const offPeak = deepseek('CNY', 'deepseek-v4-pro', WEDNESDAY_1200_UTC)
    expect(offPeak?.rates).toMatchObject({ input: 4.5, inputCacheHit: 0.15, output: 13.5 })
    expect(offPeak?.scheduleName).toBe('off-peak')
    const peak = deepseek('CNY', 'deepseek-v4-pro', WEDNESDAY_0230_UTC)
    expect(peak?.rates).toMatchObject({ input: 9, inputCacheHit: 0.3, output: 27 })
    expect(peak?.scheduleName).toBe('peak')
  })

  it('claims the same instants in both currencies, each written in its own page\'s timezone', () => {
    // 09:00 Beijing is 01:00 UTC; the two lists must agree on every boundary.
    for (const atMs of [
      Date.UTC(2026, 7, 19, 0, 59), Date.UTC(2026, 7, 19, 1, 0), Date.UTC(2026, 7, 19, 3, 59),
      Date.UTC(2026, 7, 19, 4, 0), Date.UTC(2026, 7, 19, 5, 59), Date.UTC(2026, 7, 19, 6, 0),
      Date.UTC(2026, 7, 19, 9, 59), Date.UTC(2026, 7, 19, 10, 0), SATURDAY_0230_UTC,
    ]) {
      const cny = deepseek('CNY', 'deepseek-v4-flash', atMs)
      const usd = deepseek('USD', 'deepseek-v4-flash', atMs)
      expect(cny?.scheduleName, new Date(atMs).toISOString()).toBe(usd?.scheduleName)
    }
  })

  it('charges the off-peak rate all weekend, in both currencies', () => {
    for (const currency of ['CNY', 'USD']) {
      expect(deepseek(currency, 'deepseek-v4-flash', SATURDAY_0230_UTC)?.scheduled).toBe(false)
    }
  })

  it('bills a cache write at the cache-miss input rate and a reasoning token at the output rate', () => {
    for (const currency of ['CNY', 'USD']) {
      const hit = deepseek(currency, 'deepseek-v4-flash', WEDNESDAY_1200_UTC)
      expect(hit?.rates.cacheWrite).toBe(hit?.rates.input)
      expect(hit?.rates.reasoning).toBe(hit?.rates.output)
    }
  })

  it('accepts its own validation', () => {
    expect(resolvePriceTable(DEFAULT_PRICES)).toBe(DEFAULT_PRICES)
  })
})

describe('selectPriceCurrency', () => {
  const table: PriceTable = {
    asOf: '2026-08-23',
    tables: {
      CNY: { entries: [] },
      EUR: { entries: [] },
      USD: { entries: [] },
    },
  }

  it('follows the account currency, which is the only one comparable to the balance', () => {
    expect(selectPriceCurrency(table, { balanceCurrency: 'CNY', preference: ['USD'] })).toBe('CNY')
  })

  it('falls back to the configured preference before the account currency is known', () => {
    expect(selectPriceCurrency(table, { preference: ['EUR', 'USD'] })).toBe('EUR')
  })

  it('skips a preferred currency the table does not price', () => {
    expect(selectPriceCurrency(table, { preference: ['JPY', 'CNY'] })).toBe('CNY')
  })

  it('ignores an account currency the table does not price', () => {
    expect(selectPriceCurrency(table, { balanceCurrency: 'JPY', preference: ['CNY'] })).toBe('CNY')
  })

  it('falls back to USD, then to the first list by name, so the choice is never arbitrary', () => {
    expect(selectPriceCurrency(table, {})).toBe('USD')
    expect(selectPriceCurrency({ asOf: '2026-08-23', tables: { SEK: { entries: [] }, NOK: { entries: [] } } }, {}))
      .toBe('NOK')
  })

  it('has nothing to choose from an empty table', () => {
    expect(selectPriceCurrency({ asOf: '2026-08-23', tables: {} }, {})).toBeUndefined()
  })
})

describe('pricesFor', () => {
  it('returns a currency list, and an empty one for a currency the table does not price', () => {
    expect(pricesFor(DEFAULT_PRICES, 'CNY')).toHaveLength(3)
    expect(pricesFor(DEFAULT_PRICES, 'JPY')).toEqual([])
  })
})

describe('helpers', () => {
  it('recognizes wall-clock times and rejects everything else', () => {
    expect(isWallClockTime('00:00')).toBe(true)
    expect(isWallClockTime('23:59')).toBe(true)
    expect(isWallClockTime('24:00')).toBe(false)
    expect(isWallClockTime('9:00')).toBe(false)
  })

  it('recognizes the zones the runtime carries', () => {
    expect(isSupportedTimezone('UTC')).toBe(true)
    expect(isSupportedTimezone('Asia/Shanghai')).toBe(true)
    expect(isSupportedTimezone('Nowhere/Nothing')).toBe(false)
  })
})
