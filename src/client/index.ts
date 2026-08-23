/**
 * Browser half: the sidebar-footer balance chip and the per-session spend line.
 *
 * The only host path is the Typert Remote this package's host half exports —
 * two reads, no mutators — mounted here through `ctx.remote.$mount()`. This
 * plugin fetches nothing itself and knows no key, no endpoint, and no prompt.
 *
 * @module @sumomok/dsh-balance/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the generated Remote API and the `ctx.remote` merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the `ctx.locale` merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the sidebar and conversation SlotMap keys this plugin registers into.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { BalanceView, SpendView } from '../types.ts'
import { CONTRIBUTION } from './contribution.ts'
import { FooterChip } from './FooterChip.tsx'
import { en, NS, zh, type BalanceKey } from './locales.ts'
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
export type { SessionSpendLineProps } from './SessionSpendLine.tsx'
export type { BalanceApi, BalanceState, BalanceStore } from './store.ts'

/** Required browser services. */
export const inject = ['slots', 'locale', 'remote']

/** One RPC result, as the gateway's namespace methods return it. */
type RemoteResult<T> = { ok: true; value: T } | { ok: false; error?: { message?: string } }

/** The namespace face `ctx.get('remote.accountBalance')` returns once mounted. */
interface AccountBalanceRemote {
  get(force?: boolean): Promise<RemoteResult<BalanceView>>
  spend(): Promise<RemoteResult<SpendView>>
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
 * @param store - the store to refresh.
 * @param everyMs - the poll period.
 * @returns a disposer stopping the loop.
 */
export function startPolling(store: BalanceStore, everyMs: number): () => void {
  const tick = (): void => {
    if (typeof document !== 'undefined' && document.hidden) return
    void store.refresh()
  }
  const handle = globalThis.setInterval(tick, everyMs)
  return () => { globalThis.clearInterval(handle) }
}

/**
 * Mount the browser half.
 * @param ctx - the browser root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const unmount = await ctx.remote.$mount(CONTRIBUTION)
  ctx.effect(() => () => { void unmount() }, 'dsh-balance: remote contribution')
  const remote = ctx.get('remote.accountBalance') as AccountBalanceRemote | undefined
  // The namespace is installed by the mount above; its absence means the
  // gateway rejected the contribution, which it has already reported.
  if (remote === undefined) return

  const api: BalanceApi = {
    async get(force) {
      return unwrap(await remote.get(force), 'get')
    },
    async spend() {
      return unwrap(await remote.spend(), 'spend')
    },
  }
  const store = createBalanceStore(api, (error) => {
    console.error('@sumomok/dsh-balance: read failed', error)
  })

  ctx.effect(() => insertStyles(), 'dsh-balance: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-balance: dictionaries')

  // The first read also settles the surface toggles, which ride the spend read
  // because a client entry has no config channel of its own.
  await store.refresh()
  const refreshMs = store.getSnapshot().spend?.ui.refreshMs ?? 60_000
  ctx.effect(() => startPolling(store, refreshMs), 'dsh-balance: polling')

  const injected = (): { hooks: { balance: BalanceStore }; refresh: (force: boolean) => void } => ({
    hooks: { balance: store },
    refresh: (force: boolean) => { void store.refresh(force) },
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-balance',
    order: 10,
    locale: NS,
    inject: injected,
  }, FooterChip))

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'dsh-balance-session',
    // After the shipped stats line, which sits at the default order.
    order: 10,
    locale: NS,
    inject: injected,
  }, SessionSpendLine))
}
