/**
 * Account balance and spend for the DeepSeek Harness web GUI.
 *
 * The question this answers is the one nothing in the harness answers today:
 * *how much is left, and how much has this cost*. The balance comes from one
 * provider's own account endpoint — DeepSeek by default, or whichever
 * provider the current session's selected model belongs to, or whichever
 * provider the browser's provider picker names — read through the adapter
 * registry (`adapters.ts`): a named DeepSeek adapter, and a generic
 * best-effort fallback for any other provider `ctx.llm`'s own
 * configurable-provider directory can address. The spend ledger is
 * unaffected by which provider is shown: it stays one installation-wide
 * account, priced from the one deployment-owned price table, from usage the
 * harness already logs. No pricing page is scraped at runtime, and no number
 * is invented — a model the table does not price is reported as unpriced
 * tokens rather than as zero.
 *
 * What this plugin touches:
 *
 * - The credential seam, once per balance read, for the queried provider's API
 *   key. The key is never cached, never logged, never returned, and never put
 *   in a URL.
 * - The queried provider's own configured origin, and nothing else on the
 *   network; a same-origin fence rejects anything a resolved endpoint's own
 *   arithmetic would otherwise move off it.
 * - Its own directory under the harness home, for a numbers-only spend ledger.
 * - The session-event feed, read-only. It appends no session event of its own.
 *
 * It registers no HTTP route. The browser half reaches it only through the
 * harness's `/api` Typert gateway, and every exported method is a read.
 *
 * @module @sumomok/dsh-balance
 */

import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: resolves the optional projection registry's Context declaration.
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: resolves the `ctx.settings` service declaration.
import type {} from '@deepseek-ai/dsh-settings'
import { BALANCE_SETTINGS_NAMESPACE_NAME } from './settings-namespace.ts'
import { AdapterRegistry, pickableProviderRoster } from './adapters.ts'
import { Config, resolveBalanceConfig } from './config.ts'
import { Ledger, ledgerPath, type LedgerRow } from './ledger.ts'
import { pricesFor, selectPriceCurrency, type PriceEntry, type PriceTable } from './prices.ts'
import { DEEPSEEK_PROVIDER_ID } from './provider-id.ts'
import { priceStep, sessionSpendProjection } from './session-spend.ts'
import { AccountBalanceService } from './service.ts'
import type { BalanceView, ProviderOption, SpendView } from './types.ts'

export { AdapterRegistry, pickableProviderRoster, providerRoster } from './adapters.ts'
export { balanceEndpoint, BalanceReader, parseAmount, parseBalanceResponse, readBalance, selectBalance } from './balance.ts'
export type { BalanceReaderOptions, BalanceRequest } from './balance.ts'
export { Config, resolveBalanceConfig } from './config.ts'
export type { ResolvedConfig, Surfaces } from './config.ts'
export { customProviderResolver, findConfigurableEntry } from './custom-provider.ts'
export { providerResolver } from './deepseek-adapter.ts'
export { DEFAULT_PRICES } from './default-prices.ts'
export { createGenericPerform, DEFAULT_GENERIC_ENDPOINTS } from './generic-adapter.ts'
export type { GenericBalanceRequest, GenericEndpointShape, OneApiQuotaShape, OpenAiBillingShape } from './generic-adapter.ts'
export { dayKey, hostTimezone, Ledger, LEDGER_DIR, LEDGER_FILE, LEDGER_MODE, ledgerPath, parseLedgerRow } from './ledger.ts'
export type { LedgerOptions, LedgerRow } from './ledger.ts'
export {
  MOONSHOTAI_CN_PROVIDER_ID, MOONSHOTAI_CN_ROUTE, MOONSHOTAI_PROVIDER_ID, MOONSHOTAI_ROUTE, moonshotProviderResolver,
} from './moonshot-adapter.ts'
export type { MoonshotRoute } from './moonshot-adapter.ts'
export { moonshotBalanceEndpoint, parseMoonshotBalanceResponse, readMoonshotBalance } from './moonshot-balance.ts'
export type { MoonshotBalanceRequest } from './moonshot-balance.ts'
export {
  costOf, DEFAULT_BASE_SCHEDULE_NAME, isSupportedTimezone, isWallClockTime, pricesFor,
  resolvePriceTable, resolveRates, selectPriceCurrency, wallClockAt, windowContains,
} from './prices.ts'
export type {
  CurrencyPrices, PriceEntry, PriceRates, PriceSchedule, PriceSubject, PriceTable, PriceWindow,
  ResolvedPrice, ResolvedRates, TokenCounts,
} from './prices.ts'
export { DEEPSEEK_DISPLAY_NAME, DEEPSEEK_PROVIDER_ID } from './provider-id.ts'
export { AccountBalanceService } from './service.ts'
export {
  billingBuckets, priceStep, priceTableVersion, SESSION_SPEND_KEY, sessionSpendProjection, totalTokens,
} from './session-spend.ts'
export type { PricedStep, SessionSpendState } from './session-spend.ts'
export { deriveKeyRef, optionalString, profileAtPath } from './settings-util.ts'
export type {
  BalanceUiConfig, BalanceUnavailableReason, BalanceView, ProviderOption,
  SessionSpend, SessionSpendModel, SpendTotals, SpendView,
} from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'balance'

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
  private table: PriceTable
  private preference: readonly string[]
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

  /**
   * Replace the price table and currency preference a live settings edit
   * supplies fresh. Prefers to keep serving whichever currency is already
   * active — the same priority {@link observe} gives an account's own billing
   * currency — so editing, say, a USD entry's rates does not reset an account
   * already settled on CNY back to the preference list's first choice.
   * @param table - the freshly resolved price table.
   * @param preference - the freshly resolved currency preference.
   */
  update(table: PriceTable, preference: readonly string[]): void {
    this.table = table
    this.preference = preference
    const next = selectPriceCurrency(table, { balanceCurrency: this.code, preference }) ?? this.code
    if (next === this.code) return
    this.code = next
    for (const listener of [...this.listeners]) listener(next)
  }
}

/** The concrete provider of the `accountBalance` capability. */
class BalanceProvider extends AccountBalanceService {
  private readonly registry: AdapterRegistry
  private readonly ledger: Ledger
  private readonly active: ActivePrices

  /**
   * @param ctx - owning plugin context.
   * @param registry - the adapter registry, one cached reader per provider id.
   * @param ledger - the spend ledger backing the aggregates.
   * @param active - the active currency selection, which a DeepSeek read updates.
   */
  constructor(ctx: Context, registry: AdapterRegistry, ledger: Ledger, active: ActivePrices) {
    super(ctx)
    this.registry = registry
    this.ledger = ledger
    this.active = active
  }

  override async get(provider?: string, force?: boolean): Promise<BalanceView> {
    const id = provider === undefined || provider.length === 0 ? DEEPSEEK_PROVIDER_ID : provider
    const view = await this.registry.get(id, force ?? false)
    // The spend ledger prices in one deployment currency, which only
    // DeepSeek's own account balance may move: previewing another provider
    // in the picker must not re-price every session's ledger.
    if (id === DEEPSEEK_PROVIDER_ID) this.active.observe(view)
    return view
  }

  override spend(provider?: string): Promise<SpendView> {
    const id = provider === undefined || provider.length === 0 ? DEEPSEEK_PROVIDER_ID : provider
    return Promise.resolve(this.ledger.spend(this.active.currency, id))
  }

  override providers(): Promise<ProviderOption[]> {
    return pickableProviderRoster(this.ctx, this.registry)
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

  // The price table and the low/critical-balance thresholds are the fields
  // the settings section (`client/PriceTableSection.tsx`) exposes, so they
  // are the only ones re-derived here. Every other field — refresh/retry
  // windows, generic-adapter endpoint shapes, the ledger's file location,
  // timezone, and retention — is captured once above and takes effect only
  // at the next restart, whether changed through this settings document or
  // by hand in `cordis.yml`; nothing here re-reads them live.
  let source: () => Config = () => config
  // `installSection` lives on the live `ctx.settings` service instance now
  // (the retired `installSettingsSection` free function's replacement), so
  // this waits on the service the same way the session-projection
  // registration below waits on `sessionProjections`: a composition without
  // `dsh-settings` simply never installs this section, and this plugin keeps
  // running on `config`'s own restart-time values.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, BALANCE_SETTINGS_NAMESPACE_NAME, Config, config, {
      validate: (section) => { resolveBalanceConfig(section, dshHomePath) },
      setSource: (next) => { source = next },
      onChange: () => {
        const live = resolveBalanceConfig(source(), dshHomePath)
        active.update(live.prices, live.currency)
        ledger.setUi({
          footer: live.footer,
          sessionSpend: live.sessionSpend,
          lowBalance: live.lowBalance,
          criticalBalance: live.criticalBalance,
          refreshMs: live.refreshMs,
        })
      },
    })
  })

  const registry = new AdapterRegistry(ctx, resolved)
  new BalanceProvider(ctx, registry, ledger, active)

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
