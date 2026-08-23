/**
 * Reading the provider's account balance: where to ask, how to read the
 * answer, and how often to ask again.
 *
 * The API key is never held here. Every read resolves it through the
 * credential seam and drops it when the request completes, which is what makes
 * a rotated key reach the next poll without a restart. What is cached is the
 * *answer*, so a browser tab per monitor does not multiply into a request per
 * monitor.
 *
 * @module @haoran/dsh-balance/balance
 */

import type { BalanceUnavailableReason, BalanceView } from './types.ts'

/** A successful read, before staleness is decided at serve time. */
type OkView = Extract<BalanceView, { state: 'ok' }>

/** A failed read. */
type UnavailableView = Extract<BalanceView, { state: 'unavailable' }>

/** One `balance_infos` row, as the provider documents it. */
interface BalanceInfo {
  currency: string
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

/** The endpoint's response body. */
interface BalanceResponse {
  is_available: boolean
  balance_infos: BalanceInfo[]
}

/**
 * Derive the balance endpoint from a chat-completions base URL.
 *
 * Providers are configured with the URL their chat client uses, which may or
 * may not carry an API-version segment; the account endpoint sits beside that
 * segment rather than under it. Exactly one trailing `/v<digits>` is removed,
 * so `https://api.deepseek.com/v1` and `https://api.deepseek.com` both reach
 * the same place, and a path that genuinely ends in something else is left
 * alone.
 * @param baseURL - the configured provider base URL.
 * @returns the absolute balance endpoint, or `null` when the base URL is not a
 * usable http(s) URL.
 */
export function balanceEndpoint(baseURL: string): string | null {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    // URL is the only parser here; an unparseable base URL has no endpoint.
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const path = url.pathname.replace(/\/+$/, '').replace(/\/v\d+$/, '')
  const endpoint = new URL(`${path}/user/balance`, url.origin)
  // Egress fence: path arithmetic must not have moved the request off the
  // configured origin. A base URL carrying credentials or a port change would
  // show up here rather than in a request.
  if (endpoint.origin !== url.origin) return null
  return endpoint.toString()
}

/**
 * Select the balance row to show.
 * @param infos - the response's rows.
 * @param preference - currency codes in descending preference.
 * @returns the first row matching the preference, else the first row, else `undefined`.
 */
export function selectBalance(
  infos: readonly BalanceInfo[],
  preference: readonly string[],
): BalanceInfo | undefined {
  for (const currency of preference) {
    const hit = infos.find(info => info.currency === currency)
    if (hit !== undefined) return hit
  }
  return infos[0]
}

/** Whether a value is a decimal number the provider wrote as a string. */
function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())
}

/**
 * Read a balance amount as a number for threshold comparisons. Display keeps
 * the provider's own string; only the tint thresholds need arithmetic.
 * @param value - a decimal string from the response.
 * @returns the number, or `null` when the text is not a decimal.
 */
export function parseAmount(value: string): number | null {
  const trimmed = value.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Narrow a decoded response body to the fields this plugin renders.
 * @param body - the parsed JSON body.
 * @returns the validated response, or `null` when a required field is missing
 * or is not the documented type.
 */
export function parseBalanceResponse(body: unknown): BalanceResponse | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  if (typeof record.is_available !== 'boolean') return null
  if (!Array.isArray(record.balance_infos)) return null
  const infos: BalanceInfo[] = []
  for (const value of record.balance_infos as unknown[]) {
    if (typeof value !== 'object' || value === null) return null
    const info = value as Record<string, unknown>
    if (typeof info.currency !== 'string') return null
    if (!isDecimalString(info.total_balance)) return null
    if (!isDecimalString(info.granted_balance)) return null
    if (!isDecimalString(info.topped_up_balance)) return null
    infos.push({
      currency: info.currency,
      total_balance: info.total_balance.trim(),
      granted_balance: info.granted_balance.trim(),
      topped_up_balance: info.topped_up_balance.trim(),
    })
  }
  return { is_available: record.is_available, balance_infos: infos }
}

/** Everything one read needs, resolved fresh by the caller. */
export interface BalanceRequest {
  /** The absolute balance endpoint. */
  endpoint: string
  /** The API key, held only for the duration of the call. */
  apiKey: string
  /** Currency codes in descending preference. */
  currency: readonly string[]
  /** Wall-clock budget for the request. */
  timeoutMs: number
}

/** The collaborators one reader needs, so tests can supply their own. */
export interface BalanceReaderOptions {
  /** Resolve the facts of the next read, or `null` while unconfigured. */
  resolve: () => Promise<BalanceRequest | null>
  /** Epoch milliseconds. */
  now: () => number
  /** How long a successful read is served before a refresh is attempted. */
  refreshMs: number
  /** How long a failed read suppresses further attempts. */
  retryMs: number
  /** The HTTP client; the global `fetch` in production. */
  fetch: typeof globalThis.fetch
}

/**
 * Perform one balance read.
 * @param request - the resolved endpoint, key, and budget.
 * @param at - epoch milliseconds stamped on the result.
 * @param fetchImpl - the HTTP client.
 * @returns the read's outcome; never a partial or a thrown network error.
 */
export async function readBalance(
  request: BalanceRequest,
  at: number,
  fetchImpl: typeof globalThis.fetch,
): Promise<OkView | UnavailableView> {
  const fail = (reason: BalanceUnavailableReason, status?: number): UnavailableView =>
    status === undefined
      ? { state: 'unavailable', reason, fetchedAt: at }
      : { state: 'unavailable', reason, status, fetchedAt: at }
  let response: Response
  try {
    response = await fetchImpl(request.endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(request.timeoutMs),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return fail(timedOut ? 'timeout' : 'network')
  }
  if (!response.ok) return fail('http', response.status)
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // A non-JSON body (an HTML error page, a truncated stream) is the same
    // failure as a JSON body missing its fields.
    return fail('malformed')
  }
  const parsed = parseBalanceResponse(body)
  if (parsed === null) return fail('malformed')
  const info = selectBalance(parsed.balance_infos, request.currency)
  if (info === undefined) return fail('malformed')
  return {
    state: 'ok',
    currency: info.currency,
    total: info.total_balance,
    granted: info.granted_balance,
    toppedUp: info.topped_up_balance,
    isAvailable: parsed.is_available,
    fetchedAt: at,
    stale: false,
  }
}

/**
 * The cache in front of the provider.
 *
 * Concurrent callers share one in-flight request, a success is served for the
 * refresh window, and a failure suppresses attempts for the retry window so a
 * broken endpoint is not hammered once per open tab. When a refresh fails but
 * an earlier read succeeded, the earlier numbers are served marked `stale`
 * rather than replaced by a dash: a balance from a minute ago is worth more to
 * the reader than no balance at all, as long as it says so.
 */
export class BalanceReader {
  private readonly options: BalanceReaderOptions
  private inflight: Promise<BalanceView> | undefined
  private lastOk: OkView | undefined
  private lastFailure: UnavailableView | undefined

  /**
   * @param options - resolution, clock, windows, and HTTP client.
   */
  constructor(options: BalanceReaderOptions) {
    this.options = options
  }

  /**
   * Read the balance, from cache when the cache is still valid.
   * @param force - bypass the refresh and retry windows; an in-flight read is
   * still joined rather than duplicated.
   * @returns the view to render.
   */
  async get(force = false): Promise<BalanceView> {
    if (this.inflight !== undefined) return this.inflight
    if (!force) {
      const cached = this.cached()
      if (cached !== undefined) return cached
    }
    const task = this.refresh()
    this.inflight = task
    const settle = (): void => { this.inflight = undefined }
    void task.then(settle, settle)
    return task
  }

  /** The cached answer, or `undefined` when a fresh read is due. */
  private cached(): BalanceView | undefined {
    const now = this.options.now()
    if (this.lastOk !== undefined && now - this.lastOk.fetchedAt < this.options.refreshMs) {
      return this.lastOk
    }
    if (this.lastFailure !== undefined && now - this.lastFailure.fetchedAt < this.options.retryMs) {
      return this.lastOk === undefined ? this.lastFailure : { ...this.lastOk, stale: true }
    }
    return undefined
  }

  /** Perform the read and fold its outcome into the cache. */
  private async refresh(): Promise<BalanceView> {
    const request = await this.options.resolve()
    if (request === null) {
      // Unconfigured is not cached: adding or removing a key must reach the
      // next poll, and answering it costs no network.
      return { state: 'unconfigured' }
    }
    const at = this.options.now()
    const result = await readBalance(request, at, this.options.fetch)
    if (result.state === 'ok') {
      this.lastOk = result
      this.lastFailure = undefined
      return result
    }
    this.lastFailure = result
    return this.lastOk === undefined ? result : { ...this.lastOk, stale: true }
  }
}
