import type { Context } from '@deepseek-ai/cordis'
import type { LlmConfigurableProvider, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import { resolveBalanceConfig, type Config } from '../src/config.ts'
import { customProviderResolver } from '../src/custom-provider.ts'

const home = (...segments: string[]): string => `/tmp/home/${segments.join('/')}`

function resolvedConfig(config: Config = {}) {
  return resolveBalanceConfig(config, home)
}

/** A minimal duck-typed context: every collaborator here reaches it only through `ctx.get(name)`. */
function fakeCtx(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context
}

const ENTRY: LlmConfigurableProvider = {
  provider: 'one-api-gw',
  displayName: 'One-API Gateway',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'one-api-gw'],
}

function llmWith(entries: LlmConfigurableProvider[]): Pick<LlmRuntime, 'listConfigurableProviders'> {
  return { listConfigurableProviders: () => entries }
}

function settingsWith(section: unknown): Pick<SettingsProvider, 'get'> {
  return { get: () => section } as Pick<SettingsProvider, 'get'>
}

describe('customProviderResolver', () => {
  it('answers null when ctx.llm is not composed', async () => {
    const resolve = customProviderResolver(fakeCtx({}), 'one-api-gw', resolvedConfig())
    expect(await resolve()).toBeNull()
  })

  it('answers null when the directory names no such provider', async () => {
    const ctx = fakeCtx({ llm: llmWith([]) })
    const resolve = customProviderResolver(ctx, 'one-api-gw', resolvedConfig())
    expect(await resolve()).toBeNull()
  })

  it('answers null when the profile names no baseURL', async () => {
    const ctx = fakeCtx({
      llm: llmWith([ENTRY]),
      settings: settingsWith({ providers: { 'one-api-gw': { apiKeyEnv: 'GW_KEY' } } }),
      launchEnvironment: { get: (name: string) => (name === 'GW_KEY' ? { value: 'sk-x' } : undefined) },
    })
    const resolve = customProviderResolver(ctx, 'one-api-gw', resolvedConfig())
    expect(await resolve()).toBeNull()
  })

  it('answers null when no key resolves, sending no request', async () => {
    const ctx = fakeCtx({
      llm: llmWith([ENTRY]),
      settings: settingsWith({ providers: { 'one-api-gw': { baseURL: 'https://gw.example' } } }),
      launchEnvironment: { get: () => undefined },
    })
    const resolve = customProviderResolver(ctx, 'one-api-gw', resolvedConfig())
    expect(await resolve()).toBeNull()
  })

  it('derives the conventional credential reference when the profile names none', async () => {
    const ctx = fakeCtx({
      llm: llmWith([ENTRY]),
      settings: settingsWith({ providers: { 'one-api-gw': { baseURL: 'https://gw.example/v1' } } }),
      launchEnvironment: { get: (name: string) => (name === 'ONE_API_GW_API_KEY' ? { value: 'sk-derived' } : undefined) },
    })
    const resolve = customProviderResolver(ctx, 'one-api-gw', resolvedConfig())
    const request = await resolve()
    expect(request).toEqual({ origin: 'https://gw.example', apiKey: 'sk-derived', timeoutMs: 8_000, shapes: expect.any(Array) })
  })

  it('resolves through the credentials seam when one is composed, over the launch environment', async () => {
    const ctx = fakeCtx({
      llm: llmWith([ENTRY]),
      settings: settingsWith({ providers: { 'one-api-gw': { baseURL: 'https://gw.example', apiKeyEnv: 'GW_KEY' } } }),
      launchEnvironment: { get: () => ({ value: 'sk-env' }) },
      credentials: { resolve: async () => ({ value: 'sk-managed' }) },
    })
    const resolve = customProviderResolver(ctx, 'one-api-gw', resolvedConfig())
    expect((await resolve())?.apiKey).toBe('sk-managed')
  })

  it('rejects a non-http(s) base URL', async () => {
    const ctx = fakeCtx({
      llm: llmWith([ENTRY]),
      settings: settingsWith({ providers: { 'one-api-gw': { baseURL: 'file:///etc/passwd', apiKeyEnv: 'GW_KEY' } } }),
      launchEnvironment: { get: () => ({ value: 'sk-x' }) },
    })
    const resolve = customProviderResolver(ctx, 'one-api-gw', resolvedConfig())
    expect(await resolve()).toBeNull()
  })
})
