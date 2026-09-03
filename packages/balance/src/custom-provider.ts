/**
 * Connection-fact resolution for the generic fallback adapter: any provider
 * with no dedicated named adapter. Where DeepSeek's adapter knows its one
 * settings namespace, this one looks the provider up in `ctx.llm`'s own
 * configurable-provider directory — the same directory the harness's Models
 * settings page reads — so a custom base-URL entry the user added there is
 * found by the same `settingsNs`/`settingsPath` address, with no knowledge of
 * which adapter family owns it. {@link findConfigurableEntry} is exported for
 * that same directory lookup to serve the Moonshot AI named adapter too
 * ({@link file://./moonshot-adapter.ts}), which reads through it rather than
 * duplicating it.
 *
 * @module @sumomok/dsh-balance/custom-provider
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type { ResolvedConfig } from './config.ts'
import type { GenericBalanceRequest } from './generic-adapter.ts'
import { deriveKeyRef, optionalString, profileAtPath } from './settings-util.ts'

/**
 * Find the directory entry naming where a provider's profile lives. Absence
 * means either `ctx.llm` is not composed, or the provider is registered
 * without a configurable-provider declaration (an adapter the directory
 * cannot address) — either way there is no settings path to read.
 * @param ctx - the plugin context.
 * @param provider - provider route id.
 * @returns the entry, or `undefined`.
 */
export function findConfigurableEntry(ctx: Context, provider: string): LlmConfigurableProvider | undefined {
  return ctx.get('llm')?.listConfigurableProviders().find(entry => entry.provider === provider)
}

/**
 * Build the resolver the generic reader calls before every read. Settings,
 * the launch environment, and the credential seam are all re-read per call,
 * matching the DeepSeek adapter's own resolver.
 * @param ctx - the plugin context.
 * @param provider - provider route id this resolver serves.
 * @param config - the resolved plugin config.
 * @returns a resolver yielding the next read's facts, or `null` while this
 * provider cannot be attempted at all (no directory entry, no configured
 * `baseURL`, or no key).
 */
export function customProviderResolver(
  ctx: Context,
  provider: string,
  config: ResolvedConfig,
): () => Promise<GenericBalanceRequest | null> {
  return async () => {
    const entry = findConfigurableEntry(ctx, provider)
    if (entry === undefined) return null
    const section = ctx.get('settings')?.get(entry.settingsNs)
    const profile = profileAtPath(section, entry.settingsPath)
    if (profile === undefined) return null
    const baseURL = optionalString(profile.baseURL)
    if (baseURL === undefined) return null
    let origin: string
    try {
      const url = new URL(baseURL)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
      origin = url.origin
    } catch {
      return null
    }
    const apiKeyEnv = optionalString(profile.apiKeyEnv) ?? deriveKeyRef(provider)
    if (!isCredentialRefName(apiKeyEnv)) return null
    const ref = credentialRef(apiKeyEnv)
    const environment = launchEnvironmentOf(ctx)
    const credentials = ctx.get('credentials')
    const apiKey = credentials === undefined
      ? environment.get(ref)?.value
      : (await credentials.resolve(ref))?.value
    if (apiKey === undefined || apiKey.length === 0) return null
    return { origin, apiKey, timeoutMs: config.timeoutMs, shapes: config.genericEndpoints }
  }
}
