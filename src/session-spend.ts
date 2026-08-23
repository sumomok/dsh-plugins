/**
 * Per-session spend as a pure fold over the session's own logged usage.
 *
 * The harness already writes what one step cost in tokens; this unit multiplies
 * it by the deployment's price table and adds it up. It appends nothing, reads
 * nothing outside the event it is handed, and performs no I/O — the projection
 * registry replays it over a session's durable log and caches the result.
 *
 * @module @haoran/dsh-balance/session-spend
 */

import { z } from 'zod'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { costOf, resolveRates, type PriceTable, type TokenCounts } from './prices.ts'
import type { SessionSpend, SessionSpendModel } from './types.ts'

/** The projection key this plugin owns. */
export const SESSION_SPEND_KEY = 'balanceSessionSpend'

/**
 * A projection unit with a client view. The registry's client-visible overload
 * requires `wire`, which {@link ProjectionDefinition} leaves optional for
 * host-only units.
 */
export type ClientVisibleProjection =
  Omit<ProjectionDefinition<typeof SESSION_SPEND_KEY, SessionSpendState>, 'wire'>
  & { wire: NonNullable<ProjectionDefinition<typeof SESSION_SPEND_KEY, SessionSpendState>['wire']> }

/** Fold state; plain JSON, as the projection cache requires. */
export interface SessionSpendState {
  /** Cost of every priced step so far. */
  total: number
  /** Per-model token buckets and cost. */
  byModel: Record<string, SessionSpendModel>
  /** Cost split by the price tier that applied to each step. */
  bySchedule: Record<string, number>
  /** Tokens no entry in the table prices. */
  unpricedTokens: number
  /** Assistant steps folded, priced or not. */
  steps: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** `@haoran/dsh-balance` per-session spend fold state. */
    balanceSessionSpend: SessionSpendState
  }
  interface SessionProjectionMap {
    /** `@haoran/dsh-balance` per-session spend, priced from the deployment's table. */
    balanceSessionSpend: SessionSpend
  }
}

const modelSchema = z.object({
  input: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  output: z.number().nonnegative(),
  reasoning: z.number().nonnegative(),
  cost: z.number().nonnegative(),
}).strict()

const stateSchema = z.object({
  total: z.number().nonnegative(),
  byModel: z.record(z.string(), modelSchema),
  bySchedule: z.record(z.string(), z.number().nonnegative()),
  unpricedTokens: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
}).strict()

const viewSchema = z.object({
  total: z.number().nonnegative(),
  currency: z.string(),
  byModel: z.record(z.string(), modelSchema),
  bySchedule: z.record(z.string(), z.number().nonnegative()),
  unpricedTokens: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
}).strict()

/**
 * Split one step's provider accounting into disjoint billing buckets.
 *
 * `TokenUsage` counts are already disjoint on the input side — `inputTokens`
 * excludes cache traffic — but `reasoningTokens` is a subset of
 * `outputTokens`, so the generated bucket has it taken back out; a provider
 * pricing reasoning at the output rate then reaches the same total either way.
 * @param usage - the step's provider-reported accounting.
 * @returns the buckets {@link costOf} multiplies.
 */
export function billingBuckets(usage: TokenUsage): TokenCounts {
  const reasoning = usage.reasoningTokens ?? 0
  return {
    input: usage.inputTokens,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    output: Math.max(0, usage.outputTokens - reasoning),
    reasoning,
  }
}

/** Every token in one step, priced or not. */
export function totalTokens(counts: TokenCounts): number {
  return counts.input + counts.cacheRead + counts.cacheWrite + counts.output + counts.reasoning
}

/** What one priced step contributes. */
export interface PricedStep {
  /** Cost of the step, or `null` when the table prices no such model. */
  cost: number | null
  /** The tier that priced it; absent when unpriced. */
  scheduleName?: string
  /** The step's disjoint token buckets. */
  counts: TokenCounts
}

/**
 * Price one step.
 * @param table - the resolved price table.
 * @param subject - the provider route and model the step ran on.
 * @param atMs - the step's logged time, in epoch milliseconds.
 * @param usage - the step's provider-reported accounting.
 * @returns the cost and tier, or an unpriced verdict.
 */
export function priceStep(
  table: PriceTable,
  subject: { provider?: string; model: string },
  atMs: number,
  usage: TokenUsage,
): PricedStep {
  const counts = billingBuckets(usage)
  const price = resolveRates(table, subject, atMs)
  if (price === null) return { cost: null, counts }
  return { cost: costOf(counts, price.rates, price.per), scheduleName: price.scheduleName, counts }
}

/** An empty per-model row. */
function emptyModel(): SessionSpendModel {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, cost: 0 }
}

/**
 * Build the projection unit for one price table.
 *
 * `stateVersion` is derived from the table itself: a persisted fold was
 * computed at the rates that were configured then, so changing a rate must
 * discard it rather than continue adding to it. Editing the table in
 * `cordis.yml` therefore re-prices every session on next read.
 * @param table - the resolved price table.
 * @param currency - the table's currency, restated on the wire.
 * @returns the registrable projection definition.
 */
export function sessionSpendProjection(
  table: PriceTable,
  currency: string,
): ClientVisibleProjection {
  return {
    key: SESSION_SPEND_KEY,
    stateVersion: priceTableVersion(table),
    stateSchema,
    init: () => ({ total: 0, byModel: {}, bySchedule: {}, unpricedTokens: 0, steps: 0 }),
    apply: (state, event: SessionEvent) => {
      if (event.type !== 'assistant/message') return state
      const { usage, message } = event.data
      if (usage === undefined) return state
      const { provider, model } = message.source
      const priced = priceStep(table, { provider, model }, event.time, usage)
      const steps = state.steps + 1
      if (priced.cost === null) {
        return { ...state, steps, unpricedTokens: state.unpricedTokens + totalTokens(priced.counts) }
      }
      const previous = state.byModel[model] ?? emptyModel()
      const schedule = priced.scheduleName ?? ''
      return {
        total: state.total + priced.cost,
        steps,
        unpricedTokens: state.unpricedTokens,
        bySchedule: { ...state.bySchedule, [schedule]: (state.bySchedule[schedule] ?? 0) + priced.cost },
        byModel: {
          ...state.byModel,
          [model]: {
            input: previous.input + priced.counts.input,
            cacheRead: previous.cacheRead + priced.counts.cacheRead,
            cacheWrite: previous.cacheWrite + priced.counts.cacheWrite,
            output: previous.output + priced.counts.output,
            reasoning: previous.reasoning + priced.counts.reasoning,
            cost: previous.cost + priced.cost,
          },
        },
      }
    },
    wire: {
      viewSchema,
      view: state => ({ ...state, currency }),
    },
  }
}

/**
 * A stable non-negative integer identifying one price table's contents, used
 * as the projection's cache-invalidation version.
 * @param table - the resolved price table.
 * @returns a 31-bit FNV-1a hash of its canonical JSON.
 */
export function priceTableVersion(table: PriceTable): number {
  const text = JSON.stringify(table)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 1
}
