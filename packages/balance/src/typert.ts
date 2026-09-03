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
import type { BalanceView, ProviderOption, SpendView } from './types.ts'

// The casts below bridge one difference only: with `exactOptionalPropertyTypes`
// an optional property in these views is `status?: number`, while zod's inferred
// output writes it `status?: number | undefined`. Every value either type admits
// is admitted by the other.
const balanceSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ok'),
    currency: z.string(),
    total: z.string(),
    granted: z.string().optional(),
    toppedUp: z.string().optional(),
    isAvailable: z.boolean(),
    fetchedAt: z.number(),
    stale: z.boolean(),
  }),
  z.object({
    state: z.literal('quota'),
    windows: z.array(z.object({
      key: z.string(),
      usedPercent: z.number(),
      resetsAt: z.number().nullable(),
    })),
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
  provider: z.string(),
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
const providerSchema = z.string()

const providerOptionSchema = z.object({ id: z.string(), displayName: z.string() })
const providersResultSchema = z.array(providerOptionSchema) as unknown as z.ZodType<ProviderOption[]>

const balanceCodec = { mode: 'strict', typeSymbol: '@sumomok/dsh-balance#BalanceView', schema: balanceSchema }
const spendCodec = { mode: 'strict', typeSymbol: '@sumomok/dsh-balance#SpendView', schema: spendSchema }
const forceCodec = { mode: 'strict', typeSymbol: '@sumomok/dsh-balance#BalanceForce', schema: forceSchema }
const providerCodec = { mode: 'strict', typeSymbol: '@sumomok/dsh-balance#BalanceProvider', schema: providerSchema }
const providersCodec = { mode: 'strict', typeSymbol: '@sumomok/dsh-balance#ProviderOptionList', schema: providersResultSchema }

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
        // Both arguments are omittable — the browser's polling call passes
        // neither, and a followed-provider read passes only `force` — so
        // both need `acceptsUndefined` or the gateway's exact-argument match
        // would reject the shorter calls.
        { name: 'provider', wire: 'provider', source: 'json', codec: providerCodec, acceptsUndefined: true },
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
      parameters: [
        // Omittable like `get`'s: a call naming no provider reads the DeepSeek route.
        { name: 'provider', wire: 'provider', source: 'json', codec: providerCodec, acceptsUndefined: true },
      ],
      result: spendCodec,
    },
    {
      id: '@sumomok/dsh-balance#accountBalance/providers',
      service: 'accountBalance',
      namespace: 'accountBalance',
      method: 'providers',
      invocation: { kind: 'direct' },
      parameters: [],
      result: providersCodec,
    },
  ],
  model: {
    services: [
      {
        description: 'Read-only account balance and spend, any registered provider (ctx.accountBalance).',
        summary: 'Account balance and spend reads.',
        tags: [],
        jsDoc: '/** Read-only account balance and spend capability. */',
        key: 'accountBalance',
        exportName: 'AccountBalanceService',
        members: [
          {
            kind: 'method',
            name: 'get',
            signature: 'get(provider?: string, force?: boolean): Promise<BalanceView>',
            summary: 'Read one provider\'s account balance, from cache unless forced.',
            jsDoc: '/**\n * One provider\'s account balance.\n * @param provider - provider route id; the DeepSeek route when omitted.\n * @param force - bypass the refresh and retry windows; an in-flight read is joined rather than duplicated.\n * @returns the balance, or why it cannot be shown.\n */',
          },
          {
            kind: 'method',
            name: 'spend',
            signature: 'spend(provider?: string): Promise<SpendView>',
            summary: 'Read one provider\'s day, month, and all-time spend from this installation\'s ledger.',
            jsDoc: '/**\n * Day, month, and all-time spend of one provider from this installation\'s own ledger.\n * @param provider - provider route id; the DeepSeek route when omitted.\n * @returns the totals, their currency, and the price table\'s date.\n */',
          },
          {
            kind: 'method',
            name: 'providers',
            signature: 'providers(): Promise<ProviderOption[]>',
            summary: 'List the providers this deployment can show a balance for, for the provider picker.',
            jsDoc: '/**\n * The provider picker\'s roster: every route this deployment could show a\n * balance for right now — statically supported by this plugin\'s adapters,\n * and probed as actually configured with a resolvable credential.\n * @returns the filtered roster; excludes an unsupported or unconfigured\n * route even when the harness\'s own directory lists it.\n */',
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
