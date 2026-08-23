/**
 * Time-of-day price table: the deployment owns the numbers, this module owns
 * the arithmetic.
 *
 * A price table is data. Nothing here fetches a pricing page, and no vendor's
 * tier names or window layout is compiled in: an entry states its base rates
 * and an ordered list of named schedules, each of which claims a set of
 * wall-clock windows in the entry's own IANA timezone and either restates the
 * rates or scales the base by a multiplier. Two tiers, five tiers, weekday and
 * weekend tiers, and a provider with no tiers at all are the same shape.
 *
 * @module @haoran/dsh-balance/prices
 */

/** One rate set, in currency units per {@link PriceEntry.per} tokens. */
export interface PriceRates {
  /** Input tokens the provider did not serve from its prompt cache. */
  input: number
  /** Input tokens served from the provider's prompt cache. */
  inputCacheHit: number
  /** Generated tokens. */
  output: number
  /**
   * Tokens written into the provider's prompt cache. Absent means "billed as
   * {@link PriceRates.input}", which is what a provider that does not price
   * cache writes separately does.
   */
  cacheWrite?: number
  /**
   * Reasoning tokens, when the provider bills them apart from other generated
   * tokens. Absent means "billed as {@link PriceRates.output}".
   */
  reasoning?: number
}

/** A rate set after {@link PriceRates} defaulting, with every field settled. */
export interface ResolvedRates {
  input: number
  inputCacheHit: number
  output: number
  cacheWrite: number
  reasoning: number
}

/**
 * One wall-clock window in its entry's timezone. `end` is exclusive, and a
 * window whose `end` is not after its `start` wraps past midnight — `22:00` to
 * `02:00` is four hours, not twenty.
 */
export interface PriceWindow {
  /** Window start, `HH:MM` in the entry's timezone. */
  start: string
  /** Window end (exclusive), `HH:MM` in the entry's timezone. */
  end: string
  /**
   * Weekdays this window opens on, as JavaScript day numbers: 0 is Sunday
   * through 6 is Saturday. Absent means every day. A wrapping window belongs
   * to the day it starts on, so a Friday `22:00`–`02:00` window covers
   * Saturday's first two hours.
   */
  days?: number[]
}

/** One named tier: when it applies, and what it charges. */
export interface PriceSchedule {
  /** Tier name, shown in the UI (`off-peak`, `weekend`, …). */
  name: string
  /** Windows this tier claims; at least one. */
  windows: PriceWindow[]
  /** Explicit rates for this tier. Mutually exclusive with {@link PriceSchedule.multiplier}. */
  rates?: PriceRates
  /** Factor applied to every base rate. Mutually exclusive with {@link PriceSchedule.rates}. */
  multiplier?: number
}

/** One priced model. */
export interface PriceEntry {
  /** Model id exactly as the harness reports it. */
  model: string
  /**
   * Provider route id, when the deployment prices the same model id
   * differently per provider. Absent matches any provider.
   */
  provider?: string
  /** Tokens one rate unit covers; `1000000` for the usual per-1M rates. */
  per: number
  /** Rates outside every schedule window. */
  base: PriceRates
  /**
   * Name for the base tier in the UI. A provider that publishes its low rate
   * as the standard one and its high rate as a surcharge reads better with
   * `off-peak` here than with the default.
   */
  baseName?: string
  /** IANA timezone the schedule windows are written in. */
  timezone: string
  /** Ordered tiers; the first whose window contains the request time wins. */
  schedules?: PriceSchedule[]
}

/** A complete price table. */
export interface PriceTable {
  /** Date the numbers were transcribed, `YYYY-MM-DD`; shown as "prices as of". */
  asOf: string
  /** ISO 4217 code the rates are quoted in. */
  currency: string
  /** One entry per priced model. */
  entries: PriceEntry[]
}

/** What {@link resolveRates} found for one request. */
export interface ResolvedPrice {
  /** The settled rates that apply at that instant. */
  rates: ResolvedRates
  /** Tokens one rate unit covers. */
  per: number
  /** The tier that applied, or the entry's base-tier name. */
  scheduleName: string
  /** Whether a schedule claimed the instant, as opposed to the base tier. */
  scheduled: boolean
}

/** Token counts for one request, as disjoint billing buckets. */
export interface TokenCounts {
  /** Input tokens billed at the cache-miss rate. */
  input: number
  /** Input tokens billed at the cache-hit rate. */
  cacheRead: number
  /** Tokens billed at the cache-write rate. */
  cacheWrite: number
  /** Generated tokens excluding {@link TokenCounts.reasoning}. */
  output: number
  /** Reasoning tokens, billed at their own rate. */
  reasoning: number
}

/** Default name for the tier outside every schedule window. */
export const DEFAULT_BASE_SCHEDULE_NAME = 'standard'

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Whether a string is an `HH:MM` wall-clock time.
 * @param value - candidate time.
 * @returns true when the value is two-digit hours and minutes in range.
 */
export function isWallClockTime(value: string): boolean {
  return HH_MM.test(value)
}

/**
 * Whether the running engine knows an IANA timezone. Validation calls this so
 * a mistyped zone fails at load rather than silently pricing everything in UTC.
 * @param timezone - candidate IANA zone id.
 * @returns true when `Intl` accepts it.
 */
export function isSupportedTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    // RangeError is the only failure Intl raises for an unknown zone, and the
    // answer for every other input is the same "not usable".
    return false
  }
}

/** Minutes since midnight for an already-validated `HH:MM`. */
function minutesOf(value: string): number {
  const match = HH_MM.exec(value)
  if (match === null) throw new TypeError(`dsh-balance: "${value}" is not an HH:MM time`)
  return Number(match[1]) * 60 + Number(match[2])
}

/** Wall-clock day number and minute-of-day at one instant in one timezone. */
interface WallClock {
  /** JavaScript day number, 0 for Sunday. */
  day: number
  /** Minutes since local midnight. */
  minutes: number
}

const DAY_NUMBERS: Readonly<Record<string, number>> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

/**
 * One formatter per timezone, kept for the process.
 *
 * Constructing an `Intl.DateTimeFormat` costs far more than formatting with
 * one, and this runs once per priced step — a projection replaying a long
 * session's log calls it thousands of times. The formatters are immutable and
 * the key space is the configured zones, so the cache is bounded by the price
 * table.
 */
const CLOCK_FORMATS = new Map<string, Intl.DateTimeFormat>()

/** The wall-clock formatter for one timezone. */
function clockFormat(timezone: string): Intl.DateTimeFormat {
  let format = CLOCK_FORMATS.get(timezone)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    CLOCK_FORMATS.set(timezone, format)
  }
  return format
}

/**
 * Project one instant onto a timezone's wall clock.
 * @param atMs - the instant, in epoch milliseconds.
 * @param timezone - IANA zone id, already known to be supported.
 * @returns the local weekday and minute of day.
 */
export function wallClockAt(atMs: number, timezone: string): WallClock {
  const parts = clockFormat(timezone).formatToParts(new Date(atMs))
  let day = 0
  let hour = 0
  let minute = 0
  for (const part of parts) {
    if (part.type === 'weekday') day = DAY_NUMBERS[part.value] ?? 0
    if (part.type === 'hour') hour = Number(part.value)
    if (part.type === 'minute') minute = Number(part.value)
  }
  return { day, minutes: hour * 60 + minute }
}

/**
 * Whether one window is open at a local wall-clock position.
 *
 * A wrapping window is anchored to the day it opens on, so the `days` filter
 * is tested against the previous day once the instant has passed midnight.
 * @param window - the window to test.
 * @param at - local weekday and minute of day.
 * @returns true when the window covers that position.
 */
export function windowContains(window: PriceWindow, at: WallClock): boolean {
  const start = minutesOf(window.start)
  const end = minutesOf(window.end)
  const allows = (day: number): boolean => window.days === undefined || window.days.includes(day)
  if (start < end) return at.minutes >= start && at.minutes < end && allows(at.day)
  // Wrapping: the tail before `end` belongs to the window that opened yesterday.
  if (at.minutes >= start) return allows(at.day)
  if (at.minutes < end) return allows((at.day + 6) % 7)
  return false
}

/** Settle a rate set's optional fields. */
function settle(rates: PriceRates): ResolvedRates {
  return {
    input: rates.input,
    inputCacheHit: rates.inputCacheHit,
    output: rates.output,
    cacheWrite: rates.cacheWrite ?? rates.input,
    reasoning: rates.reasoning ?? rates.output,
  }
}

/** Scale a settled rate set. */
function scale(rates: ResolvedRates, multiplier: number): ResolvedRates {
  return {
    input: rates.input * multiplier,
    inputCacheHit: rates.inputCacheHit * multiplier,
    output: rates.output * multiplier,
    cacheWrite: rates.cacheWrite * multiplier,
    reasoning: rates.reasoning * multiplier,
  }
}

/** What identifies the model whose rates are wanted. */
export interface PriceSubject {
  /** Provider route id, when the observation carried one. */
  provider?: string
  /** Model id, exactly as the harness reported it. */
  model: string
}

/**
 * Find the rates that apply to one request.
 *
 * An entry naming a provider matches only that provider, and is preferred over
 * an entry for the same model that names none, so a deployment can price one
 * route apart without restating the others.
 * @param table - the resolved price table.
 * @param subject - the provider route and model of the request.
 * @param atMs - the request instant, in epoch milliseconds.
 * @returns the applicable rates, or `null` when the table prices no such model.
 */
export function resolveRates(
  table: PriceTable,
  subject: PriceSubject,
  atMs: number,
): ResolvedPrice | null {
  let fallback: PriceEntry | undefined
  let exact: PriceEntry | undefined
  for (const entry of table.entries) {
    if (entry.model !== subject.model) continue
    if (entry.provider === undefined) fallback ??= entry
    else if (entry.provider === subject.provider) exact ??= entry
  }
  const entry = exact ?? fallback
  if (entry === undefined) return null
  const base = settle(entry.base)
  const at = wallClockAt(atMs, entry.timezone)
  for (const schedule of entry.schedules ?? []) {
    if (!schedule.windows.some(window => windowContains(window, at))) continue
    const rates = schedule.rates === undefined
      ? scale(base, schedule.multiplier ?? 1)
      : settle(schedule.rates)
    return { rates, per: entry.per, scheduleName: schedule.name, scheduled: true }
  }
  return {
    rates: base,
    per: entry.per,
    scheduleName: entry.baseName ?? DEFAULT_BASE_SCHEDULE_NAME,
    scheduled: false,
  }
}

/**
 * Price one request's token counts.
 * @param usage - disjoint billing buckets for the request.
 * @param rates - the settled rates that applied.
 * @param per - tokens one rate unit covers.
 * @returns the cost in the table's currency.
 */
export function costOf(usage: TokenCounts, rates: ResolvedRates, per: number): number {
  const units
    = usage.input * rates.input
      + usage.cacheRead * rates.inputCacheHit
      + usage.cacheWrite * rates.cacheWrite
      + usage.output * rates.output
      + usage.reasoning * rates.reasoning
  return units / per
}

/**
 * Validate a price table's cross-field rules and reject a table this module
 * cannot price with. The schema behind `cordis.yml` settles types and
 * defaults; these are the rules a per-field schema cannot state.
 * @param table - the schema-validated table.
 * @param subject - diagnostic prefix naming the config path.
 * @returns the same table, once every rule holds.
 * @throws {Error} naming the first entry, schedule, or window that is unusable.
 */
export function resolvePriceTable(table: PriceTable, subject = 'dsh-balance: prices'): PriceTable {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(table.asOf)) {
    throw new Error(`${subject}.asOf must be a YYYY-MM-DD date, received ${JSON.stringify(table.asOf)}`)
  }
  if (table.currency.length === 0) throw new Error(`${subject}.currency must not be empty`)
  const seen = new Set<string>()
  for (const entry of table.entries) {
    const where = `${subject} entry ${JSON.stringify(entry.provider === undefined ? entry.model : `${entry.provider}/${entry.model}`)}`
    if (entry.model.length === 0) throw new Error(`${subject} has an entry with an empty model id`)
    const key = `${entry.provider ?? ''} ${entry.model}`
    if (seen.has(key)) throw new Error(`${where} is declared twice`)
    seen.add(key)
    if (!Number.isFinite(entry.per) || entry.per <= 0) throw new Error(`${where}.per must be a positive number`)
    if (!isSupportedTimezone(entry.timezone)) {
      throw new Error(`${where}.timezone ${JSON.stringify(entry.timezone)} is not an IANA timezone this runtime knows`)
    }
    assertRates(entry.base, `${where}.base`)
    for (const schedule of entry.schedules ?? []) {
      const scheduleWhere = `${where} schedule ${JSON.stringify(schedule.name)}`
      if (schedule.name.length === 0) throw new Error(`${where} has a schedule with an empty name`)
      if ((schedule.rates === undefined) === (schedule.multiplier === undefined)) {
        throw new Error(`${scheduleWhere} must declare exactly one of rates or multiplier`)
      }
      if (schedule.multiplier !== undefined && (!Number.isFinite(schedule.multiplier) || schedule.multiplier < 0)) {
        throw new Error(`${scheduleWhere}.multiplier must be a non-negative number`)
      }
      if (schedule.rates !== undefined) assertRates(schedule.rates, `${scheduleWhere}.rates`)
      if (schedule.windows.length === 0) throw new Error(`${scheduleWhere}.windows must not be empty`)
      for (const window of schedule.windows) {
        if (!isWallClockTime(window.start) || !isWallClockTime(window.end)) {
          throw new Error(`${scheduleWhere} has a window that is not HH:MM: ${window.start}-${window.end}`)
        }
        if (window.start === window.end) {
          throw new Error(`${scheduleWhere} has an empty window ${window.start}-${window.end}; use 00:00-24:00 semantics by splitting the day or omit the window`)
        }
        for (const day of window.days ?? []) {
          if (!Number.isInteger(day) || day < 0 || day > 6) {
            throw new Error(`${scheduleWhere} has a window day ${String(day)} outside 0 (Sunday) through 6 (Saturday)`)
          }
        }
      }
    }
  }
  return table
}

/** Reject a rate set missing a required member, or carrying a negative or non-finite one. */
function assertRates(rates: PriceRates, where: string): void {
  for (const field of ['input', 'inputCacheHit', 'output'] as const) {
    if (rates[field] === undefined) throw new Error(`${where}.${field} is required`)
  }
  for (const [field, value] of Object.entries(rates)) {
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${where}.${field} must be a non-negative number`)
    }
  }
}
