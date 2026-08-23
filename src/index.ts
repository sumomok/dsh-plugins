/**
 * Account balance and spend for the DeepSeek Harness web GUI.
 *
 * The question this answers is the one nothing in the harness answers today:
 * *how much is left, and how much has this cost*. The balance comes from the
 * provider's own account endpoint; the spend comes from usage the harness
 * already logs, multiplied by a price table the deployment owns. No pricing
 * page is scraped at runtime, and no number is invented — a model the table
 * does not price is reported as unpriced tokens rather than as zero.
 *
 * What this plugin touches:
 *
 * - The credential seam, once per balance read, for the provider API key. The
 *   key is never cached, never logged, never returned, and never put in a URL.
 * - The provider's configured origin, and nothing else on the network.
 * - Its own directory under the harness home, for a numbers-only spend ledger.
 * - The session-event feed, read-only. It appends no session event of its own.
 *
 * It registers no HTTP route. The browser half reaches it only through the
 * harness's `/api` Typert gateway, and every exported method is a read.
 *
 * @module @haoran/dsh-balance
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: resolves the optional projection registry's Context declaration.
import type {} from '@deepseek-ai/dsh-session-projection'
import { balanceEndpoint, BalanceReader, type BalanceRequest } from './balance.ts'
import { resolveBalanceConfig, type Config, type ResolvedConfig } from './config.ts'
import { Ledger, ledgerPath, type LedgerRow } from './ledger.ts'
import { priceStep, sessionSpendProjection } from './session-spend.ts'
import { AccountBalanceService } from './service.ts'
import type { BalanceView, SpendView } from './types.ts'

export { balanceEndpoint, BalanceReader, parseAmount, parseBalanceResponse, readBalance, selectBalance } from './balance.ts'
export type { BalanceReaderOptions, BalanceRequest } from './balance.ts'
export { Config, resolveBalanceConfig } from './config.ts'
export type { ResolvedConfig, Surfaces } from './config.ts'
export { DEFAULT_PRICES } from './default-prices.ts'
export { dayKey, hostTimezone, Ledger, LEDGER_DIR, LEDGER_FILE, LEDGER_MODE, ledgerPath, parseLedgerRow } from './ledger.ts'
export type { LedgerOptions, LedgerRow } from './ledger.ts'
export {
  costOf, DEFAULT_BASE_SCHEDULE_NAME, isSupportedTimezone, isWallClockTime,
  resolvePriceTable, resolveRates, wallClockAt, windowContains,
} from './prices.ts'
export type {
  PriceEntry, PriceRates, PriceSchedule, PriceSubject, PriceTable, PriceWindow,
  ResolvedPrice, ResolvedRates, TokenCounts,
} from './prices.ts'
export { AccountBalanceService } from './service.ts'
export {
  billingBuckets, priceStep, priceTableVersion, SESSION_SPEND_KEY, sessionSpendProjection, totalTokens,
} from './session-spend.ts'
export type { PricedStep, SessionSpendState } from './session-spend.ts'
export type {
  BalanceUiConfig, BalanceUnavailableReason, BalanceView,
  SessionSpend, SessionSpendModel, SpendTotals, SpendView,
} from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'balance'

/** The settings section this plugin reads the provider connection from. */
const PROVIDER_SETTINGS = settingsNamespace('llm-deepseek')

/** Credential reference the provider uses when its settings name none. */
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Environment variable naming the provider endpoint. */
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'

/** Provider endpoint used when neither settings nor the environment name one. */
const PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** The provider settings fields this plugin reads; every other field is the provider's business. */
interface ProviderSettings {
  apiKeyEnv?: unknown
  baseURL?: unknown
}

/** Read one optional string from an untyped settings section. */
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Build the resolver the balance reader calls before every read.
 *
 * Connection facts are re-read per call and the key is resolved per call, both
 * on purpose: a key rotated through the Models page, or an endpoint changed in
 * settings, reaches the next poll without restarting anything.
 * @param ctx - the plugin context.
 * @param config - the resolved plugin config.
 * @returns a resolver yielding the next read's facts, or `null` while unconfigured.
 */
export function providerResolver(
  ctx: Context,
  config: ResolvedConfig,
): () => Promise<BalanceRequest | null> {
  return async () => {
    const section = ctx.get('settings')?.get(PROVIDER_SETTINGS) as ProviderSettings | undefined
    const apiKeyEnv = optionalString(section?.apiKeyEnv) ?? DEFAULT_API_KEY_ENV
    if (!isCredentialRefName(apiKeyEnv)) return null
    const environment = launchEnvironmentOf(ctx)
    const baseURL = optionalString(section?.baseURL)
      ?? environment.get(BASE_URL_ENV)?.value
      ?? PUBLIC_BASE_URL
    const endpoint = balanceEndpoint(baseURL)
    if (endpoint === null) return null
    const ref = credentialRef(apiKeyEnv)
    const credentials = ctx.get('credentials')
    // Without the seam there is no managed store to rank against, so the
    // launching environment is the whole credential plane — the same order the
    // provider itself resolves in.
    const apiKey = credentials === undefined
      ? environment.get(ref)?.value
      : (await credentials.resolve(ref))?.value
    if (apiKey === undefined || apiKey.length === 0) return null
    return { endpoint, apiKey, currency: config.currency, timeoutMs: config.timeoutMs }
  }
}

/** The concrete provider of the `accountBalance` capability. */
class BalanceProvider extends AccountBalanceService {
  private readonly reader: BalanceReader
  private readonly ledger: Ledger

  /**
   * @param ctx - owning plugin context.
   * @param reader - the cached balance reader.
   * @param ledger - the spend ledger backing the aggregates.
   */
  constructor(ctx: Context, reader: BalanceReader, ledger: Ledger) {
    super(ctx)
    this.reader = reader
    this.ledger = ledger
  }

  override get(force?: boolean): Promise<BalanceView> {
    return this.reader.get(force ?? false)
  }

  override spend(): Promise<SpendView> {
    return Promise.resolve(this.ledger.spend())
  }
}

/**
 * Turn one logged assistant step into a ledger row.
 * @param config - the resolved plugin config, for the price table.
 * @param session - the session the step belonged to.
 * @param event - the `assistant/message` event carrying the step's usage.
 * @returns the row, or `null` when the step reported no usage.
 */
export function ledgerRowOf(
  config: ResolvedConfig,
  session: Pick<Session, 'id'>,
  event: SessionEvent,
): LedgerRow | null {
  if (event.type !== 'assistant/message') return null
  const { usage, message } = event.data
  if (usage === undefined) return null
  const { provider, model } = message.source
  const priced = priceStep(config.prices, { provider, model }, event.time, usage)
  return {
    t: event.time,
    sessionId: session.id,
    seq: event.seq,
    model,
    ...provider === undefined ? {} : { provider },
    input: priced.counts.input,
    cacheRead: priced.counts.cacheRead,
    cacheWrite: priced.counts.cacheWrite,
    output: priced.counts.output,
    reasoning: priced.counts.reasoning,
    cost: priced.cost ?? 0,
    currency: config.prices.currency,
    schedule: priced.scheduleName ?? '',
    ...priced.cost === null ? { unpriced: true as const } : {},
  }
}

/**
 * Mount the balance and spend capability.
 * @param ctx - the plugin context.
 * @param config - the schema-validated plugin config.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveBalanceConfig(config, dshHomePath)
  const ledger = new Ledger({
    file: ledgerPath(resolved.root),
    now: () => Date.now(),
    timezone: resolved.timezone,
    retentionDays: resolved.ledgerDays,
    currency: resolved.prices.currency,
    pricesAsOf: resolved.prices.asOf,
    ui: {
      footer: resolved.footer,
      sessionSpend: resolved.sessionSpend,
      lowBalance: resolved.lowBalance,
      criticalBalance: resolved.criticalBalance,
      refreshMs: resolved.refreshMs,
    },
  })
  // Fail loud: a ledger directory this process cannot read or write is a
  // deployment mistake, and silently reporting zero spend would hide it.
  await ledger.open()

  const reader = new BalanceReader({
    resolve: providerResolver(ctx, resolved),
    now: () => Date.now(),
    refreshMs: resolved.refreshMs,
    retryMs: resolved.retryMs,
    fetch: globalThis.fetch,
  })
  new BalanceProvider(ctx, reader, ledger)

  // Per-session spend is a pure fold the registry replays and caches; the
  // registry is optional, and a composition without it simply has no
  // per-session line.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(
      sessionSpendProjection(resolved.prices, resolved.prices.currency),
    )
  })

  // The ledger observes the post-commit session feed rather than wrapping the
  // `llm/stream` waterfall: this seam carries the model, the provider, the
  // usage, and a durable `(session, seq)` identity in one already-assembled
  // record, and an observer failing here cannot fail the turn.
  ctx.inject(['sessions'], (sessionCtx) => {
    // Seeded history (a resumed session's earlier events) never reaches this
    // feed, so a row cannot be appended twice across restarts. The cursor
    // guards the one case left: a re-delivery within this process.
    const folded = new WeakMap<Session, number>()
    sessionCtx.on('session/event', (session: Session, event: SessionEvent) => {
      const last = folded.get(session)
      if (last !== undefined && event.seq <= last) return
      const row = ledgerRowOf(resolved, session, event)
      if (row === null) return
      folded.set(session, event.seq)
      void ledger.append(row).catch((error: unknown) => { ctx.logger.error(error) })
    })
  })
}
