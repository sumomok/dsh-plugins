import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  blankDraft, draftOf, entryOf, numberOr, PriceTableSection, saveStatusKey, type PriceTableSectionProps,
} from '../src/client/PriceTableSection.tsx'
import type { Config } from '../src/config.ts'
import type { PriceEntry } from '../src/prices.ts'
import { en, type BalanceKey } from '../src/client/locales.ts'

function translateFrom(dict: Record<BalanceKey, string>): PriceTableSectionProps['t'] {
  return key => dict[key]
}

const FULL_ENTRY: PriceEntry = {
  model: 'deepseek-v4-flash',
  provider: 'deepseek-official',
  per: 1_000_000,
  base: { input: 1, inputCacheHit: 0.1, output: 2, cacheWrite: 1.5, reasoning: 2 },
  timezone: 'Asia/Shanghai',
  schedules: [{ name: 'peak', windows: [{ start: '00:30', end: '08:30' }], multiplier: 2 }],
}

const MINIMAL_ENTRY: PriceEntry = {
  model: 'some-model',
  per: 1_000_000,
  base: { input: 1, inputCacheHit: 0.5, output: 2 },
  timezone: 'UTC',
}

const CONFIG: Config = {
  lowBalance: 10,
  criticalBalance: 1,
  prices: {
    asOf: '2026-08-23',
    tables: {
      CNY: { entries: [FULL_ENTRY] },
      USD: { entries: [] },
    },
  },
}

function scopeOf(snapshot: Partial<SettingsScopeSnapshot<Config>> = {}): SettingsScope<Config> {
  const full: SettingsScopeSnapshot<Config> = {
    status: 'ready',
    value: CONFIG,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
    ...snapshot,
  }
  return {
    getSnapshot: () => full,
    subscribe: () => () => undefined,
    set: async () => undefined,
    unset: async () => undefined,
  }
}

function sectionProps(overrides: Partial<PriceTableSectionProps> = {}): PriceTableSectionProps {
  return {
    close: () => undefined,
    scope: scopeOf(),
    t: translateFrom(en),
    ...overrides,
  }
}

describe('draftOf / entryOf', () => {
  it('round-trips a full entry — provider, cache-write, reasoning, schedules, and timezone all survive unedited', () => {
    expect(entryOf(draftOf(FULL_ENTRY))).toEqual(FULL_ENTRY)
  })

  it('round-trips a minimal entry without reintroducing the optional fields it never had', () => {
    const round = entryOf(draftOf(MINIMAL_ENTRY))
    expect(round).toEqual(MINIMAL_ENTRY)
    expect(round).not.toHaveProperty('provider')
    expect(round.base).not.toHaveProperty('cacheWrite')
    expect(round.base).not.toHaveProperty('reasoning')
    expect(round).not.toHaveProperty('schedules')
  })

  it('gives a blank draft the usual per-1M unit and no schedules', () => {
    const draft = blankDraft()
    expect(entryOf(draft)).toMatchObject({ per: 1_000_000, base: { input: 0, inputCacheHit: 0, output: 0 } })
    expect(draft.schedules).toBeUndefined()
  })
})

describe('numberOr', () => {
  it('parses a valid number', () => {
    expect(numberOr('12.5', 0)).toBe(12.5)
  })

  it('falls back for empty or non-numeric text', () => {
    expect(numberOr('', 7)).toBe(7)
    expect(numberOr('not a number', 7)).toBe(7)
  })
})

describe('saveStatusKey', () => {
  it('names no key while idle', () => {
    expect(saveStatusKey('idle')).toBeUndefined()
  })

  it('names the matching key for every other state', () => {
    expect(saveStatusKey('saving')).toBe('settings.saving')
    expect(saveStatusKey('saved')).toBe('settings.saved')
    expect(saveStatusKey('error')).toBe('settings.error')
  })
})

describe('PriceTableSection', () => {
  it('renders a loading placeholder before the first accepted section', () => {
    const props = sectionProps({ scope: scopeOf({ status: 'loading', value: undefined }) })
    const html = renderToStaticMarkup(<PriceTableSection {...props} />)
    expect(html).toContain('Loading')
  })

  it('renders an unavailable notice when this deployment registered no settings document', () => {
    const props = sectionProps({ scope: scopeOf({ status: 'unavailable', value: undefined }) })
    const html = renderToStaticMarkup(<PriceTableSection {...props} />)
    expect(html).toContain('no settings document')
  })

  it('renders the thresholds and the first currency\'s price rows once ready', () => {
    const html = renderToStaticMarkup(<PriceTableSection {...sectionProps()} />)
    expect(html).toContain('Balance color thresholds')
    expect(html).toContain('Price table')
    expect(html).toContain('deepseek-v4-flash')
    expect(html).toContain('deepseek-official')
    // The schedule is summarized as read-only text, not an editable field.
    expect(html).toContain('peak')
  })

  it('shows the read-only notice and disables every control when the connection cannot write', () => {
    const props = sectionProps({ scope: scopeOf({ writable: false }) })
    const html = renderToStaticMarkup(<PriceTableSection {...props} />)
    expect(html).toContain('cannot be edited from this connection')
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThan(0)
  })
})
