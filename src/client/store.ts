/**
 * The browser half's own small store: what the last balance and spend reads
 * returned, and one place to trigger the next one.
 *
 * Polling lives here rather than in a component so that several mounted
 * surfaces share one request. The host caches the answer as well, so an extra
 * tab costs a round trip and no provider call, but a component per surface
 * asking on its own would still be noise nobody needs.
 *
 * @module @sumomok/dsh-balance/client/store
 */

import type { BalanceView, SpendView } from '../types.ts'

/** What every surface renders from. */
export interface BalanceState {
  /** The last balance read; `undefined` until the first one returns. */
  balance: BalanceView | undefined
  /** The last spend read; `undefined` until the first one returns. */
  spend: SpendView | undefined
  /** Whether a read is in flight, so the chip can show it is refreshing. */
  loading: boolean
}

/** The two reads the browser half performs. */
export interface BalanceApi {
  /**
   * Read the balance.
   * @param force - bypass the host's refresh window.
   * @returns the view.
   */
  get(force: boolean): Promise<BalanceView>
  /**
   * Read day, month, and all-time spend.
   * @returns the view.
   */
  spend(): Promise<SpendView>
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
   * Read both faces once.
   * @param force - bypass the host's refresh window for the balance.
   */
  refresh(force?: boolean): Promise<void>
}

/**
 * Build the store over one RPC face.
 * @param api - the mounted Remote namespace.
 * @param onError - receives a failed read; the store keeps its last good state.
 * @returns the store.
 */
export function createBalanceStore(api: BalanceApi, onError: (error: unknown) => void): BalanceStore {
  let state: BalanceState = { balance: undefined, spend: undefined, loading: false }
  const listeners = new Set<() => void>()
  const publish = (next: BalanceState): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }
  let inflight: Promise<void> | undefined
  const run = async (force: boolean): Promise<void> => {
    publish({ ...state, loading: true })
    try {
      const [balance, spend] = await Promise.all([api.get(force), api.spend()])
      publish({ balance, spend, loading: false })
    } catch (error) {
      // A failed read leaves the last good numbers on screen. The host already
      // distinguishes "cannot reach the provider" from "cannot reach the host";
      // only the latter arrives here, and it resolves itself on reconnect.
      publish({ ...state, loading: false })
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
    async refresh(force = false) {
      if (inflight !== undefined && !force) return inflight
      const task = run(force)
      inflight = task
      const settle = (): void => { if (inflight === task) inflight = undefined }
      void task.then(settle, settle)
      return task
    },
  }
}
