/**
 * The balance adapter registry: one memoized {@link BalanceReader} per
 * provider id, keyed by provider so a deployment reading several providers
 * (the session-followed one, plus whatever the provider picker last
 * previewed) gets each its own refresh/retry cache instead of sharing one.
 *
 * DeepSeek, the two Moonshot AI routes (`moonshotai`, `moonshotai-cn`), and
 * Kimi For Coding (`kimi-coding`) are the named members — each with its own
 * dedicated reader, ahead of the generic fallback. The Kimi member is the one
 * that reports a subscription quota ({@link BalanceView}'s `quota` state)
 * rather than a money balance; the others report money. Every other provider
 * id falls through to the generic fallback adapter, which only ever runs when
 * `ctx.llm`'s own configurable-provider directory names a settings address for
 * that id (`custom-provider.ts`); nothing here special-cases which adapter
 * family registered it. A future named adapter for another specific provider
 * joins this registry the same way.
 *
 * @module @sumomok/dsh-balance/adapters
 */

import type { Context } from '@deepseek-ai/cordis'
import { BalanceReader, readBalance, type BalanceRequest } from './balance.ts'
import type { ResolvedConfig } from './config.ts'
import { customProviderResolver } from './custom-provider.ts'
import { providerResolver } from './deepseek-adapter.ts'
import { createGenericPerform, type GenericBalanceRequest } from './generic-adapter.ts'
import { KIMI_CODING_PROVIDER_ID, kimiProviderResolver } from './kimi-adapter.ts'
import { readKimiUsage, type KimiUsageRequest } from './kimi-usage.ts'
import {
  MOONSHOTAI_CN_PROVIDER_ID, MOONSHOTAI_CN_ROUTE, MOONSHOTAI_PROVIDER_ID, MOONSHOTAI_ROUTE,
  moonshotProviderResolver, type MoonshotRoute,
} from './moonshot-adapter.ts'
import { readMoonshotBalance, type MoonshotBalanceRequest } from './moonshot-balance.ts'
import { DEEPSEEK_DISPLAY_NAME, DEEPSEEK_PROVIDER_ID } from './provider-id.ts'
import type { BalanceView, ProviderOption } from './types.ts'

/** The one operation the registry needs from a reader, independent of its request shape. */
interface Readable {
  get(force?: boolean): Promise<BalanceView>
}

/** One provider's memoized reader plus how its failures should be shown. */
interface RegisteredAdapter {
  reader: Readable
  /**
   * A named adapter's own failures explain themselves (`unavailable`, with a
   * reason) — DeepSeek, the two Moonshot routes, and Kimi For Coding; the
   * generic fallback's are quiet — see {@link AdapterRegistry.get}.
   */
  quietFailure: boolean
}

/** The route a provider id names, among the Moonshot named adapter's members, or `undefined` for any other id. */
function moonshotRouteFor(provider: string): MoonshotRoute | undefined {
  if (provider === MOONSHOTAI_PROVIDER_ID) return MOONSHOTAI_ROUTE
  if (provider === MOONSHOTAI_CN_PROVIDER_ID) return MOONSHOTAI_CN_ROUTE
  return undefined
}

/**
 * Build one provider's reader and how its failures should read on the wire.
 * @param ctx - the plugin context.
 * @param config - the resolved plugin config.
 * @param provider - provider route id.
 * @returns the registration.
 */
function build(ctx: Context, config: ResolvedConfig, provider: string): RegisteredAdapter {
  if (provider === DEEPSEEK_PROVIDER_ID) {
    return {
      reader: new BalanceReader<BalanceRequest>({
        resolve: providerResolver(ctx, config),
        perform: readBalance,
        now: () => Date.now(),
        refreshMs: config.refreshMs,
        retryMs: config.retryMs,
        fetch: globalThis.fetch,
      }),
      quietFailure: false,
    }
  }
  const route = moonshotRouteFor(provider)
  if (route !== undefined) {
    return {
      reader: new BalanceReader<MoonshotBalanceRequest>({
        resolve: moonshotProviderResolver(ctx, route, config),
        perform: readMoonshotBalance,
        now: () => Date.now(),
        refreshMs: config.refreshMs,
        retryMs: config.retryMs,
        fetch: globalThis.fetch,
      }),
      quietFailure: false,
    }
  }
  if (provider === KIMI_CODING_PROVIDER_ID) {
    return {
      reader: new BalanceReader<KimiUsageRequest>({
        resolve: kimiProviderResolver(ctx, config),
        perform: readKimiUsage,
        now: () => Date.now(),
        refreshMs: config.refreshMs,
        retryMs: config.retryMs,
        fetch: globalThis.fetch,
      }),
      quietFailure: false,
    }
  }
  return {
    reader: new BalanceReader<GenericBalanceRequest>({
      resolve: customProviderResolver(ctx, provider, config),
      perform: createGenericPerform(),
      now: () => Date.now(),
      refreshMs: config.refreshMs,
      retryMs: config.retryMs,
      fetch: globalThis.fetch,
    }),
    quietFailure: true,
  }
}

/**
 * Owns one memoized reader per provider id that has been read at least once.
 * Memoization is what makes the refresh/retry windows mean something: a
 * fresh reader per call would never serve from cache, and the generic
 * adapter's remembered endpoint shape (`generic-adapter.ts`) would never
 * survive between calls either.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, RegisteredAdapter>()

  /**
   * @param ctx - the plugin context.
   * @param config - the resolved plugin config.
   */
  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  /**
   * Read one provider's balance.
   * @param provider - provider route id.
   * @param force - bypass the refresh and retry windows; an in-flight read is joined rather than duplicated.
   * @returns the view. A generic-adapter failure comes back as the quiet
   * `unconfigured` state rather than `unavailable`: see the registry's module doc.
   */
  async get(provider: string, force: boolean): Promise<BalanceView> {
    let registration = this.adapters.get(provider)
    if (registration === undefined) {
      registration = build(this.ctx, this.config, provider)
      this.adapters.set(provider, registration)
    }
    const view = await registration.reader.get(force)
    if (registration.quietFailure && view.state === 'unavailable') return { state: 'unconfigured' }
    return view
  }
}

/**
 * The provider picker's roster: every provider route the harness knows,
 * active or dormant, DeepSeek always included even when `ctx.llm` is not
 * composed (this plugin can still query it through its own settings-only
 * resolver). Carries no adapter or configuration fact — see {@link ProviderOption}.
 * @param ctx - the plugin context.
 * @returns the roster, DeepSeek first, in directory then registration order.
 */
export function providerRoster(ctx: Context): ProviderOption[] {
  const roster = new Map<string, ProviderOption>()
  roster.set(DEEPSEEK_PROVIDER_ID, { id: DEEPSEEK_PROVIDER_ID, displayName: DEEPSEEK_DISPLAY_NAME })
  const llm = ctx.get('llm')
  if (llm !== undefined) {
    for (const entry of llm.listConfigurableProviders()) {
      roster.set(entry.provider, { id: entry.provider, displayName: entry.displayName })
    }
    for (const info of llm.listProviders()) {
      if (!roster.has(info.id)) roster.set(info.id, { id: info.id, displayName: info.name })
    }
  }
  return [...roster.values()]
}

/**
 * Provider ids this plugin's adapter machinery can ever produce a balance
 * for: every named adapter's own id, always — DeepSeek, `moonshotai`,
 * `moonshotai-cn`, and `kimi-coding` — plus every provider `ctx.llm`'s configurable-provider
 * directory addresses — the one set {@link file://./custom-provider.ts}'s
 * resolver can find a settings path for. A route reachable only through
 * `llm.listProviders()`, with no directory entry, fails that resolver's very
 * first lookup on every call, so it is excluded here rather than probed for a
 * result that can never differ.
 * @param ctx - the plugin context.
 * @returns provider ids statically eligible for the picker, before probing
 * which of them are actually configured.
 */
function supportedProviderIds(ctx: Context): Set<string> {
  const ids = new Set<string>([
    DEEPSEEK_PROVIDER_ID, MOONSHOTAI_PROVIDER_ID, MOONSHOTAI_CN_PROVIDER_ID, KIMI_CODING_PROVIDER_ID,
  ])
  for (const entry of ctx.get('llm')?.listConfigurableProviders() ?? []) ids.add(entry.provider)
  return ids
}

/**
 * The provider picker's roster, filtered to providers this deployment can
 * actually show a balance for.
 *
 * Filtering happens in two passes because "configured" (a credential
 * actually resolves) is not knowable without asking each adapter, while
 * "supported" (an adapter exists that could ever resolve one) is a static
 * fact of the directory: {@link supportedProviderIds} narrows the full
 * roster to the statically eligible providers first, then this function
 * probes only those — one `AdapterRegistry.get` read each, sharing the same
 * refresh/retry cache the chip's own balance reads use, so a poll tick
 * already holding a fresh answer costs no extra network call. A candidate
 * whose read comes back `unconfigured` (no credential resolves; see
 * {@link AdapterRegistry.get}'s doc on the generic adapter's quiet failure)
 * is dropped.
 *
 * Carries no notion of which provider is "followed" — the caller's own
 * followed-provider balance read already exercises that id through this same
 * registry, and folding it back into the roster if this filter ever excluded
 * it is the browser half's job ({@link file://./client/store.ts}), not this
 * one's.
 * @param ctx - the plugin context.
 * @param registry - the adapter registry probed for each supported candidate.
 * @returns the filtered roster, in {@link providerRoster}'s order.
 */
export async function pickableProviderRoster(ctx: Context, registry: AdapterRegistry): Promise<ProviderOption[]> {
  const supported = supportedProviderIds(ctx)
  const candidates = providerRoster(ctx).filter(option => supported.has(option.id))
  const probed = await Promise.all(candidates.map(async (option): Promise<ProviderOption | undefined> => {
    const view = await registry.get(option.id, false)
    return view.state === 'unconfigured' ? undefined : option
  }))
  return probed.filter((option): option is ProviderOption => option !== undefined)
}
