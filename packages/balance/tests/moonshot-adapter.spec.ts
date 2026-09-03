import type { Context } from '@deepseek-ai/cordis'
import type { LlmConfigurableProvider, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import { resolveBalanceConfig, type Config } from '../src/config.ts'
import { MOONSHOTAI_CN_ROUTE, MOONSHOTAI_ROUTE, moonshotProviderResolver } from '../src/moonshot-adapter.ts'

const home = (...segments: string[]): string => `/tmp/home/${segments.join('/')}`

function resolvedConfig(config: Config = {}) {
  return resolveBalanceConfig(config, home)
}

/** A minimal duck-typed context: every collaborator here reaches it only through `ctx.get(name)`. */
function fakeCtx(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context
}

const MOONSHOTAI_ENTRY: LlmConfigurableProvider = {
  provider: 'moonshotai', displayName: 'Moonshot AI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'moonshotai'],
}

const MOONSHOTAI_CN_ENTRY: LlmConfigurableProvider = {
  provider: 'moonshotai-cn', displayName: 'Moonshot AI CN', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'moonshotai-cn'],
}

function llmWith(entries: LlmConfigurableProvider[]): Pick<LlmRuntime, 'listConfigurableProviders'> {
  return { listConfigurableProviders: () => entries }
}

function settingsWith(section: unknown): Pick<SettingsProvider, 'get'> {
  return { get: () => section } as Pick<SettingsProvider, 'get'>
}

describe('moonshotProviderResolver', () => {
  it('answers null when ctx.llm is not composed — no directory to find the route in', async () => {
    const resolve = moonshotProviderResolver(fakeCtx({}), MOONSHOTAI_ROUTE, resolvedConfig())
    expect(await resolve()).toBeNull()
  })

  it('answers null when the directory names no such route', async () => {
    const ctx = fakeCtx({ llm: llmWith([]) })
    const resolve = moonshotProviderResolver(ctx, MOONSHOTAI_ROUTE, resolvedConfig())
    expect(await resolve()).toBeNull()
  })

  it('answers null when no key resolves, sending no request', async () => {
    const ctx = fakeCtx({
      llm: llmWith([MOONSHOTAI_ENTRY]),
      settings: settingsWith({ providers: {} }),
      launchEnvironment: { get: () => undefined },
    })
    const resolve = moonshotProviderResolver(ctx, MOONSHOTAI_ROUTE, resolvedConfig())
    expect(await resolve()).toBeNull()
  })

  it('falls back to the route\'s public base URL and its shared MOONSHOT_API_KEY default when the profile names neither', async () => {
    const ctx = fakeCtx({
      llm: llmWith([MOONSHOTAI_ENTRY]),
      settings: settingsWith({ providers: {} }),
      launchEnvironment: { get: (name: string) => (name === 'MOONSHOT_API_KEY' ? { value: 'sk-shared' } : undefined) },
    })
    const resolve = moonshotProviderResolver(ctx, MOONSHOTAI_ROUTE, resolvedConfig())
    expect(await resolve()).toEqual({
      endpoint: 'https://api.moonshot.ai/v1/users/me/balance',
      apiKey: 'sk-shared',
      currency: 'USD',
      timeoutMs: 8_000,
    })
  })

  it('falls back to the China route\'s own public base URL and fixed currency', async () => {
    const ctx = fakeCtx({
      llm: llmWith([MOONSHOTAI_CN_ENTRY]),
      settings: settingsWith({ providers: {} }),
      launchEnvironment: { get: (name: string) => (name === 'MOONSHOT_API_KEY' ? { value: 'sk-shared' } : undefined) },
    })
    const resolve = moonshotProviderResolver(ctx, MOONSHOTAI_CN_ROUTE, resolvedConfig())
    expect(await resolve()).toEqual({
      endpoint: 'https://api.moonshot.cn/v1/users/me/balance',
      apiKey: 'sk-shared',
      currency: 'CNY',
      timeoutMs: 8_000,
    })
  })

  it('prefers a configured baseURL and apiKeyEnv over both defaults', async () => {
    const ctx = fakeCtx({
      llm: llmWith([MOONSHOTAI_ENTRY]),
      settings: settingsWith({ providers: { moonshotai: { baseURL: 'https://gw.example/moonshot', apiKeyEnv: 'MY_MOONSHOT_KEY' } } }),
      launchEnvironment: {
        get: (name: string) => {
          if (name === 'MY_MOONSHOT_KEY') return { value: 'sk-custom' }
          if (name === 'MOONSHOT_API_KEY') return { value: 'sk-should-not-be-used' }
          return undefined
        },
      },
    })
    const resolve = moonshotProviderResolver(ctx, MOONSHOTAI_ROUTE, resolvedConfig())
    expect(await resolve()).toEqual({
      endpoint: 'https://gw.example/v1/users/me/balance',
      apiKey: 'sk-custom',
      currency: 'USD',
      timeoutMs: 8_000,
    })
  })

  it('resolves through the credentials seam when one is composed, over the launch environment', async () => {
    const ctx = fakeCtx({
      llm: llmWith([MOONSHOTAI_ENTRY]),
      settings: settingsWith({ providers: {} }),
      launchEnvironment: { get: () => ({ value: 'sk-env' }) },
      credentials: { resolve: async () => ({ value: 'sk-managed' }) },
    })
    const resolve = moonshotProviderResolver(ctx, MOONSHOTAI_ROUTE, resolvedConfig())
    expect((await resolve())?.apiKey).toBe('sk-managed')
  })

  it('rejects a non-http(s) configured base URL', async () => {
    const ctx = fakeCtx({
      llm: llmWith([MOONSHOTAI_ENTRY]),
      settings: settingsWith({ providers: { moonshotai: { baseURL: 'file:///etc/passwd', apiKeyEnv: 'MOONSHOT_API_KEY' } } }),
      launchEnvironment: { get: () => ({ value: 'sk-x' }) },
    })
    const resolve = moonshotProviderResolver(ctx, MOONSHOTAI_ROUTE, resolvedConfig())
    expect(await resolve()).toBeNull()
  })
})
