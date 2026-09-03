/**
 * The Moonshot AI members of the adapter registry: one settings-driven
 * resolver shared by the `moonshotai` (international) and `moonshotai-cn`
 * (China) routes — the same account-balance endpoint shape
 * ({@link file://./moonshot-balance.ts}), addressed at each route's own base
 * URL and billed in its own fixed currency.
 *
 * Neither route ships as a dedicated harness LLM provider plugin the way
 * DeepSeek does; both are pi-ai catalog entries. So — unlike the DeepSeek
 * adapter's hardcoded settings namespace — connection facts are found the
 * same way the generic fallback adapter finds any other pi-ai-routed
 * provider's: through `ctx.llm`'s configurable-provider directory
 * ({@link file://./custom-provider.ts}'s `findConfigurableEntry`). What
 * makes this a *named* adapter rather than a generic-fallback candidate is
 * the dedicated endpoint parser plus the default credential reference:
 * pi-ai's own built-in auth for both routes reads `MOONSHOT_API_KEY` from
 * the process environment directly
 * (`@earendil-works/pi-ai`'s `moonshotai`/`moonshotai-cn` provider
 * declarations), not the per-id name
 * ({@link file://./settings-util.ts}'s `deriveKeyRef`) the generic fallback
 * would otherwise assume — so a key set the same way pi-ai itself reads it
 * is found here too, with no dsh-balance-specific configuration.
 *
 * @module @sumomok/dsh-balance/moonshot-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { ResolvedConfig } from './config.ts'
import { findConfigurableEntry } from './custom-provider.ts'
import { moonshotBalanceEndpoint, type MoonshotBalanceRequest } from './moonshot-balance.ts'
import { MOONSHOTAI_CN_PROVIDER_ID, MOONSHOTAI_PROVIDER_ID } from './provider-id.ts'
import { optionalString, profileAtPath } from './settings-util.ts'

/** Credential reference both routes resolve when their profile names none — pi-ai's own built-in default, shared by both routes. */
const DEFAULT_API_KEY_ENV = 'MOONSHOT_API_KEY'

/** One Moonshot route this plugin's dedicated adapter serves. */
export interface MoonshotRoute {
  /** Provider route id, as pi-ai's catalog and `ctx.llm`'s directory name it. */
  provider: string
  /** Base URL used when the directory names none. */
  publicBaseURL: string
  /** ISO 4217 code this route's account is always billed in; the endpoint names none of its own. */
  currency: string
}

export { MOONSHOTAI_CN_PROVIDER_ID, MOONSHOTAI_PROVIDER_ID } from './provider-id.ts'

/** The international route: `https://api.moonshot.ai`, billed in USD. */
export const MOONSHOTAI_ROUTE: MoonshotRoute = {
  provider: MOONSHOTAI_PROVIDER_ID,
  publicBaseURL: 'https://api.moonshot.ai',
  currency: 'USD',
}

/** The China route: `https://api.moonshot.cn`, billed in CNY. */
export const MOONSHOTAI_CN_ROUTE: MoonshotRoute = {
  provider: MOONSHOTAI_CN_PROVIDER_ID,
  publicBaseURL: 'https://api.moonshot.cn',
  currency: 'CNY',
}

/**
 * Build the resolver the balance reader calls before every read.
 *
 * Connection facts are re-read per call and the key is resolved per call,
 * matching the DeepSeek adapter's own resolver: a key rotated through the
 * Models page, or an endpoint changed in settings, reaches the next poll
 * without restarting anything.
 * @param ctx - the plugin context.
 * @param route - which Moonshot route this resolver serves.
 * @param config - the resolved plugin config.
 * @returns a resolver yielding the next read's facts, or `null` while unconfigured.
 */
export function moonshotProviderResolver(
  ctx: Context,
  route: MoonshotRoute,
  config: ResolvedConfig,
): () => Promise<MoonshotBalanceRequest | null> {
  return async () => {
    const entry = findConfigurableEntry(ctx, route.provider)
    if (entry === undefined) return null
    const section = ctx.get('settings')?.get(entry.settingsNs)
    const profile = profileAtPath(section, entry.settingsPath)
    const baseURL = optionalString(profile?.baseURL) ?? route.publicBaseURL
    const endpoint = moonshotBalanceEndpoint(baseURL)
    if (endpoint === null) return null
    const apiKeyEnv = optionalString(profile?.apiKeyEnv) ?? DEFAULT_API_KEY_ENV
    if (!isCredentialRefName(apiKeyEnv)) return null
    const ref = credentialRef(apiKeyEnv)
    const environment = launchEnvironmentOf(ctx)
    const credentials = ctx.get('credentials')
    // Without the seam there is no managed store to rank against, so the
    // launching environment is the whole credential plane — the same order
    // the DeepSeek adapter's own resolver falls back to.
    const apiKey = credentials === undefined
      ? environment.get(ref)?.value
      : (await credentials.resolve(ref))?.value
    if (apiKey === undefined || apiKey.length === 0) return null
    return { endpoint, apiKey, currency: route.currency, timeoutMs: config.timeoutMs }
  }
}
