/**
 * Wire types shared by the host half, the browser half, and the Typert
 * manifest. Nothing here carries a secret, a URL, or a raw network error text:
 * every value in this module is something the browser is allowed to render.
 *
 * @module @sumomok/dsh-balance/types
 */

/** Why a balance read could not produce numbers. */
export type BalanceUnavailableReason = 'http' | 'network' | 'timeout' | 'malformed'

/**
 * One usage window's consumption, for a quota-metered provider that reports a
 * percent consumed rather than a money balance.
 */
export interface QuotaWindow {
  /**
   * Stable identifier for the window. `weekly` is the primary window the chip
   * shows; a rolling window carries its own compact span as the key (`5h`).
   * The UI localizes the keys it knows and shows any other key as written.
   */
  key: string
  /** Percent of this window's allowance already used, 0–100. */
  usedPercent: number
  /** Epoch milliseconds when the window's allowance resets, or `null` when the provider names none. */
  resetsAt: number | null
}

/** The provider's answer about the account, as the UI needs it. */
export type BalanceView =
  | {
    state: 'ok'
    /** Currency of the selected balance entry, as the provider spelled it. */
    currency: string
    /** Total balance, kept as the provider's decimal string. */
    total: string
    /**
     * Granted (promotional) portion of the total. Only the DeepSeek adapter's
     * endpoint breaks the total down this way; a generic-adapter read carries
     * no breakdown, so the popover renders `total` alone for one.
     */
    granted?: string
    /** Topped-up (paid) portion of the total; see {@link granted}. */
    toppedUp?: string
    /** The provider's own verdict on whether the account can serve requests. */
    isAvailable: boolean
    /** Epoch milliseconds of the read these numbers came from. */
    fetchedAt: number
    /** Whether this is a retained earlier read served because a refresh failed. */
    stale: boolean
  }
  | {
    /**
     * No balance can be asked for: no API key resolves, the configured
     * endpoint is not one this plugin may talk to, no adapter serves this
     * provider at all, or the generic adapter tried every endpoint shape it
     * knows and none answered (quietly, not as {@link BalanceUnavailableReason}
     * — a best-effort provider that answers nothing recognisable is reported
     * the same way as one nobody configured a key for). The UI renders
     * nothing for the followed provider, and a short explanatory line for one
     * explicitly chosen in the provider picker.
     */
    state: 'unconfigured'
  }
  | {
    /**
     * A subscription quota rather than a money balance: the provider meters
     * usage in one or more windows, each a percent consumed, with no currency
     * amount. Only a quota-metered adapter (`kimi-coding`) produces this; a
     * money adapter never does. The chip shows the first window's used percent;
     * the popover lists every window.
     */
    state: 'quota'
    /** The metered windows, the chip's primary window first; never empty. */
    windows: QuotaWindow[]
    /** The provider's own verdict on whether the account can serve requests. */
    isAvailable: boolean
    /** Epoch milliseconds of the read these windows came from. */
    fetchedAt: number
    /** Whether this is a retained earlier read served because a refresh failed. */
    stale: boolean
  }
  | {
    state: 'unavailable'
    /** Failure class, with no provider or network text attached. */
    reason: BalanceUnavailableReason
    /** HTTP status, when the failure was a response rather than a transport error. */
    status?: number
    /** Epoch milliseconds of the attempt. */
    fetchedAt: number
  }

/**
 * A read that produced something to render — a money balance or a usage quota
 * — before staleness is decided at serve time. Both carry `fetchedAt` and
 * `stale`, so the reader's cache ({@link file://./balance.ts}) treats them the
 * same way.
 */
export type BalanceSuccessView = Extract<BalanceView, { state: 'ok' | 'quota' }>

/** Spend over one period. */
export interface SpendTotals {
  /** Cost over the period, in the price table's currency. */
  cost: number
  /** Cost split by the schedule (price tier) that priced each request. */
  bySchedule: Record<string, number>
  /** Requests counted in the period. */
  requests: number
  /** Tokens in the period the price table prices no rate for. */
  unpricedTokens: number
}

/**
 * Display facts the deployment configured, carried on the spend read.
 *
 * The browser half has no other channel to them: a client entry is composed
 * from the boot graph, which carries no per-plugin config. Rather than add a
 * third RPC method whose only job is to answer "what did the operator set",
 * these ride the read the footer already performs.
 */
export interface BalanceUiConfig {
  /** Whether the sidebar-footer chip is put up at all. */
  footer: boolean
  /** Whether the per-session spend line under the composer is put up. */
  sessionSpend: boolean
  /** Balance below which the chip is tinted as a warning. */
  lowBalance: number
  /** Balance below which the chip is tinted as critical. */
  criticalBalance: number
  /** How often the browser half should poll, matching the host's own cache window. */
  refreshMs: number
}

/** One provider's spend on this installation, as the footer popover renders it. */
export interface SpendView {
  /** The provider these totals are for: the ledger's rows on that route only. */
  provider: string
  /** Spend since local midnight. */
  today: SpendTotals
  /** Spend since the first local day of the current month. */
  month: SpendTotals
  /** Spend over every ledger row retention has kept. */
  allTime: SpendTotals
  /** Epoch milliseconds of the oldest retained ledger row; `null` while empty. */
  since: number | null
  /** ISO 4217 code every cost above is quoted in. */
  currency: string
  /** The price table's `asOf` date, shown as "prices as of". */
  pricesAsOf: string
  /** IANA timezone the day and month boundaries are taken in. */
  timezone: string
  /** Display facts the deployment configured. */
  ui: BalanceUiConfig
}

/** One model's share of a session's spend. */
export interface SessionSpendModel {
  /** Input tokens billed at the cache-miss rate. */
  input: number
  /** Input tokens billed at the cache-hit rate. */
  cacheRead: number
  /** Tokens billed at the cache-write rate. */
  cacheWrite: number
  /** Generated tokens excluding reasoning. */
  output: number
  /** Reasoning tokens. */
  reasoning: number
  /** Cost of this model's share, in the price table's currency. */
  cost: number
}

/** One session's spend, folded from that session's own logged usage. */
export interface SessionSpend {
  /** Total cost of the session's priced steps. */
  total: number
  /** ISO 4217 code `total` is quoted in. */
  currency: string
  /** Per-model breakdown, keyed by the model id the session logged. */
  byModel: Record<string, SessionSpendModel>
  /** Cost split by the schedule (price tier) that priced each step. */
  bySchedule: Record<string, number>
  /** Tokens in this session the price table prices no rate for. */
  unpricedTokens: number
  /** Assistant steps folded, priced or not. */
  steps: number
}

/**
 * One provider the account-balance provider picker can show, drawn from the
 * user's own model configuration — the harness's registered routes joined
 * with every route a settings section declares, active or dormant. Carries
 * no adapter or configuration fact: whether a read for this id produces a
 * number is answered by {@link BalanceView}, not by this listing.
 */
export interface ProviderOption {
  /** Provider route id, as used by `AccountBalanceService.get`. */
  id: string
  /** Human-readable name for the picker. */
  displayName: string
}
