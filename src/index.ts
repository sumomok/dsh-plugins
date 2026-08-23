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
 * @module @sumomok/dsh-balance
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
import { pricesFor, selectPriceCurrency, type PriceEntry, type PriceTable } from './prices.ts'
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
  costOf, DEFAULT_BASE_SCHEDULE_NAME, isSupportedTimezone, isWallClockTime, pricesFor,
  resolvePriceTable, resolveRates, selectPriceCurrency, wallClockAt, windowContains,
} from './prices.ts'
export type {
  CurrencyPrices, PriceEntry, PriceRates, PriceSchedule, PriceSubject, PriceTable, PriceWindow,
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

/**
 * Which currency's price list spend is computed against.
 *
 * The account's own billing currency decides it once a balance read reveals
 * one, because a CNY balance beside a USD spend total is two numbers nobody
 * can compare. Until then — and for an account whose currency the table does
 * not price — the configured preference decides. A change re-prices
 * everything, so listeners re-register what they derived from the old list.
 */
export class ActivePrices {
  private readonly table: PriceTable
  private readonly preference: readonly string[]
  private readonly listeners = new Set<(currency: string) => void>()
  private code: string

  /**
   * @param table - the resolved price table.
   * @param preference - configured currency preference, most wanted first.
   */
  constructor(table: PriceTable, preference: readonly string[]) {
    this.table = table
    this.preference = preference
    // Validation guarantees at least one priced currency, so the selection
    // cannot come back empty here.
    this.code = selectPriceCurrency(table, { preference }) ?? ''
  }

  /** The active ISO 4217 code. */
  get currency(): string {
    return this.code
  }

  /** The active currency's price list. */
  get entries(): readonly PriceEntry[] {
    return pricesFor(this.table, this.code)
  }

  /**
   * Adopt the account's own billing currency when a balance read reveals it.
   * @param view - the balance read; anything but a successful one is ignored.
   */
  observe(view: BalanceView): void {
    if (view.state !== 'ok') return
    const next = selectPriceCurrency(this.table, {
      balanceCurrency: view.currency,
      preference: this.preference,
    })
    if (next === undefined || next === this.code) return
    this.code = next
    for (const listener of [...this.listeners]) listener(next)
  }

  /**
   * Subscribe to currency changes.
   * @param listener - receives the new ISO 4217 code.
   * @returns the unsubscriber.
   */
  onChange(listener: (currency: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

/** The concrete provider of the `accountBalance` capability. */
class BalanceProvider extends AccountBalanceService {
  private readonly reader: BalanceReader
  private readonly ledger: Ledger
  private readonly active: ActivePrices

  /**
   * @param ctx - owning plugin context.
   * @param reader - the cached balance reader.
   * @param ledger - the spend ledger backing the aggregates.
   * @param active - the active currency selection, which every read updates.
   */
  constructor(ctx: Context, reader: BalanceReader, ledger: Ledger, active: ActivePrices) {
    super(ctx)
    this.reader = reader
    this.ledger = ledger
    this.active = active
  }

  override async get(force?: boolean): Promise<BalanceView> {
    const view = await this.reader.get(force ?? false)
    // The read is where the account's own billing currency becomes known.
    this.active.observe(view)
    return view
  }

  override spend(): Promise<SpendView> {
    return Promise.resolve(this.ledger.spend(this.active.currency))
  }
}

/**
 * Turn one logged assistant step into a ledger row.
 * @param active - the active currency selection, supplying the price list the
 * row is written in; a row records the currency it was priced in so a later
 * switch cannot fold it into another currency's total.
 * @param session - the session the step belonged to.
 * @param event - the `assistant/message` event carrying the step's usage.
 * @returns the row, or `null` when the step reported no usage.
 */
export function ledgerRowOf(
  active: ActivePrices,
  session: Pick<Session, 'id'>,
  event: SessionEvent,
): LedgerRow | null {
  if (event.type !== 'assistant/message') return null
  const { usage, message } = event.data
  if (usage === undefined) return null
  const { provider, model } = message.source
  const priced = priceStep(active.entries, { provider, model }, event.time, usage)
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
    currency: active.currency,
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
  const active = new ActivePrices(resolved.prices, resolved.currency)
  const ledger = new Ledger({
    file: ledgerPath(resolved.root),
    now: () => Date.now(),
    timezone: resolved.timezone,
    retentionDays: resolved.ledgerDays,
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
  new BalanceProvider(ctx, reader, ledger, active)

  // Per-session spend is a pure fold the registry replays and caches; the
  // registry is optional, and a composition without it simply has no
  // per-session line. The fold closes over one currency's price list, so a
  // currency change re-registers it — which is also what discards the folds
  // computed at the previous rates.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    let dispose = projectionCtx.sessionProjections.register(
      sessionSpendProjection(active.entries, active.currency),
    )
    projectionCtx.effect(() => {
      const stop = active.onChange(() => {
        dispose()
        dispose = projectionCtx.sessionProjections.register(
          sessionSpendProjection(active.entries, active.currency),
        )
      })
      return () => {
        stop()
        dispose()
      }
    }, 'dsh-balance: session spend projection')
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
      const row = ledgerRowOf(active, session, event)
      if (row === null) return
      folded.set(session, event.seq)
      void ledger.append(row).catch((error: unknown) => { ctx.logger.error(error) })
    })
  })
}
