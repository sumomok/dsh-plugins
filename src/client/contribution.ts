/**
 * The browser half's Typert contribution: the consumer-side mirror of
 * `../typert.ts`.
 *
 * Each descriptor must match the host manifest's invocation exactly — same id,
 * namespace, method, and parameter wire names — because the gateway matches
 * arguments by field name. The codecs are hand-written narrowings rather than a
 * schema library: this file is bundled into the browser and a validator's
 * bytes would ride into every page load for two small reads.
 *
 * @module @haoran/dsh-balance/client/contribution
 */

import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { BalanceView, SpendTotals, SpendView } from '../types.ts'

/** A consumer-side codec: everything the gateway needs is `parse`. */
interface Codec<T> {
  parse(value: unknown): T
}

/** Reject a value the host should never have sent. */
function fail(path: string, expected: string): never {
  throw new Error(`@haoran/dsh-balance: host returned an unusable ${path} (expected ${expected})`)
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'object')
  return value as Record<string, unknown>
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'number')
  return value
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'string')
  return value
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'boolean')
  return value
}

function asNumberRecord(value: unknown, path: string): Record<string, number> {
  const record = asRecord(value, path)
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(record)) out[key] = asNumber(entry, `${path}.${key}`)
  return out
}

const REASONS = new Set(['http', 'network', 'timeout', 'malformed'])

/** Narrow one balance read. */
export function parseBalanceView(value: unknown): BalanceView {
  const view = asRecord(value, 'balance')
  if (view.state === 'unconfigured') return { state: 'unconfigured' }
  if (view.state === 'unavailable') {
    const reason = asString(view.reason, 'balance.reason')
    if (!REASONS.has(reason)) fail('balance.reason', 'a known failure reason')
    return {
      state: 'unavailable',
      reason: reason as 'http' | 'network' | 'timeout' | 'malformed',
      ...view.status === undefined ? {} : { status: asNumber(view.status, 'balance.status') },
      fetchedAt: asNumber(view.fetchedAt, 'balance.fetchedAt'),
    }
  }
  if (view.state !== 'ok') fail('balance.state', 'ok, unconfigured, or unavailable')
  return {
    state: 'ok',
    currency: asString(view.currency, 'balance.currency'),
    total: asString(view.total, 'balance.total'),
    granted: asString(view.granted, 'balance.granted'),
    toppedUp: asString(view.toppedUp, 'balance.toppedUp'),
    isAvailable: asBoolean(view.isAvailable, 'balance.isAvailable'),
    fetchedAt: asNumber(view.fetchedAt, 'balance.fetchedAt'),
    stale: asBoolean(view.stale, 'balance.stale'),
  }
}

function parseTotals(value: unknown, path: string): SpendTotals {
  const totals = asRecord(value, path)
  return {
    cost: asNumber(totals.cost, `${path}.cost`),
    bySchedule: asNumberRecord(totals.bySchedule, `${path}.bySchedule`),
    requests: asNumber(totals.requests, `${path}.requests`),
    unpricedTokens: asNumber(totals.unpricedTokens, `${path}.unpricedTokens`),
  }
}

/** Narrow one spend read. */
export function parseSpendView(value: unknown): SpendView {
  const view = asRecord(value, 'spend')
  const ui = asRecord(view.ui, 'spend.ui')
  return {
    today: parseTotals(view.today, 'spend.today'),
    month: parseTotals(view.month, 'spend.month'),
    allTime: parseTotals(view.allTime, 'spend.allTime'),
    since: view.since === null ? null : asNumber(view.since, 'spend.since'),
    currency: asString(view.currency, 'spend.currency'),
    pricesAsOf: asString(view.pricesAsOf, 'spend.pricesAsOf'),
    timezone: asString(view.timezone, 'spend.timezone'),
    ui: {
      footer: asBoolean(ui.footer, 'spend.ui.footer'),
      sessionSpend: asBoolean(ui.sessionSpend, 'spend.ui.sessionSpend'),
      lowBalance: asNumber(ui.lowBalance, 'spend.ui.lowBalance'),
      criticalBalance: asNumber(ui.criticalBalance, 'spend.ui.criticalBalance'),
      refreshMs: asNumber(ui.refreshMs, 'spend.ui.refreshMs'),
    },
  }
}

const balanceCodec: Codec<BalanceView> = { parse: parseBalanceView }
const spendCodec: Codec<SpendView> = { parse: parseSpendView }
const forceCodec: Codec<boolean> = { parse: value => asBoolean(value, 'force') }

/** The contribution `ctx.remote.$mount()` installs, mirroring `../typert.ts`. */
export const CONTRIBUTION: TypertRemoteContribution = {
  package: '@haoran/dsh-balance',
  descriptors: [
    {
      id: '@haoran/dsh-balance#accountBalance/get',
      service: 'accountBalance',
      namespace: 'accountBalance',
      method: 'get',
      invocation: { kind: 'direct' as const },
      parameters: [
        {
          name: 'force',
          wire: 'force',
          source: 'json' as const,
          codec: { mode: 'strict' as const, typeSymbol: '@haoran/dsh-balance#BalanceForce', schema: forceCodec },
          acceptsUndefined: true as const,
        },
      ],
      result: { mode: 'strict' as const, typeSymbol: '@haoran/dsh-balance#BalanceView', schema: balanceCodec },
    },
    {
      id: '@haoran/dsh-balance#accountBalance/spend',
      service: 'accountBalance',
      namespace: 'accountBalance',
      method: 'spend',
      invocation: { kind: 'direct' as const },
      parameters: [],
      result: { mode: 'strict' as const, typeSymbol: '@haoran/dsh-balance#SpendView', schema: spendCodec },
    },
  ],
}
