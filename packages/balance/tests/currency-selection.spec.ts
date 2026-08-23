import { describe, expect, it } from 'vitest'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { DEFAULT_PRICES } from '../src/default-prices.ts'
import { ActivePrices, ledgerRowOf } from '../src/index.ts'
import type { BalanceView } from '../src/types.ts'

/** A Wednesday at 12:00 UTC — outside DeepSeek's peak windows in both currencies. */
const OFF_PEAK = Date.UTC(2026, 7, 19, 12, 0)
/** The same Wednesday at 02:30 UTC — inside them. */
const PEAK = Date.UTC(2026, 7, 19, 2, 30)

function balance(currency: string): BalanceView {
  return {
    state: 'ok',
    currency,
    total: '1',
    granted: '0',
    toppedUp: '1',
    isAvailable: true,
    fetchedAt: 0,
    stale: false,
  }
}

const USAGE: TokenUsage = { inputTokens: 1_000_000, outputTokens: 0 }

function step(atMs: number, model = 'deepseek-v4-flash'): SessionEvent {
  return {
    type: 'assistant/message',
    seq: 7,
    time: atMs,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'deepseek-official', model } },
      usage: USAGE,
    },
  } as unknown as SessionEvent
}

describe('ActivePrices', () => {
  it('starts on the configured preference, before any balance read', () => {
    expect(new ActivePrices(DEFAULT_PRICES, ['CNY', 'USD']).currency).toBe('CNY')
    expect(new ActivePrices(DEFAULT_PRICES, ['USD', 'CNY']).currency).toBe('USD')
  })

  it('switches to the account currency, which is the one the balance is quoted in', () => {
    const active = new ActivePrices(DEFAULT_PRICES, ['USD'])
    expect(active.currency).toBe('USD')
    active.observe(balance('CNY'))
    expect(active.currency).toBe('CNY')
    expect(active.entries[0]?.base.input).toBe(1.5)
  })

  it('notifies once per change, and not when the read confirms the current choice', () => {
    const active = new ActivePrices(DEFAULT_PRICES, ['USD'])
    const seen: string[] = []
    active.onChange(currency => seen.push(currency))
    active.observe(balance('USD'))
    active.observe(balance('CNY'))
    active.observe(balance('CNY'))
    active.observe(balance('USD'))
    expect(seen).toEqual(['CNY', 'USD'])
  })

  it('keeps its choice for a balance in a currency the table does not price', () => {
    const active = new ActivePrices(DEFAULT_PRICES, ['CNY'])
    active.observe(balance('JPY'))
    expect(active.currency).toBe('CNY')
  })

  it('ignores every read that is not a successful one', () => {
    const active = new ActivePrices(DEFAULT_PRICES, ['USD'])
    active.observe({ state: 'unconfigured' })
    active.observe({ state: 'unavailable', reason: 'network', fetchedAt: 0 })
    expect(active.currency).toBe('USD')
  })

  it('stops notifying a listener that unsubscribed', () => {
    const active = new ActivePrices(DEFAULT_PRICES, ['USD'])
    let seen = 0
    const stop = active.onChange(() => { seen += 1 })
    stop()
    active.observe(balance('CNY'))
    expect(seen).toBe(0)
  })
})

describe('ledgerRowOf', () => {
  it('stamps the row with the currency it was priced in', () => {
    const active = new ActivePrices(DEFAULT_PRICES, ['CNY'])
    const row = ledgerRowOf(active, { id: 's1' }, step(OFF_PEAK))
    expect(row).toMatchObject({ currency: 'CNY', schedule: 'off-peak', sessionId: 's1', seq: 7 })
    // 1M cache-miss input tokens at the CNY off-peak rate.
    expect(row?.cost).toBeCloseTo(1.5, 10)
  })

  it('prices the same step differently once the account currency is known', () => {
    const active = new ActivePrices(DEFAULT_PRICES, ['USD'])
    const usd = ledgerRowOf(active, { id: 's1' }, step(OFF_PEAK))
    active.observe(balance('CNY'))
    const cny = ledgerRowOf(active, { id: 's1' }, step(OFF_PEAK))
    expect(usd).toMatchObject({ currency: 'USD' })
    expect(cny).toMatchObject({ currency: 'CNY' })
    expect(usd?.cost).toBeCloseTo(0.22, 10)
    expect(cny?.cost).toBeCloseTo(1.5, 10)
  })

  it('records the tier the request actually fell in', () => {
    const active = new ActivePrices(DEFAULT_PRICES, ['CNY'])
    expect(ledgerRowOf(active, { id: 's1' }, step(PEAK))).toMatchObject({ schedule: 'peak' })
    expect(ledgerRowOf(active, { id: 's1' }, step(PEAK))?.cost).toBeCloseTo(3, 10)
  })

  it('marks a model the table does not price, keeping its tokens', () => {
    const active = new ActivePrices(DEFAULT_PRICES, ['CNY'])
    const row = ledgerRowOf(active, { id: 's1' }, step(OFF_PEAK, 'some-other-model'))
    expect(row).toMatchObject({ unpriced: true, cost: 0, schedule: '', currency: 'CNY' })
    expect(row?.input).toBe(1_000_000)
  })

  it('has no row for an event that is not a priced assistant step', () => {
    const active = new ActivePrices(DEFAULT_PRICES, ['CNY'])
    const other = { type: 'user/message', seq: 1, time: OFF_PEAK, data: {} } as unknown as SessionEvent
    expect(ledgerRowOf(active, { id: 's1' }, other)).toBeNull()
    const noUsage = { ...step(OFF_PEAK), data: { ...step(OFF_PEAK).data, usage: undefined } } as SessionEvent
    expect(ledgerRowOf(active, { id: 's1' }, noUsage)).toBeNull()
  })
})
