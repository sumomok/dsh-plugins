import { describe, expect, it } from 'vitest'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { DEFAULT_PRICES } from '../src/default-prices.ts'
import { pricesFor } from '../src/prices.ts'
import type { PriceEntry } from '../src/prices.ts'
import {
  billingBuckets, priceStep, priceTableVersion, SESSION_SPEND_KEY, sessionSpendProjection, totalTokens,
} from '../src/session-spend.ts'

/** A Wednesday inside DeepSeek's published peak window. */
const PEAK = Date.UTC(2026, 7, 19, 2, 30)
/** The same Wednesday, outside it. */
const OFF_PEAK = Date.UTC(2026, 7, 19, 12, 0)

const TABLE: PriceEntry[] = [{
  model: 'm',
  provider: 'p',
  per: 1_000_000,
  timezone: 'UTC',
  baseName: 'off-peak',
  base: { input: 1, inputCacheHit: 0.1, output: 3 },
  schedules: [{ name: 'peak', multiplier: 2, windows: [{ start: '01:00', end: '04:00', days: [1, 2, 3, 4, 5] }] }],
}]

/** One `assistant/message` event, as the agent loop writes it. */
function step(over: {
  seq?: number
  time?: number
  model?: string
  provider?: string
  usage?: TokenUsage | undefined
} = {}): SessionEvent {
  return {
    type: 'assistant/message',
    seq: over.seq ?? 1,
    time: over.time ?? OFF_PEAK,
    data: {
      turn: 1,
      step: over.seq ?? 1,
      message: {
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: over.provider ?? 'p', model: over.model ?? 'm' },
      },
      ...over.usage === undefined ? {} : { usage: over.usage },
    },
  } as unknown as SessionEvent
}

const USAGE: TokenUsage = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
  cacheWriteTokens: 0,
  reasoningTokens: 400_000,
}

describe('billingBuckets', () => {
  it('keeps the provider input buckets disjoint and takes reasoning out of output', () => {
    expect(billingBuckets(USAGE)).toEqual({
      input: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 0,
      output: 600_000,
      reasoning: 400_000,
    })
  })

  it('defaults every optional bucket to zero', () => {
    expect(billingBuckets({ inputTokens: 5, outputTokens: 7 }))
      .toEqual({ input: 5, cacheRead: 0, cacheWrite: 0, output: 7, reasoning: 0 })
  })

  it('never reports negative generated tokens when a provider over-reports reasoning', () => {
    expect(billingBuckets({ inputTokens: 0, outputTokens: 10, reasoningTokens: 40 }).output).toBe(0)
  })

  it('counts every bucket once', () => {
    expect(totalTokens(billingBuckets(USAGE))).toBe(3_000_000)
  })
})

describe('priceStep', () => {
  it('prices at the tier the step ran in', () => {
    // 1 + 0.1 + 1.8 (600k output) + 1.2 (400k reasoning at the output rate) = 4.1
    expect(priceStep(TABLE, { provider: 'p', model: 'm' }, OFF_PEAK, USAGE))
      .toMatchObject({ cost: 4.1, scheduleName: 'off-peak' })
    expect(priceStep(TABLE, { provider: 'p', model: 'm' }, PEAK, USAGE))
      .toMatchObject({ cost: 8.2, scheduleName: 'peak' })
  })

  it('reports a model the table does not price as unpriced, with its tokens kept', () => {
    const step = priceStep(TABLE, { provider: 'p', model: 'other' }, OFF_PEAK, USAGE)
    expect(step.cost).toBeNull()
    expect(step.scheduleName).toBeUndefined()
    expect(totalTokens(step.counts)).toBe(3_000_000)
  })
})

describe('sessionSpendProjection', () => {
  const unit = sessionSpendProjection(TABLE, 'USD')

  it('starts empty', () => {
    expect(unit.init()).toEqual({ total: 0, byModel: {}, bySchedule: {}, unpricedTokens: 0, steps: 0 })
  })

  it('owns one key and validates its own state', () => {
    expect(unit.key).toBe(SESSION_SPEND_KEY)
    expect(() => unit.stateSchema.parse(unit.init())).not.toThrow()
  })

  it('returns the same state reference for an event it does not fold', () => {
    const state = unit.init()
    const other = { type: 'user/message', seq: 1, time: OFF_PEAK, data: {} } as unknown as SessionEvent
    expect(unit.apply(state, other)).toBe(state)
    expect(unit.apply(state, step({ usage: undefined }))).toBe(state)
  })

  it('folds a priced step into the total, the model row, and the tier split', () => {
    const next = unit.apply(unit.init(), step({ usage: USAGE }))
    expect(next.total).toBeCloseTo(4.1, 10)
    expect(next.steps).toBe(1)
    expect(next.bySchedule).toEqual({ 'off-peak': 4.1 })
    expect(next.byModel.m).toEqual({
      input: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 0,
      output: 600_000,
      reasoning: 400_000,
      cost: 4.1,
    })
  })

  it('adds a second step of the same model into the same row', () => {
    const first = unit.apply(unit.init(), step({ usage: USAGE }))
    const second = unit.apply(first, step({ seq: 2, usage: USAGE }))
    expect(second.steps).toBe(2)
    expect(second.byModel.m?.cost).toBeCloseTo(8.2, 10)
    expect(second.byModel.m?.input).toBe(2_000_000)
  })

  it('keeps two tiers apart across a window boundary', () => {
    const first = unit.apply(unit.init(), step({ usage: USAGE, time: OFF_PEAK }))
    const second = unit.apply(first, step({ seq: 2, usage: USAGE, time: PEAK }))
    expect(second.bySchedule['off-peak']).toBeCloseTo(4.1, 10)
    expect(second.bySchedule.peak).toBeCloseTo(8.2, 10)
    expect(second.total).toBeCloseTo(12.3, 10)
  })

  it('counts an unpriced model as tokens and as a step, with no cost', () => {
    const next = unit.apply(unit.init(), step({ usage: USAGE, model: 'other' }))
    expect(next.total).toBe(0)
    expect(next.steps).toBe(1)
    expect(next.unpricedTokens).toBe(3_000_000)
    expect(next.byModel).toEqual({})
  })

  it('prices per provider when the table distinguishes them', () => {
    const perProvider = sessionSpendProjection([
      ...TABLE,
      { model: 'm', provider: 'q', per: 1_000_000, timezone: 'UTC', base: { input: 10, inputCacheHit: 10, output: 10 } },
    ], 'USD')
    const q = perProvider.apply(perProvider.init(), step({ usage: USAGE, provider: 'q' }))
    expect(q.total).toBeGreaterThan(4.1)
  })

  it('publishes the state plus the currency, and validates it', () => {
    const state = unit.apply(unit.init(), step({ usage: USAGE }))
    const view = unit.wire.view(state)
    expect(view.currency).toBe('USD')
    expect(() => unit.wire.viewSchema.parse(view)).not.toThrow()
  })
})

describe('priceTableVersion', () => {
  it('is stable for one list and different for a changed rate', () => {
    expect(priceTableVersion(TABLE, 'USD')).toBe(priceTableVersion(TABLE, 'USD'))
    const dearer: PriceEntry[] = [{ ...TABLE[0]!, base: { input: 2, inputCacheHit: 0.1, output: 3 } }]
    expect(priceTableVersion(dearer, 'USD')).not.toBe(priceTableVersion(TABLE, 'USD'))
  })

  it('differs between two currencies, so a switch discards the folds priced in the other', () => {
    expect(priceTableVersion(TABLE, 'CNY')).not.toBe(priceTableVersion(TABLE, 'USD'))
    expect(priceTableVersion(pricesFor(DEFAULT_PRICES, 'CNY'), 'CNY'))
      .not.toBe(priceTableVersion(pricesFor(DEFAULT_PRICES, 'USD'), 'USD'))
  })

  it('is a non-negative safe integer, as the registry requires', () => {
    for (const [entries, currency] of [
      [TABLE, 'USD'],
      [pricesFor(DEFAULT_PRICES, 'CNY'), 'CNY'],
      [pricesFor(DEFAULT_PRICES, 'USD'), 'USD'],
    ] as const) {
      const version = priceTableVersion(entries, currency)
      expect(Number.isSafeInteger(version)).toBe(true)
      expect(version).toBeGreaterThanOrEqual(0)
    }
  })
})
