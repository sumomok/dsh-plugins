/**
 * Host-face Typert manifest, discovered by `@deepseek-ai/dsh-typert-loader`.
 *
 * The loader resolves `<package>/package.json` from the config tree, reads
 * `exports["./typert"]`, imports this module, and registers the `TYPERT`
 * export — so a third-party Remote needs no allowlist and no repository
 * change: the plugin appearing as a Loader entry under its own package name is
 * the whole registration. The manifest is hand-written here because the Typert
 * generator runs over the harness workspace, not over out-of-repo packages; it
 * is structurally what that generator emits, and every codec is a zod v4
 * schema, which the loader checks.
 *
 * Keep this file free of imports other than `zod`: the loader imports it
 * directly by file path, outside the plugin's own module graph.
 *
 * @module @sumomok/dsh-balance/typert
 */

import { z } from 'zod'
import type { BalanceView, SpendView } from './types.ts'

// The casts below bridge one difference only: with `exactOptionalPropertyTypes`
// an optional property in these views is `status?: number`, while zod's inferred
// output writes it `status?: number | undefined`. Every value either type admits
// is admitted by the other.
const balanceSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ok'),
    currency: z.string(),
    total: z.string(),
    granted: z.string(),
    toppedUp: z.string(),
    isAvailable: z.boolean(),
    fetchedAt: z.number(),
    stale: z.boolean(),
  }),
  z.object({ state: z.literal('unconfigured') }),
  z.object({
    state: z.literal('unavailable'),
    reason: z.enum(['http', 'network', 'timeout', 'malformed']),
    status: z.number().optional(),
    fetchedAt: z.number(),
  }),
]) as unknown as z.ZodType<BalanceView>

const totalsSchema = z.object({
  cost: z.number(),
  bySchedule: z.record(z.string(), z.number()),
  requests: z.number(),
  unpricedTokens: z.number(),
})

const spendSchema = z.object({
  today: totalsSchema,
  month: totalsSchema,
  allTime: totalsSchema,
  since: z.number().nullable(),
  currency: z.string(),
  pricesAsOf: z.string(),
  timezone: z.string(),
  ui: z.object({
    footer: z.boolean(),
    sessionSpend: z.boolean(),
    lowBalance: z.number(),
    criticalBalance: z.number(),
    refreshMs: z.number(),
  }),
}) as unknown as z.ZodType<SpendView>

const forceSchema = z.boolean()

const balanceCodec = { mode: 'strict', typeSymbol: '@sumomok/dsh-balance#BalanceView', schema: balanceSchema }
const spendCodec = { mode: 'strict', typeSymbol: '@sumomok/dsh-balance#SpendView', schema: spendSchema }
const forceCodec = { mode: 'strict', typeSymbol: '@sumomok/dsh-balance#BalanceForce', schema: forceSchema }

/** The contribution `dsh-typert-loader` registers for this package. */
export const TYPERT = {
  package: '@sumomok/dsh-balance',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: '@sumomok/dsh-balance#accountBalance/get',
      service: 'accountBalance',
      namespace: 'accountBalance',
      method: 'get',
      invocation: { kind: 'direct' },
      parameters: [
        // The browser's polling call passes no argument; without
        // `acceptsUndefined` the gateway's exact-argument match would reject it.
        { name: 'force', wire: 'force', source: 'json', codec: forceCodec, acceptsUndefined: true },
      ],
      result: balanceCodec,
    },
    {
      id: '@sumomok/dsh-balance#accountBalance/spend',
      service: 'accountBalance',
      namespace: 'accountBalance',
      method: 'spend',
      invocation: { kind: 'direct' },
      parameters: [],
      result: spendCodec,
    },
  ],
  model: {
    services: [
      {
        description: 'Read-only DeepSeek account balance and spend (ctx.accountBalance).',
        summary: 'Account balance and spend reads.',
        tags: [],
        jsDoc: '/** Read-only account balance and spend capability. */',
        key: 'accountBalance',
        exportName: 'AccountBalanceService',
        members: [
          {
            kind: 'method',
            name: 'get',
            signature: 'get(force?: boolean): Promise<BalanceView>',
            summary: 'Read the provider account balance, from cache unless forced.',
            jsDoc: '/**\n * The provider\'s account balance.\n * @param force - bypass the refresh and retry windows; an in-flight read is joined rather than duplicated.\n * @returns the balance, or why it cannot be shown.\n */',
          },
          {
            kind: 'method',
            name: 'spend',
            signature: 'spend(): Promise<SpendView>',
            summary: 'Read day, month, and all-time spend from this installation\'s ledger.',
            jsDoc: '/**\n * Day, month, and all-time spend from this installation\'s own ledger.\n * @returns the totals, their currency, and the price table\'s date.\n */',
          },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
}

export default TYPERT
