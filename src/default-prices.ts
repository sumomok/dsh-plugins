/**
 * The price tables this plugin ships with, transcribed from DeepSeek's own
 * pricing pages — one currency each, because DeepSeek bills two and publishes
 * a separate list for each.
 *
 * Sources, both read 2026-08-23:
 *
 * - CNY: https://api-docs.deepseek.com/zh-cn/quick_start/pricing, which states
 *   「空闲时段价格为高峰时段价格的一半。高峰时段为北京时间周一至周五 9:00 -
 *   12:00、14:00 - 18:00（其余为空闲时段）。」
 * - USD: https://api-docs.deepseek.com/quick_start/pricing, which states
 *   "Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00
 *   and 06:00 - 10:00 UTC, Monday through Friday (all other hours are
 *   off-peak)."
 *
 * The two pages describe the same instants in their own timezones — 09:00
 * Beijing is 01:00 UTC — and each list is written in the zone its own page
 * uses rather than converted, so a reader can check either against its source.
 *
 * Both are expressed as the off-peak numbers in `base` plus a `peak` schedule
 * that doubles them, because the peak windows are two contiguous weekday spans
 * while the off-peak hours are their scattered complement. The resulting rates
 * are identical either way; `baseName: 'off-peak'` keeps the UI honest about
 * which tier the base is.
 *
 * Neither page prices cache-write tokens or reasoning tokens separately, so
 * both fields are left to their defaults: a cache write bills at the cache-miss
 * input rate and a reasoning token bills at the output rate.
 *
 * These numbers are the deployment's to maintain, and the currency set is
 * open — adding a third list is a third key under `tables`. Overriding
 * `prices` in `cordis.yml` replaces the whole table.
 *
 * @module @sumomok/dsh-balance/default-prices
 */

import type { PriceEntry, PriceTable, PriceRates, PriceSchedule } from './prices.ts'

/** Provider route id `@deepseek-ai/dsh-llm-deepseek` registers. */
const DEEPSEEK_PROVIDER = 'deepseek-official'

/** Peak surcharge windows as the Chinese page writes them, in Beijing time. */
const PEAK_BEIJING: PriceSchedule = {
  name: 'peak',
  multiplier: 2,
  windows: [
    { start: '09:00', end: '12:00', days: [1, 2, 3, 4, 5] },
    { start: '14:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  ],
}

/** The same instants as the English page writes them, in UTC. */
const PEAK_UTC: PriceSchedule = {
  name: 'peak',
  multiplier: 2,
  windows: [
    { start: '01:00', end: '04:00', days: [1, 2, 3, 4, 5] },
    { start: '06:00', end: '10:00', days: [1, 2, 3, 4, 5] },
  ],
}

/** One DeepSeek model's off-peak entry in one currency. */
function entry(model: string, timezone: string, peak: PriceSchedule, base: PriceRates): PriceEntry {
  return {
    model,
    provider: DEEPSEEK_PROVIDER,
    per: 1_000_000,
    timezone,
    baseName: 'off-peak',
    base,
    schedules: [peak],
  }
}

/** DeepSeek's published rates as of {@link DEFAULT_PRICES}.asOf, per 1M tokens. */
export const DEFAULT_PRICES: PriceTable = {
  asOf: '2026-08-23',
  tables: {
    CNY: {
      entries: [
        entry('deepseek-v4-flash', 'Asia/Shanghai', PEAK_BEIJING, { input: 1.5, inputCacheHit: 0.05, output: 4.5 }),
        entry('deepseek-v4-pro', 'Asia/Shanghai', PEAK_BEIJING, { input: 4.5, inputCacheHit: 0.15, output: 13.5 }),
        entry('deepseek-v4-flash-vision-exp', 'Asia/Shanghai', PEAK_BEIJING, { input: 1.5, inputCacheHit: 0.05, output: 4.5 }),
      ],
    },
    USD: {
      entries: [
        entry('deepseek-v4-flash', 'UTC', PEAK_UTC, { input: 0.22, inputCacheHit: 0.007, output: 0.66 }),
        entry('deepseek-v4-pro', 'UTC', PEAK_UTC, { input: 0.66, inputCacheHit: 0.022, output: 1.98 }),
        entry('deepseek-v4-flash-vision-exp', 'UTC', PEAK_UTC, { input: 0.22, inputCacheHit: 0.007, output: 0.66 }),
      ],
    },
  },
}
