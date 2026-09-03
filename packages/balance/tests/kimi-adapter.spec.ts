import type { Context } from '@deepseek-ai/cordis'
import type { LlmConfigurableProvider, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import { resolveBalanceConfig, type Config } from '../src/config.ts'
import { kimiProviderResolver } from '../src/kimi-adapter.ts'

const home = (...segments: string[]): string => `/tmp/home/${segments.join('/')}`

function resolvedConfig(config: Config = {}) {
  return resolveBalanceConfig(config, home)
}

/** A minimal duck-typed context: every collaborator here reaches it only through `ctx.get(name)`. */
function fakeCtx(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context
}

const KIMI_ENTRY: LlmConfigurableProvider = {
  provider: 'kimi-coding', displayName: 'Kimi For Coding', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'kimi-coding'],
}

function llmWith(entries: LlmConfigurableProvider[]): Pick<LlmRuntime, 'listConfigurableProviders'> {
  return { listConfigurableProviders: () => entries }
}

function settingsWith(section: unknown): Pick<SettingsProvider, 'get'> {
  return { get: () => section } as Pick<SettingsProvider, 'get'>
}

const EXPECTED_ENDPOINTS = {
  endpoint: 'https://api.kimi.com/coding/v1/usages',
  fallbackEndpoint: 'https://api.kimi.com/coding/v1/usage',
  userAgent: 'KimiCLI/1.6',
  timeoutMs: 8_000,
}

describe('kimiProviderResolver', () => {
  it('answers null when ctx.llm is not composed — no directory to find the route in', async () => {
    const resolve = kimiProviderResolver(fakeCtx({}), resolvedConfig())
    expect(await resolve()).toBeNull()
  })

  it('answers null when the directory names no kimi-coding route', async () => {
    const ctx = fakeCtx({ llm: llmWith([]) })
    expect(await kimiProviderResolver(ctx, resolvedConfig())()).toBeNull()
  })

  it('answers null when no key resolves, sending no request', async () => {
    const ctx = fakeCtx({
      llm: llmWith([KIMI_ENTRY]),
      settings: settingsWith({ providers: {} }),
      launchEnvironment: { get: () => undefined },
    })
    expect(await kimiProviderResolver(ctx, resolvedConfig())()).toBeNull()
  })

  it('resolves the fixed usage endpoints and the CLI user agent, defaulting to KIMI_CODING_API_KEY', async () => {
    const ctx = fakeCtx({
      llm: llmWith([KIMI_ENTRY]),
      settings: settingsWith({ providers: {} }),
      launchEnvironment: { get: (name: string) => (name === 'KIMI_CODING_API_KEY' ? { value: 'sk-kimi-abc' } : undefined) },
    })
    expect(await kimiProviderResolver(ctx, resolvedConfig())()).toEqual({
      ...EXPECTED_ENDPOINTS,
      apiKey: 'sk-kimi-abc',
    })
  })

  it('prefers a configured apiKeyEnv over the default, but never reads a chat base URL for the fixed usage route', async () => {
    const ctx = fakeCtx({
      llm: llmWith([KIMI_ENTRY]),
      settings: settingsWith({ providers: { 'kimi-coding': { apiKeyEnv: 'MY_KIMI_KEY', baseURL: 'https://api.moonshot.cn' } } }),
      launchEnvironment: {
        get: (name: string) => {
          if (name === 'MY_KIMI_KEY') return { value: 'sk-kimi-custom' }
          if (name === 'KIMI_CODING_API_KEY') return { value: 'sk-kimi-should-not-be-used' }
          return undefined
        },
      },
    })
    expect(await kimiProviderResolver(ctx, resolvedConfig())()).toEqual({
      ...EXPECTED_ENDPOINTS,
      apiKey: 'sk-kimi-custom',
    })
  })

  it('answers null when a configured apiKeyEnv is not a usable credential reference name', async () => {
    const ctx = fakeCtx({
      llm: llmWith([KIMI_ENTRY]),
      settings: settingsWith({ providers: { 'kimi-coding': { apiKeyEnv: 'not a ref name!' } } }),
      launchEnvironment: { get: () => ({ value: 'sk-kimi-x' }) },
    })
    expect(await kimiProviderResolver(ctx, resolvedConfig())()).toBeNull()
  })

  it('resolves through the credentials seam when one is composed, over the launch environment', async () => {
    const ctx = fakeCtx({
      llm: llmWith([KIMI_ENTRY]),
      settings: settingsWith({ providers: {} }),
      launchEnvironment: { get: () => ({ value: 'sk-kimi-env' }) },
      credentials: { resolve: async () => ({ value: 'sk-kimi-managed' }) },
    })
    expect((await kimiProviderResolver(ctx, resolvedConfig())())?.apiKey).toBe('sk-kimi-managed')
  })

  it('answers null when the credentials seam resolves no value', async () => {
    const ctx = fakeCtx({
      llm: llmWith([KIMI_ENTRY]),
      settings: settingsWith({ providers: {} }),
      launchEnvironment: { get: () => undefined },
      credentials: { resolve: async () => undefined },
    })
    expect(await kimiProviderResolver(ctx, resolvedConfig())()).toBeNull()
  })
})
