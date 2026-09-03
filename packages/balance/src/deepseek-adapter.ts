/**
 * The DeepSeek member of the adapter registry: resolves the connection facts
 * `readBalance` needs, re-reading settings, the launch environment, and the
 * credential seam on every call so a rotated key or an edited endpoint
 * reaches the next poll without a restart.
 *
 * @module @sumomok/dsh-balance/deepseek-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { balanceEndpoint, type BalanceRequest } from './balance.ts'
import type { ResolvedConfig } from './config.ts'
import { DEEPSEEK_PROVIDER_ID } from './provider-id.ts'
import { optionalString } from './settings-util.ts'

/**
 * The settings section this adapter reads the provider connection from.
 * `SettingsProvider.get` resolves a namespace from a plain string generically
 * (validated internally); this plugin has no reason of its own to brand it.
 */
const PROVIDER_SETTINGS = 'llm-deepseek'

/** Credential reference the provider uses when its settings name none. */
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Environment variable naming the provider endpoint. */
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'

/** Provider endpoint used when neither settings nor the environment name one. */
const PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** The provider settings fields this adapter reads; every other field is the provider's business. */
interface ProviderSettings {
  apiKeyEnv?: unknown
  baseURL?: unknown
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

export { DEEPSEEK_PROVIDER_ID }
