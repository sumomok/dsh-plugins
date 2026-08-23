/**
 * Plugin configuration. Every field is changeable from `cordis.yml` and
 * validated at load; nothing here is a constant compiled into the code.
 *
 * The per-field schema settles types, ranges, and defaults. The rules a
 * per-field schema cannot state — a schedule declaring exactly one of `rates`
 * and `multiplier`, an `HH:MM` window, a timezone this runtime knows — are
 * enforced by {@link resolveBalanceConfig}, which throws at load rather than
 * pricing something wrongly at the first request.
 *
 * @module @sumomok/dsh-balance/config
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_PRICES } from './default-prices.ts'
import { hostTimezone, LEDGER_DIR } from './ledger.ts'
import { isSupportedTimezone, resolvePriceTable, type PriceTable } from './prices.ts'

/** Which surfaces the browser half puts up. */
export interface Surfaces {
  /** The balance and spend chip beside Settings at the sidebar foot. */
  footer?: boolean
  /** The per-session spend line under the composer. */
  sessionSpend?: boolean
}

/** Plugin configuration. */
export interface Config {
  /** How long a successful balance read is served before a refresh is attempted. */
  refreshMs?: number
  /** How long a failed balance read suppresses further attempts, so a broken endpoint is not hammered per open tab. */
  retryMs?: number
  /** Wall-clock budget for one balance request. */
  timeoutMs?: number
  /**
   * Currency codes in descending preference. One list serves two decisions:
   * which balance row to show when the account holds several, and which price
   * list to spend against before the account's own currency is known.
   */
  currency?: string[]
  /** Balance below which the chip is tinted as a warning. */
  lowBalance?: number
  /** Balance below which the chip is tinted as critical. */
  criticalBalance?: number
  /** Days of ledger rows to keep; older rows are dropped and the file rewritten at startup. */
  ledgerDays?: number
  /**
   * IANA timezone the day and month spend boundaries are taken in. Empty means
   * the timezone the host process runs in.
   */
  timezone?: string
  /**
   * Directory this plugin writes its ledger into. Empty means
   * `$DSH_HOME/dsh-balance`.
   */
  root?: string
  /** Which surfaces the browser half puts up. */
  surfaces?: Surfaces
  /**
   * The price lists spend is computed from, one per currency the provider
   * bills in. Replacing it re-prices every session; the shipped default
   * carries DeepSeek's published CNY and USD rates and the date they were
   * read. A deployment may add any currency its provider bills in.
   */
  prices?: PriceTable
}

// No member is `.required()` here: an omitted optional object still resolves
// to `{}`, so requiring a member would make every schedule that declares a
// `multiplier` instead of `rates` fail at load. Presence is
// `resolvePriceTable`'s to enforce, alongside the rules it already owns.
const rates = z.object({
  input: z.number().min(0),
  inputCacheHit: z.number().min(0),
  output: z.number().min(0),
  cacheWrite: z.number().min(0),
  reasoning: z.number().min(0),
})

const window = z.object({
  start: z.string().required(),
  end: z.string().required(),
  days: z.array(z.number().step(1).min(0).max(6)),
})

const schedule = z.object({
  name: z.string().required(),
  windows: z.array(window).required(),
  rates,
  multiplier: z.number().min(0),
})

const entry = z.object({
  model: z.string().required(),
  provider: z.string(),
  per: z.number().min(1).default(1_000_000),
  base: rates.required(),
  baseName: z.string(),
  timezone: z.string().default('UTC'),
  schedules: z.array(schedule).default([]),
})

// The schema's own output type makes every declared key required, while the
// price table's `provider`, `cacheWrite`, `reasoning`, `baseName`, and `days`
// are genuinely optional. The two agree on every value that validates; the
// annotation states that, so the default below and `Config.prices` line up.
const prices = z.object({
  asOf: z.string().required(),
  tables: z.dict(z.object({ entries: z.array(entry).default([]) })).default({}),
}) as unknown as z<PriceTable>

export const Config: z<Config> = z.object({
  refreshMs: z.number().step(1).min(5_000).default(60_000),
  retryMs: z.number().step(1).min(1_000).default(15_000),
  timeoutMs: z.number().step(1).min(1_000).default(8_000),
  currency: z.array(z.string()).default(['CNY', 'USD']),
  lowBalance: z.number().min(0).default(10),
  criticalBalance: z.number().min(0).default(1),
  ledgerDays: z.number().step(1).min(1).default(400),
  timezone: z.string().default(''),
  root: z.string().default(''),
  surfaces: z.object({
    footer: z.boolean().default(true),
    sessionSpend: z.boolean().default(true),
  }).default({ footer: true, sessionSpend: true }),
  prices: prices.default(DEFAULT_PRICES),
}) as z<Config>

/** Configuration after defaults and cross-field checks, with nothing left optional. */
export interface ResolvedConfig {
  refreshMs: number
  retryMs: number
  timeoutMs: number
  currency: readonly string[]
  lowBalance: number
  criticalBalance: number
  ledgerDays: number
  /** The settled timezone; never empty. */
  timezone: string
  /** The settled ledger directory; never empty. */
  root: string
  footer: boolean
  sessionSpend: boolean
  prices: PriceTable
}

/**
 * Undo the schema's materialization of absent optional members.
 *
 * `@deepseek-ai/schemastery` resolves an omitted nested object to `{}` and an
 * omitted array to `[]`, so an absent value and an empty one are the same on
 * the way out. Both are read here as absent, which is the only reading that
 * works: a schedule whose `rates` is `{}` states no rates, and a window whose
 * `days` is `[]` would otherwise open on no day at all.
 * @param table - the schema-validated table.
 * @returns the same table with its empty optional members removed.
 */
export function compactPriceTable(table: PriceTable): PriceTable {
  return {
    ...table,
    tables: Object.fromEntries(Object.entries(table.tables).map(([currency, list]) => [currency, {
      entries: list.entries.map(entry => ({
        ...entry,
        schedules: (entry.schedules ?? []).map((schedule) => {
          const { rates, ...rest } = schedule
          return {
            ...rest,
            ...rates === undefined || Object.keys(rates).length === 0 ? {} : { rates },
            windows: schedule.windows.map((window) => {
              const { days, ...window_ } = window
              return { ...window_, ...days === undefined || days.length === 0 ? {} : { days } }
            }),
          }
        }),
      })),
    }])),
  }
}

/**
 * Settle defaults and reject a configuration this plugin cannot honour.
 * @param config - the schema-validated plugin config.
 * @param homePath - resolves a path under the harness home, for the ledger default.
 * @returns the resolved configuration.
 * @throws {Error} naming the first unusable field.
 */
export function resolveBalanceConfig(
  config: Config,
  homePath: (...segments: string[]) => string,
): ResolvedConfig {
  const timezone = config.timezone === undefined || config.timezone.length === 0
    ? hostTimezone()
    : config.timezone
  if (!isSupportedTimezone(timezone)) {
    throw new Error(`dsh-balance: timezone ${JSON.stringify(timezone)} is not an IANA timezone this runtime knows`)
  }
  const criticalBalance = config.criticalBalance ?? 1
  const lowBalance = config.lowBalance ?? 10
  if (criticalBalance > lowBalance) {
    throw new Error(`dsh-balance: criticalBalance ${String(criticalBalance)} is above lowBalance ${String(lowBalance)}`)
  }
  const currency = config.currency ?? ['CNY', 'USD']
  if (currency.length === 0) throw new Error('dsh-balance: currency must name at least one code')
  return {
    refreshMs: config.refreshMs ?? 60_000,
    retryMs: config.retryMs ?? 15_000,
    timeoutMs: config.timeoutMs ?? 8_000,
    currency,
    lowBalance,
    criticalBalance,
    ledgerDays: config.ledgerDays ?? 400,
    timezone,
    root: config.root === undefined || config.root.length === 0 ? homePath(LEDGER_DIR) : config.root,
    footer: config.surfaces?.footer ?? true,
    sessionSpend: config.surfaces?.sessionSpend ?? true,
    prices: resolvePriceTable(compactPriceTable(config.prices ?? DEFAULT_PRICES)),
  }
}
