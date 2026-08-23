import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { Config, resolveBalanceConfig } from '../src/config.ts'
import { DEFAULT_PRICES } from '../src/default-prices.ts'
import { hostTimezone, LEDGER_DIR } from '../src/ledger.ts'
import type { PriceTable } from '../src/prices.ts'

const home = (...segments: string[]): string => join('/tmp/home', ...segments)

describe('the schema', () => {
  it('settles every field from an empty config', () => {
    const settled = Config({})
    expect(settled.refreshMs).toBe(60_000)
    expect(settled.retryMs).toBe(15_000)
    expect(settled.timeoutMs).toBe(8_000)
    expect(settled.currency).toEqual(['CNY', 'USD'])
    expect(settled.lowBalance).toBe(10)
    expect(settled.criticalBalance).toBe(1)
    expect(settled.ledgerDays).toBe(400)
    expect(settled.surfaces).toEqual({ footer: true, sessionSpend: true })
    expect(settled.prices?.entries).toHaveLength(3)
  })

  it('rejects a poll faster than the floor, which would hammer the provider', () => {
    expect(() => Config({ refreshMs: 1_000 })).toThrow()
  })

  it('rejects a non-integer window', () => {
    expect(() => Config({ timeoutMs: 1_500.5 })).toThrow()
  })

  it('takes a replacement price table from configuration', () => {
    const settled = Config({
      prices: {
        asOf: '2027-01-01',
        currency: 'EUR',
        entries: [{ model: 'x', per: 1_000, timezone: 'UTC', base: { input: 1, inputCacheHit: 1, output: 1 } }],
      },
    })
    expect(settled.prices?.currency).toBe('EUR')
    expect(settled.prices?.entries[0]?.model).toBe('x')
  })
})

describe('resolveBalanceConfig', () => {
  it('settles the ledger root and the timezone from the host when neither is named', () => {
    const resolved = resolveBalanceConfig(Config({}), home)
    expect(resolved.root).toBe(home(LEDGER_DIR))
    expect(resolved.timezone).toBe(hostTimezone())
  })

  it('keeps an explicit root and timezone', () => {
    const resolved = resolveBalanceConfig(Config({ root: '/data/balance', timezone: 'Asia/Shanghai' }), home)
    expect(resolved.root).toBe('/data/balance')
    expect(resolved.timezone).toBe('Asia/Shanghai')
  })

  it('rejects a timezone this runtime does not know, at load', () => {
    expect(() => resolveBalanceConfig(Config({ timezone: 'Mars/Olympus' }), home)).toThrow(/IANA timezone/)
  })

  it('rejects thresholds that cannot both hold', () => {
    expect(() => resolveBalanceConfig(Config({ lowBalance: 1, criticalBalance: 5 }), home))
      .toThrow(/criticalBalance 5 is above lowBalance 1/)
  })

  it('rejects an empty currency preference', () => {
    expect(() => resolveBalanceConfig(Config({ currency: [] }), home)).toThrow(/at least one code/)
  })

  it('rejects a price table the arithmetic cannot use, at load', () => {
    const broken = {
      asOf: '2026-08-23',
      currency: 'USD',
      entries: [{
        model: 'x',
        per: 1_000,
        timezone: 'UTC',
        base: { input: 1, inputCacheHit: 1, output: 1 },
        schedules: [{ name: 'y', windows: [{ start: '25:00', end: '02:00' }], multiplier: 2 }],
      }],
    } as unknown as PriceTable
    expect(() => resolveBalanceConfig(Config({ prices: broken }), home)).toThrow(/not HH:MM/)
  })

  it('carries the surface toggles through', () => {
    const resolved = resolveBalanceConfig(Config({ surfaces: { footer: false } }), home)
    expect(resolved.footer).toBe(false)
    expect(resolved.sessionSpend).toBe(true)
  })
})

describe('the bundle patch', () => {
  const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')

  it('names this package, so the profile resolves the row it installed', () => {
    expect(patch).toContain("name: '@haoran/dsh-balance'")
  })

  it('restates every default, because a profile patch replaces the whole config block', () => {
    for (const key of [
      'refreshMs', 'retryMs', 'timeoutMs', 'currency', 'lowBalance', 'criticalBalance',
      'ledgerDays', 'timezone', 'root', 'surfaces', 'prices',
    ]) {
      expect(patch).toContain(`${key}:`)
    }
  })

  it('survives the round trip a real install performs: YAML, schema, resolve', () => {
    const layer = load(patch) as { insert: { id: string; name: string; config: unknown }[] }[]
    const row = layer[0]?.insert[0]
    expect(row?.id).toBe('balance')
    const resolved = resolveBalanceConfig(Config(row?.config as never), home)
    expect(resolved.prices.entries).toHaveLength(DEFAULT_PRICES.entries.length)
    expect(resolved.prices.asOf).toBe(DEFAULT_PRICES.asOf)
    expect(resolved.refreshMs).toBe(60_000)
  })

  it('states the same numbers the shipped table carries', () => {
    expect(patch).toContain(`asOf: '${DEFAULT_PRICES.asOf}'`)
    for (const entry of DEFAULT_PRICES.entries) {
      expect(patch).toContain(`model: ${entry.model}`)
      expect(patch).toContain(`input: ${String(entry.base.input)}`)
    }
  })
})
