/**
 * The price table this plugin ships with, transcribed from DeepSeek's official
 * pricing page.
 *
 * Source: https://api-docs.deepseek.com/quick_start/pricing, read 2026-08-23.
 * The page quotes USD per 1M tokens for three models, with a cache-hit and a
 * cache-miss input rate each, and states: "Off-peak rates are half of the peak
 * rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through
 * Friday (all other hours are off-peak)."
 *
 * That rule is written here as the off-peak numbers in `base` plus a `peak`
 * schedule that doubles them, because the peak windows are two contiguous
 * weekday spans while the off-peak hours are their scattered complement. The
 * resulting rates are identical either way; `baseName: 'off-peak'` keeps the
 * UI honest about which tier the base is.
 *
 * The page prices no cache-write tokens and no reasoning tokens separately, so
 * both fields are left to their defaults: a cache write bills at the cache-miss
 * input rate and a reasoning token bills at the output rate.
 *
 * These numbers are the deployment's to maintain. Overriding `prices` in
 * `cordis.yml` replaces this table wholesale.
 *
 * @module @haoran/dsh-balance/default-prices
 */

import type { PriceTable } from './prices.ts'

/** Provider route id `@deepseek-ai/dsh-llm-deepseek` registers. */
const DEEPSEEK_PROVIDER = 'deepseek-official'

/** Peak surcharge windows, in UTC, Monday through Friday. */
const PEAK_WINDOWS = [
  { start: '01:00', end: '04:00', days: [1, 2, 3, 4, 5] },
  { start: '06:00', end: '10:00', days: [1, 2, 3, 4, 5] },
]

/** DeepSeek's published rates as of {@link DEFAULT_PRICES}.asOf, in USD per 1M tokens. */
export const DEFAULT_PRICES: PriceTable = {
  asOf: '2026-08-23',
  currency: 'USD',
  entries: [
    {
      model: 'deepseek-v4-flash',
      provider: DEEPSEEK_PROVIDER,
      per: 1_000_000,
      timezone: 'UTC',
      baseName: 'off-peak',
      base: { input: 0.22, inputCacheHit: 0.007, output: 0.66 },
      schedules: [{ name: 'peak', multiplier: 2, windows: PEAK_WINDOWS }],
    },
    {
      model: 'deepseek-v4-pro',
      provider: DEEPSEEK_PROVIDER,
      per: 1_000_000,
      timezone: 'UTC',
      baseName: 'off-peak',
      base: { input: 0.66, inputCacheHit: 0.022, output: 1.98 },
      schedules: [{ name: 'peak', multiplier: 2, windows: PEAK_WINDOWS }],
    },
    {
      model: 'deepseek-v4-flash-vision-exp',
      provider: DEEPSEEK_PROVIDER,
      per: 1_000_000,
      timezone: 'UTC',
      baseName: 'off-peak',
      base: { input: 0.22, inputCacheHit: 0.007, output: 0.66 },
      schedules: [{ name: 'peak', multiplier: 2, windows: PEAK_WINDOWS }],
    },
  ],
}
