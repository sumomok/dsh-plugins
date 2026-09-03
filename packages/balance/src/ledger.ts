/**
 * The spend ledger: one line per priced LLM request, and the day/month/all-time
 * totals read off it.
 *
 * The file holds numbers and identifiers, never prompts, completions, API keys,
 * or endpoints. Its directory is created `0o700` and the file `0o600`, and it
 * is compacted to the retention window at startup, so it neither grows without
 * bound nor becomes a second copy of the conversation.
 *
 * It lives in a directory of this plugin's own under the harness home —
 * `$DSH_HOME/dsh-balance/` by default, following the `llm-deepseek` precedent
 * of a plugin-named directory. `$DSH_HOME/storages/` deliberately is not used:
 * that root belongs to the `storage-json` backend, whose children are
 * `<unit>.json` files rather than per-plugin directories.
 *
 * Aggregates are kept per provider, per currency, and per local day rather
 * than per row: the day buckets are bounded by the retention window, so memory
 * does not grow with the number of requests and startup never holds the whole
 * file. Rows priced in one currency are never folded into another's total — a
 * deployment that switches price lists sees its new currency start from zero
 * rather than inheriting a number in the old one — and rows of one provider
 * are never folded into another's: the totals read for a provider are what
 * that route alone cost, so the figure under a provider's balance is its own.
 * A row that recorded no provider (a request whose source named none) counts
 * under the empty provider id, which no picker entry reads.
 *
 * @module @sumomok/dsh-balance/ledger
 */

import { createReadStream } from 'node:fs'
import { appendFile, mkdir, open as openFile, rename, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import type { BalanceUiConfig, SpendTotals, SpendView } from './types.ts'

/** One request's row, exactly as a line of the JSONL file. */
export interface LedgerRow {
  /** Epoch milliseconds of the request. */
  t: number
  /** Session the request belonged to. */
  sessionId: string
  /** The session-log sequence number of the step this row records. */
  seq: number
  /** Model id the request ran on. */
  model: string
  /** Provider route, when the observation carried one. */
  provider?: string
  /** Input tokens billed at the cache-miss rate. */
  input: number
  /** Input tokens billed at the cache-hit rate. */
  cacheRead: number
  /** Tokens billed at the cache-write rate. */
  cacheWrite: number
  /** Generated tokens excluding reasoning. */
  output: number
  /** Reasoning tokens. */
  reasoning: number
  /** Cost of the request; `0` on an unpriced row. */
  cost: number
  /** ISO 4217 code `cost` is quoted in. */
  currency: string
  /** Price tier that applied; empty on an unpriced row. */
  schedule: string
  /** Present only when the price table priced no rate for this model. */
  unpriced?: true
}

/** Directory name under the harness home this plugin owns. */
export const LEDGER_DIR = 'dsh-balance'

/** File name under {@link LEDGER_DIR}. */
export const LEDGER_FILE = 'ledger.jsonl'

/** Owner-only file mode; the ledger is a record of one machine's own spend. */
export const LEDGER_MODE = 0o600

/** Owner-only directory mode, matching every other harness-home directory. */
export const LEDGER_DIR_MODE = 0o700

/** How much retained text compaction buffers before each write. */
const COMPACT_CHUNK_BYTES = 1 << 20

/**
 * Narrow one parsed JSONL line to a row.
 * @param value - the parsed line.
 * @returns the row, or `null` when a required field is missing or mistyped.
 */
export function parseLedgerRow(value: unknown): LedgerRow | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  for (const field of ['t', 'seq', 'input', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'cost'] as const) {
    if (typeof row[field] !== 'number' || !Number.isFinite(row[field])) return null
  }
  for (const field of ['sessionId', 'model', 'currency', 'schedule'] as const) {
    if (typeof row[field] !== 'string') return null
  }
  if (row.provider !== undefined && typeof row.provider !== 'string') return null
  return {
    t: row.t as number,
    sessionId: row.sessionId as string,
    seq: row.seq as number,
    model: row.model as string,
    ...row.provider === undefined ? {} : { provider: row.provider as string },
    input: row.input as number,
    cacheRead: row.cacheRead as number,
    cacheWrite: row.cacheWrite as number,
    output: row.output as number,
    reasoning: row.reasoning as number,
    cost: row.cost as number,
    currency: row.currency as string,
    schedule: row.schedule as string,
    ...row.unpriced === true ? { unpriced: true as const } : {},
  }
}

/** One currency's aggregates: per local day, plus the whole retained window. */
interface CurrencyAggregate {
  /** Totals by local day key. */
  days: Map<string, SpendTotals>
  /** Totals across every retained row in this currency. */
  allTime: SpendTotals
  /** Epoch milliseconds of the oldest retained row in this currency. */
  oldest: number | null
}

/** An empty period. */
function emptyTotals(): SpendTotals {
  return { cost: 0, bySchedule: {}, requests: 0, unpricedTokens: 0 }
}

/** Fold one row into a period in place. */
function addRow(totals: SpendTotals, row: LedgerRow): void {
  totals.requests += 1
  if (row.unpriced === true) {
    totals.unpricedTokens += row.input + row.cacheRead + row.cacheWrite + row.output + row.reasoning
    return
  }
  totals.cost += row.cost
  totals.bySchedule[row.schedule] = (totals.bySchedule[row.schedule] ?? 0) + row.cost
}

/** Merge one period into another in place. */
function mergeTotals(into: SpendTotals, from: SpendTotals): void {
  into.cost += from.cost
  into.requests += from.requests
  into.unpricedTokens += from.unpricedTokens
  for (const [schedule, cost] of Object.entries(from.bySchedule)) {
    into.bySchedule[schedule] = (into.bySchedule[schedule] ?? 0) + cost
  }
}

/**
 * One formatter per timezone, kept for the process. Constructing an
 * `Intl.DateTimeFormat` costs far more than formatting with one, and startup
 * calls this once per ledger row.
 */
const DAY_FORMATS = new Map<string, Intl.DateTimeFormat>()

/** The calendar-day formatter for one timezone. */
function dayFormat(timezone: string): Intl.DateTimeFormat {
  let format = DAY_FORMATS.get(timezone)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    DAY_FORMATS.set(timezone, format)
  }
  return format
}

/**
 * The local calendar day one instant falls in.
 * @param atMs - the instant, in epoch milliseconds.
 * @param timezone - IANA zone the day boundary is taken in.
 * @returns the day as `YYYY-MM-DD`.
 */
export function dayKey(atMs: number, timezone: string): string {
  const parts = dayFormat(timezone).formatToParts(new Date(atMs))
  let year = ''
  let month = ''
  let day = ''
  for (const part of parts) {
    if (part.type === 'year') year = part.value
    if (part.type === 'month') month = part.value
    if (part.type === 'day') day = part.value
  }
  return `${year}-${month}-${day}`
}

/** The timezone the host runs in, used when the deployment names none. */
export function hostTimezone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** What a ledger needs from its environment. */
export interface LedgerOptions {
  /** Absolute path of the JSONL file. */
  file: string
  /** Epoch milliseconds. */
  now: () => number
  /** IANA zone the day and month boundaries are taken in. */
  timezone: string
  /** Days of rows to keep; older rows are dropped at startup. */
  retentionDays: number
  /** The price table's `asOf` date, restated on the wire. */
  pricesAsOf: string
  /** Display facts the deployment configured, restated on the wire. */
  ui: BalanceUiConfig
}

/**
 * The append-only spend ledger and its in-memory aggregates.
 *
 * {@link Ledger.open} must run before any read; it builds the day buckets and
 * compacts the file to the retention window.
 */
export class Ledger {
  private options: LedgerOptions
  private readonly byProvider = new Map<string, Map<string, CurrencyAggregate>>()
  /** Serializes appends so two concurrent requests cannot interleave a line. */
  private writes = Promise.resolve()

  /**
   * @param options - file location, clock, timezone, retention, and labels.
   */
  constructor(options: LedgerOptions) {
    this.options = options
  }

  /**
   * Replace the display facts a live settings change supplies fresh — the
   * balance-coloring thresholds and which footer/session-spend
   * surfaces are on. File location, clock, timezone, and retention stay fixed
   * for this ledger's lifetime; only `ui` is ever settings-editable after
   * construction.
   * @param ui - the freshly resolved display facts.
   */
  setUi(ui: BalanceUiConfig): void {
    this.options = { ...this.options, ui }
  }

  /**
   * Load the ledger, dropping and rewriting rows past the retention window.
   *
   * Two streaming passes rather than one buffered pass: the first folds the
   * aggregates and counts what retention drops, and the second — which runs
   * only when something was dropped — copies the survivors to a new file.
   * Holding the retained lines from the first pass would instead put the whole
   * file in memory to serve the uncommon case.
   *
   * A malformed line is skipped rather than fatal: the file is appended to by a
   * long-running process, so a truncated final line after a hard kill must not
   * make every later read fail.
   * @returns the number of rows retained.
   */
  async open(): Promise<number> {
    await mkdir(dirname(this.options.file), { recursive: true, mode: LEDGER_DIR_MODE })
    const exists = await stat(this.options.file).then(() => true, () => false)
    if (!exists) {
      await writeFile(this.options.file, '', { mode: LEDGER_MODE })
      return 0
    }
    const cutoff = this.options.now() - this.options.retentionDays * 86_400_000
    let dropped = 0
    let retained = 0
    for await (const [, row] of this.lines()) {
      if (row === null || row.t < cutoff) {
        dropped += 1
        continue
      }
      this.fold(row)
      retained += 1
    }
    if (dropped > 0) await this.compact(cutoff)
    return retained
  }

  /** Stream the file as `[line, parsed]` pairs; an unparseable line pairs with `null`. */
  private async* lines(): AsyncGenerator<[string, LedgerRow | null]> {
    const stream = createInterface({
      input: createReadStream(this.options.file, 'utf8'),
      crlfDelay: Infinity,
    })
    for await (const line of stream) {
      if (line.length === 0) continue
      try {
        yield [line, parseLedgerRow(JSON.parse(line))]
      } catch {
        // A partially written final line is the expected shape of this failure.
        yield [line, null]
      }
    }
  }

  /**
   * Rewrite the file with the rows inside the retention window, in chunks so
   * neither the survivors nor the discarded rows are ever all in memory.
   */
  private async compact(cutoff: number): Promise<void> {
    const temporary = `${this.options.file}.compact`
    const handle = await openFile(temporary, 'w', LEDGER_MODE)
    try {
      let chunk = ''
      for await (const [line, row] of this.lines()) {
        if (row === null || row.t < cutoff) continue
        chunk += `${line}\n`
        if (chunk.length >= COMPACT_CHUNK_BYTES) {
          await handle.write(chunk)
          chunk = ''
        }
      }
      if (chunk.length > 0) await handle.write(chunk)
    } finally {
      await handle.close()
    }
    await rename(temporary, this.options.file)
  }

  /**
   * Append one row and fold it into the aggregates.
   * @param row - the request to record.
   */
  async append(row: LedgerRow): Promise<void> {
    this.fold(row)
    const line = `${JSON.stringify(row)}\n`
    this.writes = this.writes.then(
      () => appendFile(this.options.file, line, { mode: LEDGER_MODE }),
      () => appendFile(this.options.file, line, { mode: LEDGER_MODE }),
    )
    return this.writes
  }

  /**
   * Current day, month, and all-time spend of one provider in one currency.
   * @param currency - the ISO 4217 code of the active price list; rows priced
   * in any other currency are not counted.
   * @param provider - the provider id whose rows are counted; a provider with
   * no rows reads as zero.
   * @returns the view the footer popover renders.
   */
  spend(currency: string, provider: string): SpendView {
    const aggregate = this.byProvider.get(provider)?.get(currency)
    const today = dayKey(this.options.now(), this.options.timezone)
    const month = today.slice(0, 7)
    const dayTotals = emptyTotals()
    const monthTotals = emptyTotals()
    const allTime = emptyTotals()
    if (aggregate !== undefined) {
      for (const [key, totals] of aggregate.days) {
        if (key === today) mergeTotals(dayTotals, totals)
        if (key.startsWith(month)) mergeTotals(monthTotals, totals)
      }
      mergeTotals(allTime, aggregate.allTime)
    }
    return {
      provider,
      today: dayTotals,
      month: monthTotals,
      allTime,
      since: aggregate?.oldest ?? null,
      currency,
      pricesAsOf: this.options.pricesAsOf,
      timezone: this.options.timezone,
      ui: this.options.ui,
    }
  }

  /** ISO 4217 codes this ledger holds rows for, across every provider. */
  currencies(): readonly string[] {
    const codes = new Set<string>()
    for (const byCurrency of this.byProvider.values()) for (const code of byCurrency.keys()) codes.add(code)
    return [...codes].sort()
  }

  /** Fold one row into its provider's and currency's day bucket and all-time totals. */
  private fold(row: LedgerRow): void {
    const provider = row.provider ?? ''
    let byCurrency = this.byProvider.get(provider)
    if (byCurrency === undefined) {
      byCurrency = new Map()
      this.byProvider.set(provider, byCurrency)
    }
    let aggregate = byCurrency.get(row.currency)
    if (aggregate === undefined) {
      aggregate = { days: new Map(), allTime: emptyTotals(), oldest: null }
      byCurrency.set(row.currency, aggregate)
    }
    const key = dayKey(row.t, this.options.timezone)
    let bucket = aggregate.days.get(key)
    if (bucket === undefined) {
      bucket = emptyTotals()
      aggregate.days.set(key, bucket)
    }
    addRow(bucket, row)
    addRow(aggregate.allTime, row)
    if (aggregate.oldest === null || row.t < aggregate.oldest) aggregate.oldest = row.t
  }

}

/**
 * The ledger file inside one plugin-owned root.
 * @param root - the plugin's directory, `$DSH_HOME/dsh-balance` by default.
 * @returns the absolute path of the JSONL ledger.
 */
export function ledgerPath(root: string): string {
  return join(root, LEDGER_FILE)
}
