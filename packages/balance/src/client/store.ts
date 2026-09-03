/**
 * The browser half's own small store: what the last balance and spend reads
 * returned, the provider picker's roster, and one place to trigger the next
 * read.
 *
 * Polling lives here rather than in a component so that several mounted
 * surfaces share one request. The host caches the answer as well, so an extra
 * tab costs a round trip and no provider call, but a component per surface
 * asking on its own would still be noise nobody needs.
 *
 * Which provider is "followed" (the session's selected model's provider, or
 * DeepSeek when none resolves) is decided outside this store — `index.ts`
 * reads the session and calls {@link BalanceStore.refresh} with the answer —
 * so this module stays free of session/connection concepts and testable on
 * its own. The provider picker's own explicit choice ({@link BalanceStore.selectProvider})
 * is local to this store: it never changes which provider is followed.
 *
 * @module @sumomok/dsh-balance/client/store
 */

import type { BalanceView, ProviderOption, SpendView } from '../types.ts'

/** What every surface renders from. */
export interface BalanceState {
  /** Provider id the caller last resolved as followed (session's model, or DeepSeek). */
  followedProvider: string
  /** The followed provider's last balance read; `undefined` until the first one returns. */
  balance: BalanceView | undefined
  /** The followed provider's last spend read; `undefined` until the first one returns. */
  spend: SpendView | undefined
  /** Whether the followed-provider read is in flight. */
  loading: boolean
  /** The provider picker's roster; empty until the first load. */
  providers: readonly ProviderOption[]
  /** The picker's own explicit choice; `undefined` means "follow", i.e. render `balance`. */
  selectedProvider: string | undefined
  /** `selectedProvider`'s balance, once it differs from the followed provider and has been read. */
  preview: BalanceView | undefined
  /** `selectedProvider`'s spend, read alongside its balance; mirrors `spend` while following. */
  previewSpend: SpendView | undefined
  /** Whether the preview read is in flight. */
  previewLoading: boolean
}

/** The reads the browser half performs. */
export interface BalanceApi {
  /**
   * Read one provider's balance.
   * @param provider - provider route id; the DeepSeek route when omitted.
   * @param force - bypass the host's refresh window.
   * @returns the view.
   */
  get(provider: string | undefined, force: boolean): Promise<BalanceView>
  /**
   * Read day, month, and all-time spend.
   * @returns the view.
   */
  spend(provider: string): Promise<SpendView>
  /**
   * Read the provider picker's roster.
   * @returns the roster.
   */
  providers(): Promise<ProviderOption[]>
}

/** A store of one value with `useSyncExternalStore`'s subscribe/snapshot pair. */
export interface BalanceStore {
  /**
   * Subscribe to changes.
   * @param listener - called after every state replacement.
   * @returns the unsubscriber.
   */
  subscribe(listener: () => void): () => void
  /**
   * The current state.
   * @returns a stable reference between changes.
   */
  getSnapshot(): BalanceState
  /**
   * Read the followed provider's balance, the spend ledger, and the picker's
   * roster once.
   * @param followedProvider - provider id to read as followed.
   * @param force - bypass the host's refresh window for the balance.
   */
  refresh(followedProvider: string, force?: boolean): Promise<void>
  /**
   * Change the picker's own explicit selection.
   * @param provider - the chosen provider id, or `undefined` to follow again.
   */
  selectProvider(provider: string | undefined): void
}

/**
 * Guarantee the followed provider appears in the picker's roster.
 *
 * The host's own roster (`AccountBalanceService.providers`) is filtered to
 * providers it can currently show a balance for, with no notion of which one
 * this browser tab happens to be following — so a probe timing gap, or a
 * followed provider outside the host's static "supported" set, could
 * otherwise drop the one provider whose balance is already on screen from its
 * own picker. Its balance has already been read by the same `refresh` call
 * this roster came back with, so nothing here re-probes it; an id missing a
 * host-side display name falls back to the id itself, matching the chip's own
 * fallback for an unresolved provider name.
 * @param providers - the host's filtered roster.
 * @param followedProvider - the provider id this call refreshed as followed.
 * @returns `providers`, with the followed provider present and first.
 */
function withFollowed(providers: readonly ProviderOption[], followedProvider: string): ProviderOption[] {
  if (providers.some(option => option.id === followedProvider)) return [...providers]
  return [{ id: followedProvider, displayName: followedProvider }, ...providers]
}

/**
 * Build the store over one RPC face.
 * @param api - the mounted Remote namespace.
 * @param onError - receives a failed read; the store keeps its last good state.
 * @returns the store.
 */
export function createBalanceStore(api: BalanceApi, onError: (error: unknown) => void): BalanceStore {
  let state: BalanceState = {
    followedProvider: '',
    balance: undefined,
    spend: undefined,
    previewSpend: undefined,
    loading: false,
    providers: [],
    selectedProvider: undefined,
    preview: undefined,
    previewLoading: false,
  }
  const listeners = new Set<() => void>()
  const publish = (next: BalanceState): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }
  let inflight: Promise<void> | undefined
  const run = async (followedProvider: string, force: boolean): Promise<void> => {
    publish({ ...state, followedProvider, loading: true })
    try {
      const [balance, spend, providers] = await Promise.all([
        api.get(followedProvider, force),
        api.spend(followedProvider),
        api.providers(),
      ])
      // A later refresh for a different followed provider must win over a
      // slower earlier one settling after it — the same guard `preview()`
      // uses for the picker's own selection, applied to the followed read.
      // `state.followedProvider` already carries the latest requested id:
      // every `run()` call publishes it synchronously, before its own await,
      // so a fresher call's id is visible here the moment it starts, not only
      // once it resolves.
      if (state.followedProvider !== followedProvider) return
      publish({
        ...state,
        followedProvider,
        balance,
        spend,
        providers: withFollowed(providers, followedProvider),
        loading: false,
        // Following (no explicit picker choice) mirrors the followed read for
        // free; an explicit choice keeps whatever preview it already has
        // rather than being reset by an unrelated followed-provider refresh.
        ...state.selectedProvider === undefined ? { preview: balance, previewSpend: spend } : {},
      })
    } catch (error) {
      if (state.followedProvider !== followedProvider) return
      // A failed read leaves the last good numbers on screen. The host already
      // distinguishes "cannot reach the provider" from "cannot reach the host";
      // only the latter arrives here, and it resolves itself on reconnect.
      publish({ ...state, followedProvider, loading: false })
      onError(error)
    }
  }
  const preview = async (provider: string): Promise<void> => {
    publish({ ...state, previewLoading: true })
    try {
      const [view, spend] = await Promise.all([api.get(provider, false), api.spend(provider)])
      // A later selection (or a revert to following) must win over a slower
      // earlier preview request settling after it.
      if (state.selectedProvider !== provider) return
      publish({ ...state, preview: view, previewSpend: spend, previewLoading: false })
    } catch (error) {
      if (state.selectedProvider !== provider) return
      publish({ ...state, previewLoading: false })
      onError(error)
    }
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot() {
      return state
    },
    async refresh(followedProvider, force = false) {
      if (inflight !== undefined && !force && state.followedProvider === followedProvider) return inflight
      const task = run(followedProvider, force)
      inflight = task
      const settle = (): void => { if (inflight === task) inflight = undefined }
      void task.then(settle, settle)
      return task
    },
    selectProvider(provider) {
      // Picking the followed provider back out of the picker is the same as
      // reverting to following it: a session switch afterward must move the
      // preview along without the user picking again.
      if (provider === undefined || provider === state.followedProvider) {
        publish({ ...state, selectedProvider: undefined, preview: state.balance, previewSpend: state.spend, previewLoading: false })
        return
      }
      publish({ ...state, selectedProvider: provider, preview: undefined, previewSpend: undefined, previewLoading: false })
      void preview(provider)
    },
  }
}
