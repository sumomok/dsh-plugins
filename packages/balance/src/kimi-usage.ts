/**
 * Reading Kimi For Coding's subscription usage quota: the response the Kimi
 * Code endpoint answers, the parser that turns it into the windows the UI
 * renders, and the perform function the Kimi member of the adapter registry
 * (`kimi-adapter.ts`) feeds into {@link file://./balance.ts}'s `BalanceReader`.
 *
 * Unlike DeepSeek and Moonshot, Kimi For Coding meters a subscription in usage
 * windows (a weekly allowance and one or more rolling windows), not a money
 * balance — so this adapter produces the `quota` {@link BalanceView}, never the
 * `ok` money view.
 *
 * The endpoint is Kimi's own coding-plan usage route — the same one the Kimi
 * CLI reads a subscription's remaining quota from, addressed with the
 * subscription key (`sk-kimi-*`) the CLI itself uses. It is not part of the
 * Moonshot Open Platform's documented HTTP surface; its response is decoded
 * defensively and every missing or off-type field degrades to "unavailable"
 * rather than a thrown error, because an undocumented route may change its
 * shape between client releases. A read is against the caller's own account
 * with the caller's own credential; nothing here is exercised against a live
 * credential in this package's tests.
 *
 * @module @sumomok/dsh-balance/kimi-usage
 */

import type { BalanceUnavailableReason, BalanceView, QuotaWindow } from './types.ts'

/** A successful quota read, before staleness is decided at serve time. */
type QuotaView = Extract<BalanceView, { state: 'quota' }>

/** A failed read. */
type UnavailableView = Extract<BalanceView, { state: 'unavailable' }>

/**
 * The client identifier the Kimi Code usage endpoint gates on: it answers the
 * usage payload only to its own CLI's user agent, and a request without it is
 * rejected. This is an external interface requirement of that endpoint, not a
 * deployment tunable — the value is fixed by the endpoint, so it is a constant
 * here rather than configuration. The credential (`sk-kimi-*`), not this
 * header, is what authenticates the account.
 */
export const KIMI_CLI_USER_AGENT = 'KimiCLI/1.6'

/** One window's allowance figures, however the endpoint spells the pair. */
interface RawAllowance {
  used?: unknown
  limit?: unknown
  remaining?: unknown
  resetTime?: unknown
  reset_at?: unknown
  resetsAt?: unknown
}

/**
 * A count as the endpoint encodes it: a JSON number, or — since the endpoint
 * moved to protobuf-JSON, where 64-bit integers are strings — a decimal
 * string such as `"12"`. Anything else (an empty string, `"x"`, `null`) is
 * no count.
 * @param value - the raw field.
 * @returns the finite number, or `null`.
 */
function countOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return Number(value)
  return null
}

/**
 * The percent of an allowance already used, from whichever of `used` or
 * `remaining` the window carries against its `limit`.
 * @param allowance - the window's raw figures.
 * @returns the used percent clamped to 0–100, or `null` when no usable pair is present.
 */
export function usedPercentOf(allowance: RawAllowance): number | null {
  const limit = countOf(allowance.limit)
  if (limit === null || limit <= 0) return null
  const remaining = countOf(allowance.remaining)
  const used = countOf(allowance.used) ?? (remaining === null ? null : limit - remaining)
  if (used === null) return null
  const percent = (used / limit) * 100
  return Math.max(0, Math.min(100, percent))
}

/**
 * Read a reset time the endpoint may write as an ISO string, epoch seconds, or
 * epoch milliseconds.
 * @param value - the raw reset field.
 * @returns epoch milliseconds, or `null` when absent or unparseable.
 */
export function resetsAtOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Epoch seconds and milliseconds are told apart by magnitude: a seconds
    // value for any plausible date is far below the millisecond threshold.
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

/** The compact key a rolling window is named by, from its declared span. */
function rollingWindowKey(window: unknown, index: number): string {
  if (typeof window !== 'object' || window === null) return `window${String(index + 1)}`
  const record = window as { duration?: unknown; timeUnit?: unknown }
  const duration = countOf(record.duration)
  // The unit arrives as a bare word (`hour`) or, from the protobuf-JSON
  // encoding, as an enum name (`TIME_UNIT_MINUTE`); the word is what counts.
  const unitRaw = String(record.timeUnit ?? '').toLowerCase().replace(/^time_unit_/, '')
  const unit = unitRaw.startsWith('hour') ? 'h'
    : unitRaw.startsWith('day') ? 'd'
      : unitRaw.startsWith('week') ? 'w'
        : unitRaw.startsWith('minute') ? 'm'
          : unitRaw.startsWith('month') ? 'mo'
            : ''
  if (duration === null || duration <= 0 || unit.length === 0) return `window${String(index + 1)}`
  // A span given in whole hours' worth of minutes (`300 MINUTE`) is the same
  // window the plan describes in hours; name it the way the plan does.
  if (unit === 'm' && duration % 60 === 0) return `${String(duration / 60)}h`
  return `${String(duration)}${unit}`
}

/** The reset field a raw allowance carries, under whichever of the three names it uses. */
function rawReset(allowance: RawAllowance): unknown {
  return allowance.resetTime ?? allowance.reset_at ?? allowance.resetsAt
}

/**
 * Turn a decoded usage body into the windows the UI renders.
 *
 * The top-level `usage` object is the weekly allowance and becomes the primary
 * (`weekly`) window the chip shows; each `limits[]` entry is a rolling window
 * named by its own span. A window with no usable allowance pair is skipped.
 * @param body - the parsed JSON body.
 * @returns the windows, weekly first, or `null` when none could be read.
 */
export function parseKimiUsage(body: unknown): QuotaWindow[] | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as { usage?: unknown; limits?: unknown }
  // Rolling windows first, the weekly allowance last: the shorter window is
  // the one that runs out first, so it is the one to read first.
  const windows: QuotaWindow[] = []
  const limits = Array.isArray(record.limits) ? record.limits : []
  limits.forEach((row, index) => {
    if (typeof row !== 'object' || row === null) return
    const detail = (row as { detail?: unknown }).detail
    if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) return
    const percent = usedPercentOf(detail as RawAllowance)
    if (percent === null) return
    windows.push({
      key: rollingWindowKey((row as { window?: unknown }).window, index),
      usedPercent: percent,
      resetsAt: resetsAtOf(rawReset(detail as RawAllowance)),
    })
  })
  const usage = record.usage
  if (typeof usage === 'object' && usage !== null && !Array.isArray(usage)) {
    const percent = usedPercentOf(usage as RawAllowance)
    if (percent !== null) {
      windows.push({ key: 'weekly', usedPercent: percent, resetsAt: resetsAtOf(rawReset(usage as RawAllowance)) })
    }
  }
  return windows.length > 0 ? windows : null
}

/** Everything one quota read needs, resolved fresh by the caller. */
export interface KimiUsageRequest {
  /** The absolute usage endpoint tried first. */
  endpoint: string
  /** The endpoint tried when the first answers 404 — the older singular path of the same route. */
  fallbackEndpoint: string
  /** The subscription API key, held only for the duration of the call. */
  apiKey: string
  /** The client identifier the endpoint gates on. */
  userAgent: string
  /** Wall-clock budget for the request. */
  timeoutMs: number
}

/**
 * Perform one usage read, trying the endpoint and then its 404 fallback.
 * @param request - the resolved endpoints, key, user agent, and budget.
 * @param at - epoch milliseconds stamped on the result.
 * @param fetchImpl - the HTTP client.
 * @returns the read's outcome; never a partial or a thrown network error.
 */
export async function readKimiUsage(
  request: KimiUsageRequest,
  at: number,
  fetchImpl: typeof globalThis.fetch,
): Promise<QuotaView | UnavailableView> {
  const fail = (reason: BalanceUnavailableReason, status?: number): UnavailableView =>
    status === undefined
      ? { state: 'unavailable', reason, fetchedAt: at }
      : { state: 'unavailable', reason, status, fetchedAt: at }

  const attempt = async (url: string): Promise<Response | UnavailableView> => {
    try {
      return await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          Accept: 'application/json',
          'User-Agent': request.userAgent,
        },
        signal: AbortSignal.timeout(request.timeoutMs),
      })
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      return fail(timedOut ? 'timeout' : 'network')
    }
  }

  let response = await attempt(request.endpoint)
  if (!(response instanceof Response)) return response
  if (response.status === 404) {
    response = await attempt(request.fallbackEndpoint)
    if (!(response instanceof Response)) return response
  }
  if (!response.ok) return fail('http', response.status)
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // A non-JSON body (an HTML gateway page, a truncated stream) is the same
    // failure as a JSON body missing its fields.
    return fail('malformed')
  }
  const windows = parseKimiUsage(body)
  if (windows === null) return fail('malformed')
  return {
    state: 'quota',
    windows,
    // The endpoint names no explicit account-availability verdict; any window
    // fully consumed is the one signal that the account cannot serve until
    // that window resets, so that is the verdict derived here.
    isAvailable: windows.every(window => window.usedPercent < 100),
    fetchedAt: at,
    stale: false,
  }
}
