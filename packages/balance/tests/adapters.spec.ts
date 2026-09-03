import type { Context } from '@deepseek-ai/cordis'
import type { LlmConfigurableProvider, LlmProviderInfo, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdapterRegistry, pickableProviderRoster, providerRoster } from '../src/adapters.ts'
import { resolveBalanceConfig } from '../src/config.ts'
import { KIMI_CODING_PROVIDER_ID } from '../src/kimi-adapter.ts'
import { MOONSHOTAI_CN_PROVIDER_ID, MOONSHOTAI_PROVIDER_ID } from '../src/moonshot-adapter.ts'
import { DEEPSEEK_DISPLAY_NAME, DEEPSEEK_PROVIDER_ID } from '../src/provider-id.ts'

const home = (...segments: string[]): string => `/tmp/home/${segments.join('/')}`
const CONFIG = resolveBalanceConfig({}, home)

function fakeCtx(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context
}

const MOONSHOTAI_ENTRY: LlmConfigurableProvider = {
  provider: MOONSHOTAI_PROVIDER_ID, displayName: 'Moonshot AI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'moonshotai'],
}

const MOONSHOTAI_CN_ENTRY: LlmConfigurableProvider = {
  provider: MOONSHOTAI_CN_PROVIDER_ID, displayName: 'Moonshot AI CN', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'moonshotai-cn'],
}

const KIMI_ENTRY: LlmConfigurableProvider = {
  provider: KIMI_CODING_PROVIDER_ID, displayName: 'Kimi For Coding', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'kimi-coding'],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdapterRegistry', () => {
  it('answers unconfigured, with no request, when DeepSeek has no key', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const ctx = fakeCtx({ launchEnvironment: { get: () => undefined } })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await registry.get(DEEPSEEK_PROVIDER_ID, false)).toEqual({ state: 'unconfigured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('answers unconfigured, with no request, for a provider ctx.llm does not know', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const ctx = fakeCtx({ llm: { listConfigurableProviders: () => [] } })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await registry.get('unknown-provider', false)).toEqual({ state: 'unconfigured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('downgrades a generic-adapter failure to the quiet unconfigured state, not unavailable', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }))
    const entry: LlmConfigurableProvider = {
      provider: 'gw', displayName: 'Gateway', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'gw'],
    }
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [entry] },
      settings: { get: () => ({ providers: { gw: { baseURL: 'https://gw.example', apiKeyEnv: 'GW_KEY' } } }) },
      launchEnvironment: { get: (name: string) => (name === 'GW_KEY' ? { value: 'sk-x' } : undefined) },
    })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await registry.get('gw', false)).toEqual({ state: 'unconfigured' })
  })

  it('keeps DeepSeek\'s own unavailable reason rather than downgrading it', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 503 }))
    const ctx = fakeCtx({ launchEnvironment: { get: (name: string) => (name === 'DEEPSEEK_API_KEY' ? { value: 'sk-x' } : undefined) } })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await registry.get(DEEPSEEK_PROVIDER_ID, false)).toEqual({ state: 'unavailable', reason: 'http', status: 503, fetchedAt: expect.any(Number) })
  })

  it('memoizes one reader per provider, so its cache actually caches', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '1', granted_balance: '0', topped_up_balance: '1' }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchImpl)
    const ctx = fakeCtx({ launchEnvironment: { get: (name: string) => (name === 'DEEPSEEK_API_KEY' ? { value: 'sk-x' } : undefined) } })
    const registry = new AdapterRegistry(ctx, CONFIG)
    await registry.get(DEEPSEEK_PROVIDER_ID, false)
    await registry.get(DEEPSEEK_PROVIDER_ID, false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('answers unconfigured, with no request, when moonshotai has no key', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [MOONSHOTAI_ENTRY] },
      launchEnvironment: { get: () => undefined },
    })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await registry.get(MOONSHOTAI_PROVIDER_ID, false)).toEqual({ state: 'unconfigured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps moonshotai\'s own unavailable reason rather than downgrading it — a named adapter, not the generic fallback', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 401 }))
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [MOONSHOTAI_ENTRY] },
      launchEnvironment: { get: (name: string) => (name === 'MOONSHOT_API_KEY' ? { value: 'sk-x' } : undefined) },
    })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await registry.get(MOONSHOTAI_PROVIDER_ID, false))
      .toEqual({ state: 'unavailable', reason: 'http', status: 401, fetchedAt: expect.any(Number) })
  })

  it('reads moonshotai and moonshotai-cn through their own dedicated parser, each tagged with its own fixed currency', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      code: 0,
      data: { available_balance: 10, voucher_balance: 2, cash_balance: 8 },
      scode: '0x0',
      status: true,
    }), { status: 200 }))
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [MOONSHOTAI_ENTRY, MOONSHOTAI_CN_ENTRY] },
      launchEnvironment: { get: (name: string) => (name === 'MOONSHOT_API_KEY' ? { value: 'sk-x' } : undefined) },
    })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await registry.get(MOONSHOTAI_PROVIDER_ID, false)).toMatchObject({ state: 'ok', currency: 'USD', total: '10' })
    expect(await registry.get(MOONSHOTAI_CN_PROVIDER_ID, false)).toMatchObject({ state: 'ok', currency: 'CNY', total: '10' })
  })

  it('reads kimi-coding through its own quota reader, returning windows rather than a money balance', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      usage: { used: 30, limit: 100 },
      limits: [{ window: { duration: 5, timeUnit: 'hour' }, detail: { used: 1, limit: 20 } }],
    }), { status: 200 }))
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [KIMI_ENTRY] },
      launchEnvironment: { get: (name: string) => (name === 'KIMI_CODING_API_KEY' ? { value: 'sk-kimi-x' } : undefined) },
    })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await registry.get(KIMI_CODING_PROVIDER_ID, false)).toMatchObject({
      state: 'quota',
      windows: [{ key: '5h', usedPercent: 5 }, { key: 'weekly', usedPercent: 30 }],
    })
  })

  it('keeps kimi-coding\'s own unavailable reason rather than downgrading it — a named adapter, not the generic fallback', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 401 }))
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [KIMI_ENTRY] },
      launchEnvironment: { get: (name: string) => (name === 'KIMI_CODING_API_KEY' ? { value: 'sk-kimi-x' } : undefined) },
    })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await registry.get(KIMI_CODING_PROVIDER_ID, false))
      .toEqual({ state: 'unavailable', reason: 'http', status: 401, fetchedAt: expect.any(Number) })
  })
})

describe('providerRoster', () => {
  it('always includes DeepSeek, even when ctx.llm is not composed', () => {
    expect(providerRoster(fakeCtx({}))).toEqual([{ id: DEEPSEEK_PROVIDER_ID, displayName: DEEPSEEK_DISPLAY_NAME }])
  })

  it('lists every declared configurable provider, plus a registered route the directory does not declare', () => {
    const configurable: LlmConfigurableProvider[] = [
      { provider: DEEPSEEK_PROVIDER_ID, displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
      { provider: 'gw', displayName: 'Gateway', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'gw'] },
    ]
    const registered: LlmProviderInfo[] = [
      { id: DEEPSEEK_PROVIDER_ID, name: 'DeepSeek' },
      { id: 'gw', name: 'Gateway' },
      { id: 'undeclared', name: 'Undeclared Route' },
    ]
    const llm: Pick<LlmRuntime, 'listConfigurableProviders' | 'listProviders'> = {
      listConfigurableProviders: () => configurable,
      listProviders: () => registered,
    }
    const ctx = fakeCtx({ llm })
    expect(providerRoster(ctx)).toEqual([
      { id: DEEPSEEK_PROVIDER_ID, displayName: 'DeepSeek' },
      { id: 'gw', displayName: 'Gateway' },
      { id: 'undeclared', displayName: 'Undeclared Route' },
    ])
  })
})

describe('pickableProviderRoster', () => {
  // Satisfies every reader a probe might reach: DeepSeek's own
  // `is_available`/`balance_infos` shape, the generic adapter's default
  // first-tried `one-api-quota` shape (`data.quota`), and the Moonshot named
  // adapter's `code`/`data.{available_balance,voucher_balance,cash_balance}`/
  // `scode`/`status` shape — each reader ignores the fields it does not check,
  // so one body answers whichever adapter is probing.
  // Also carries the Kimi quota reader's `usage` window, so this one body
  // answers that named adapter's probe too.
  function ok(): Response {
    return new Response(JSON.stringify({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '1', granted_balance: '0', topped_up_balance: '1' }],
      data: { quota: 500_000, available_balance: 1, voucher_balance: 0, cash_balance: 1 },
      usage: { used: 1, limit: 100 },
      code: 0,
      scode: '0x0',
      status: true,
    }), { status: 200 })
  }

  it('drops a route the directory does not declare, without probing it (no fetch call)', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const llm: Pick<LlmRuntime, 'listConfigurableProviders' | 'listProviders'> = {
      listConfigurableProviders: () => [],
      listProviders: () => [{ id: 'undeclared', name: 'Undeclared Route' }],
    }
    const ctx = fakeCtx({ llm })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await pickableProviderRoster(ctx, registry)).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('drops a declared but unconfigured provider — probed, found to resolve no credential', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const entry: LlmConfigurableProvider = {
      provider: 'gw', displayName: 'Gateway', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'gw'],
    }
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [entry], listProviders: () => [] },
      launchEnvironment: { get: () => undefined },
    })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await pickableProviderRoster(ctx, registry)).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps DeepSeek once its own credential resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()))
    const ctx = fakeCtx({
      launchEnvironment: { get: (name: string) => (name === 'DEEPSEEK_API_KEY' ? { value: 'sk-x' } : undefined) },
    })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await pickableProviderRoster(ctx, registry))
      .toEqual([{ id: DEEPSEEK_PROVIDER_ID, displayName: DEEPSEEK_DISPLAY_NAME }])
  })

  it('keeps a declared provider once its credential resolves, beside DeepSeek', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()))
    const entry: LlmConfigurableProvider = {
      provider: 'gw', displayName: 'Gateway', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'gw'],
    }
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [entry], listProviders: () => [] },
      settings: { get: () => ({ providers: { gw: { baseURL: 'https://gw.example', apiKeyEnv: 'GW_KEY' } } }) },
      launchEnvironment: {
        get: (name: string) => {
          if (name === 'DEEPSEEK_API_KEY') return { value: 'sk-deepseek' }
          if (name === 'GW_KEY') return { value: 'sk-gw' }
          return undefined
        },
      },
    })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await pickableProviderRoster(ctx, registry)).toEqual([
      { id: DEEPSEEK_PROVIDER_ID, displayName: DEEPSEEK_DISPLAY_NAME },
      { id: 'gw', displayName: 'Gateway' },
    ])
  })

  it('keeps a configured moonshotai provider beside DeepSeek', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()))
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [MOONSHOTAI_ENTRY], listProviders: () => [] },
      launchEnvironment: {
        get: (name: string) => {
          if (name === 'DEEPSEEK_API_KEY') return { value: 'sk-deepseek' }
          if (name === 'MOONSHOT_API_KEY') return { value: 'sk-moonshot' }
          return undefined
        },
      },
    })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await pickableProviderRoster(ctx, registry)).toEqual([
      { id: DEEPSEEK_PROVIDER_ID, displayName: DEEPSEEK_DISPLAY_NAME },
      { id: MOONSHOTAI_PROVIDER_ID, displayName: 'Moonshot AI' },
    ])
  })

  it('keeps a configured kimi-coding provider beside DeepSeek', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()))
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [KIMI_ENTRY], listProviders: () => [] },
      launchEnvironment: {
        get: (name: string) => {
          if (name === 'DEEPSEEK_API_KEY') return { value: 'sk-deepseek' }
          if (name === 'KIMI_CODING_API_KEY') return { value: 'sk-kimi' }
          return undefined
        },
      },
    })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await pickableProviderRoster(ctx, registry)).toEqual([
      { id: DEEPSEEK_PROVIDER_ID, displayName: DEEPSEEK_DISPLAY_NAME },
      { id: KIMI_CODING_PROVIDER_ID, displayName: 'Kimi For Coding' },
    ])
  })

  it('drops an unconfigured moonshotai-cn provider — statically supported, but its credential resolves to nothing', async () => {
    const fetchImpl = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetchImpl)
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [MOONSHOTAI_CN_ENTRY], listProviders: () => [] },
      launchEnvironment: {
        get: (name: string) => (name === 'DEEPSEEK_API_KEY' ? { value: 'sk-deepseek' } : undefined),
      },
    })
    const registry = new AdapterRegistry(ctx, CONFIG)
    expect(await pickableProviderRoster(ctx, registry)).toEqual([
      { id: DEEPSEEK_PROVIDER_ID, displayName: DEEPSEEK_DISPLAY_NAME },
    ])
    // moonshotai-cn was probed (it is statically supported) but never fetched:
    // its resolver returns null before any request, same as DeepSeek's own
    // no-key case.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
