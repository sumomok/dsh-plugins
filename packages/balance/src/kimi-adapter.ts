/**
 * The Kimi For Coding member of the adapter registry: resolves the connection
 * facts a subscription-quota read needs ({@link file://./kimi-usage.ts}).
 *
 * Kimi For Coding does not ship as a dedicated harness LLM provider plugin the
 * way DeepSeek does; it is a pi-ai catalog entry (`kimi-coding`). So — like the
 * Moonshot named adapter, and unlike the DeepSeek adapter's hardcoded settings
 * namespace — whether the provider is configured is found through `ctx.llm`'s
 * configurable-provider directory ({@link file://./custom-provider.ts}'s
 * `findConfigurableEntry`). What makes this a *named* adapter is the quota
 * endpoint and its default credential reference: the subscription key
 * (`sk-kimi-*`) the Kimi CLI itself uses, read from `KIMI_CODING_API_KEY` when
 * the profile names no `apiKeyEnv`.
 *
 * The quota endpoint is Kimi's own fixed coding-plan usage route, not the chat
 * base URL a `kimi-coding` model is called at — a configured base URL points
 * the model's own requests somewhere and says nothing about where the usage
 * route lives, so this adapter does not read it. The route is fixed, so it is a
 * constant here rather than configuration.
 *
 * @module @sumomok/dsh-balance/kimi-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { ResolvedConfig } from './config.ts'
import { findConfigurableEntry } from './custom-provider.ts'
import { KIMI_CLI_USER_AGENT, type KimiUsageRequest } from './kimi-usage.ts'
import { KIMI_CODING_PROVIDER_ID } from './provider-id.ts'
import { optionalString, profileAtPath } from './settings-util.ts'

export { KIMI_CODING_PROVIDER_ID } from './provider-id.ts'

/** The Kimi Code usage endpoint the Kimi CLI reads a subscription's quota from. */
const KIMI_USAGES_ENDPOINT = 'https://api.kimi.com/coding/v1/usages'

/** The older singular path of the same route, tried when {@link KIMI_USAGES_ENDPOINT} answers 404. */
const KIMI_USAGE_ENDPOINT = 'https://api.kimi.com/coding/v1/usage'

/** Credential reference this adapter resolves when the profile names none — the Kimi CLI's own subscription key variable. */
const DEFAULT_API_KEY_ENV = 'KIMI_CODING_API_KEY'

/**
 * Build the resolver the balance reader calls before every read.
 *
 * Connection facts are re-read per call and the key is resolved per call,
 * matching the other named adapters' resolvers: a key rotated through the
 * Models page reaches the next poll without restarting anything.
 * @param ctx - the plugin context.
 * @param config - the resolved plugin config.
 * @returns a resolver yielding the next read's facts, or `null` while unconfigured.
 */
export function kimiProviderResolver(
  ctx: Context,
  config: ResolvedConfig,
): () => Promise<KimiUsageRequest | null> {
  return async () => {
    const entry = findConfigurableEntry(ctx, KIMI_CODING_PROVIDER_ID)
    if (entry === undefined) return null
    const section = ctx.get('settings')?.get(entry.settingsNs)
    const profile = profileAtPath(section, entry.settingsPath)
    const apiKeyEnv = optionalString(profile?.apiKeyEnv) ?? DEFAULT_API_KEY_ENV
    if (!isCredentialRefName(apiKeyEnv)) return null
    const ref = credentialRef(apiKeyEnv)
    const environment = launchEnvironmentOf(ctx)
    const credentials = ctx.get('credentials')
    // Without the seam there is no managed store to rank against, so the
    // launching environment is the whole credential plane — the same order the
    // other adapters' resolvers fall back to.
    const apiKey = credentials === undefined
      ? environment.get(ref)?.value
      : (await credentials.resolve(ref))?.value
    if (apiKey === undefined || apiKey.length === 0) return null
    return {
      endpoint: KIMI_USAGES_ENDPOINT,
      fallbackEndpoint: KIMI_USAGE_ENDPOINT,
      apiKey,
      userAgent: KIMI_CLI_USER_AGENT,
      timeoutMs: config.timeoutMs,
    }
  }
}
