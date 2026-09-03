/**
 * Browser half: the sidebar-footer balance chip and the per-session spend line.
 *
 * The only host path is the Typert Remote this package's host half exports —
 * three reads, no mutators — mounted here through `ctx.remote.$mount()`. This
 * plugin fetches nothing itself and knows no key, no endpoint, and no prompt.
 *
 * The chip follows the current session: `resolveFollowedProviderId` reads the
 * session's selected model straight off its durable `modelSelection`
 * projection — the same synchronous read `@haoran/dsh-vision-switch` uses —
 * falling back to DeepSeek when no session is open or the read comes back
 * empty. A session switch reruns it immediately; the shared poll reruns it
 * every tick, which is also what picks up a model switch made without
 * leaving the session.
 *
 * @module @sumomok/dsh-balance/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the generated Remote API and the `ctx.remote` merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the `ctx.locale` merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the Context.slots merge (`ctx.slots`).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the sidebar and conversation SlotMap keys this plugin registers into.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// The `ctx.settingsScope` merge and the `settings.section` SlotMap key.
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Config } from '../config.ts'
import { BALANCE_SETTINGS_NAMESPACE_NAME } from '../settings-namespace.ts'
import type { BalanceView, ProviderOption, SpendView } from '../types.ts'
import { CONTRIBUTION } from './contribution.ts'
import { FooterChip } from './FooterChip.tsx'
import { en, NS, zh, type BalanceKey } from './locales.ts'
import { PriceTableSection } from './PriceTableSection.tsx'
import { resolveFollowedProviderId } from './resolve-followed-provider.ts'
import { SessionSpendLine } from './SessionSpendLine.tsx'
import { createBalanceStore, type BalanceApi, type BalanceStore } from './store.ts'
import { insertStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** `@sumomok/dsh-balance` copy. */
    balance: BalanceKey
  }
}

export type { FooterChipProps } from './FooterChip.tsx'
export type { PriceTableSectionProps } from './PriceTableSection.tsx'
export type { SessionSpendLineProps } from './SessionSpendLine.tsx'
export type { BalanceApi, BalanceState, BalanceStore } from './store.ts'

/** Required browser services. */
export const inject = ['slots', 'locale', 'remote', 'sessions']

/** One RPC result, as the gateway's namespace methods return it. */
type RemoteResult<T> = { ok: true; value: T } | { ok: false; error?: { message?: string } }

/** The namespace face `ctx.get('remote.accountBalance')` returns once mounted. */
interface AccountBalanceRemote {
  get(provider?: string, force?: boolean): Promise<RemoteResult<BalanceView>>
  spend(provider?: string): Promise<RemoteResult<SpendView>>
  providers(): Promise<RemoteResult<ProviderOption[]>>
}

/** Unwrap one RPC result, turning a transport failure into a throw the store contains. */
function unwrap<T>(result: RemoteResult<T>, method: string): T {
  if (result.ok) return result.value
  throw new Error(result.error?.message ?? `@sumomok/dsh-balance: accountBalance/${method} failed`)
}

/**
 * Start the shared polling loop.
 *
 * A hidden tab polls nothing: the numbers are only interesting to someone
 * looking at them, and the tick after the tab comes back is the one that
 * matters. The host's own cache means several visible tabs still cost the
 * provider one request per refresh window.
 *
 * `window.setInterval` rather than the `timer` service: this bundle is a real
 * module-table client bundle, where the browser globals are not withheld, and
 * the `timer` service is provided by an extension a composition need not
 * include. Disposal stays cordis-owned through the effect that starts it.
 * @param refresh - re-resolves the followed provider and reads it; the caller
 * owns what "followed" means, so this loop knows nothing of sessions.
 * @param everyMs - the poll period.
 * @returns a disposer stopping the loop.
 */
export function startPolling(refresh: () => void, everyMs: number): () => void {
  const tick = (): void => {
    if (typeof document !== 'undefined' && document.hidden) return
    refresh()
  }
  const handle = globalThis.setInterval(tick, everyMs)
  return () => { globalThis.clearInterval(handle) }
}

export { resolveFollowedProviderId } from './resolve-followed-provider.ts'

/**
 * Mount the browser half.
 * @param ctx - the browser root context.
 */
export async function apply(ctx: Context): Promise<void> {
  const unmount = await ctx.remote.$mount(CONTRIBUTION)
  ctx.effect(() => () => { void unmount() }, 'dsh-balance: remote contribution')
  const remote = ctx.get('remote.accountBalance') as AccountBalanceRemote | undefined
  // The namespace is installed by the mount above; its absence means the
  // gateway rejected the contribution, which it has already reported.
  if (remote === undefined) return

  const api: BalanceApi = {
    async get(provider, force) {
      return unwrap(await remote.get(provider, force), 'get')
    },
    async spend(provider) {
      return unwrap(await remote.spend(provider), 'spend')
    },
    async providers() {
      return unwrap(await remote.providers(), 'providers')
    },
  }
  const store = createBalanceStore(api, (error) => {
    console.error('@sumomok/dsh-balance: read failed', error)
  })

  ctx.effect(() => insertStyles(), 'dsh-balance: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-balance: dictionaries')
  const t = ctx.locale.bind(NS)

  // See `resolveFollowedProviderId`'s doc: `ctx.sessions`'s own inferred type
  // is unreliable in this package's single TypeScript program, so it is cast
  // once here rather than read again at each call site.
  const sessions = ctx.sessions as unknown as ISessions
  const refreshFollowed = async (force = false): Promise<void> => {
    const provider = resolveFollowedProviderId(sessions)
    await store.refresh(provider, force)
  }

  // The first read also settles the surface toggles, which ride the spend read
  // because a client entry has no config channel of its own.
  await refreshFollowed()
  const refreshMs = store.getSnapshot().spend?.ui.refreshMs ?? 60_000
  ctx.effect(() => startPolling(() => { void refreshFollowed() }, refreshMs), 'dsh-balance: polling')

  // A session switch reloads the followed provider's balance right away
  // rather than waiting for the next poll tick.
  ctx.effect(() => sessions.list.subscribe(() => { void refreshFollowed() }), 'dsh-balance: follow session switches')

  const footerInjected = (): {
    hooks: { balance: BalanceStore }
    refresh: (force: boolean) => void
    selectProvider: (provider: string | undefined) => void
  } => ({
    hooks: { balance: store },
    refresh: (force: boolean) => { void refreshFollowed(force) },
    selectProvider: (provider: string | undefined) => { store.selectProvider(provider) },
  })

  const sessionSpendInjected = (): { hooks: { balance: BalanceStore }; refresh: (force: boolean) => void } => ({
    hooks: { balance: store },
    refresh: (force: boolean) => { void refreshFollowed(force) },
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-balance',
    // A moderate order: several plugins may share this row, and this chip
    // has no claim to either edge of it.
    order: 10,
    locale: NS,
    inject: footerInjected,
  }, FooterChip))

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'dsh-balance-session',
    // After the shipped stats line, which sits at the default order.
    order: 10,
    locale: NS,
    inject: sessionSpendInjected,
  }, SessionSpendLine))

  // `ctx.settingsScope` is a service only `@deepseek-ai/dsh-client-ui-settings`
  // provides — the same package that declares this slot — and reading it
  // through property access (`ctx.settingsScope`) requires declaring it in
  // this plugin's own required `inject`, which would turn an optional
  // registration into a hard dependency. `ctx.get` is the ad-hoc accessor
  // every other optional service in this file already reads through, so the
  // bind lives inside the factory, guarded the same way.
  ctx.slots.inject('settings.section', () => {
    const scope = ctx.get('settingsScope')?.bind<Config>({ namespace: BALANCE_SETTINGS_NAMESPACE_NAME })
    if (scope === undefined) return () => undefined
    const settingsInjected = (): { scope: SettingsScope<Config> } => ({ scope })
    return ctx.slots.register({
      name: 'settings.section',
      id: 'balance',
      // After every shipped tab (General 0, Models 10, Plugins 15, Agent
      // presets 20): this plugin's own settings, not core configuration.
      order: 30,
      label: () => t('settings.nav'),
      locale: NS,
      inject: settingsInjected,
    }, PriceTableSection)
  })
}
