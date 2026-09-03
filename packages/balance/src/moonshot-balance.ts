/**
 * Reading Moonshot AI's own account balance: the response shape shared by
 * both the `moonshotai` (international) and `moonshotai-cn` (China) routes,
 * and the perform function the Moonshot member of the adapter registry
 * (`moonshot-adapter.ts`) feeds into {@link file://./balance.ts}'s
 * `BalanceReader`.
 *
 * Both routes answer the identical `GET /v1/users/me/balance` shape at their
 * own origin — verified against <https://platform.kimi.com/docs/api/balance>
 * (China) and <https://platform.kimi.ai/docs/api/balance> (international) on
 * 2026-08-31; both doc domains now redirect from `platform.moonshot.cn` /
 * `platform.moonshot.ai`, which the API's own request domain
 * (`api.moonshot.cn` / `api.moonshot.ai`) is unaffected by. Neither route's
 * response names its own billing currency, so the caller supplies the fixed
 * currency each route is always billed in.
 *
 * @module @sumomok/dsh-balance/moonshot-balance
 */

import type { BalanceUnavailableReason, BalanceView } from './types.ts'

/** A successful read, before staleness is decided at serve time. */
type OkView = Extract<BalanceView, { state: 'ok' }>

/** A failed read. */
type UnavailableView = Extract<BalanceView, { state: 'unavailable' }>

/** The endpoint's `data` object, as the provider documents it. */
interface MoonshotBalanceData {
  available_balance: number
  voucher_balance: number
  cash_balance: number
}

/** The endpoint's response body. */
interface MoonshotBalanceResponse {
  code: number
  data: MoonshotBalanceData
  scode: string
  status: boolean
}

/**
 * Derive the balance endpoint from a route's configured origin.
 *
 * Unlike DeepSeek's own account endpoint ({@link file://./balance.ts}'s
 * `balanceEndpoint`, derived from a chat-completions base URL that may or
 * may not carry a version segment), Moonshot's balance endpoint is
 * documented at a fixed path under the provider's origin regardless of
 * whatever path a configured chat base URL carries, so no path arithmetic is
 * needed beyond discarding it.
 * @param baseURL - the configured provider base URL.
 * @returns the absolute balance endpoint, or `null` when the base URL is not
 * a usable http(s) URL.
 */
export function moonshotBalanceEndpoint(baseURL: string): string | null {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    // URL is the only parser here; an unparseable base URL has no endpoint.
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return new URL('/v1/users/me/balance', url.origin).toString()
}

/** Whether a value is a finite number — the provider's own amounts are typed numbers, unlike DeepSeek's decimal strings. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Narrow a decoded response body to the fields this plugin renders.
 * @param body - the parsed JSON body.
 * @returns the validated response, or `null` when a required field is
 * missing or is not the documented type.
 */
export function parseMoonshotBalanceResponse(body: unknown): MoonshotBalanceResponse | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  if (typeof record.code !== 'number') return null
  if (typeof record.scode !== 'string') return null
  if (typeof record.status !== 'boolean') return null
  if (typeof record.data !== 'object' || record.data === null) return null
  const data = record.data as Record<string, unknown>
  if (!isFiniteNumber(data.available_balance)) return null
  if (!isFiniteNumber(data.voucher_balance)) return null
  if (!isFiniteNumber(data.cash_balance)) return null
  return {
    code: record.code,
    scode: record.scode,
    status: record.status,
    data: {
      available_balance: data.available_balance,
      voucher_balance: data.voucher_balance,
      cash_balance: data.cash_balance,
    },
  }
}

/** Everything one read needs, resolved fresh by the caller. */
export interface MoonshotBalanceRequest {
  /** The absolute balance endpoint. */
  endpoint: string
  /** The API key, held only for the duration of the call. */
  apiKey: string
  /** ISO 4217 code this route is always billed in; the endpoint names none of its own. */
  currency: string
  /** Wall-clock budget for the request. */
  timeoutMs: number
}

/**
 * Perform one balance read.
 * @param request - the resolved endpoint, key, currency, and budget.
 * @param at - epoch milliseconds stamped on the result.
 * @param fetchImpl - the HTTP client.
 * @returns the read's outcome; never a partial or a thrown network error.
 */
export async function readMoonshotBalance(
  request: MoonshotBalanceRequest,
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
  const parsed = parseMoonshotBalanceResponse(body)
  if (parsed === null) return fail('malformed')
  return {
    state: 'ok',
    currency: request.currency,
    // The provider's own fields are numbers; converting to a decimal string
    // matches the popover row model DeepSeek's adapter feeds
    // ({@link file://./types.ts}'s `BalanceView`), which carries every
    // amount as the provider's own digits rather than a rounded number.
    total: String(parsed.data.available_balance),
    granted: String(parsed.data.voucher_balance),
    toppedUp: String(parsed.data.cash_balance),
    // The endpoint names no separate account-availability verdict the way
    // DeepSeek's `is_available` does; `status` is the closest documented
    // field, an envelope success flag a suspended or exhausted account is
    // expected to flip.
    isAvailable: parsed.status,
    fetchedAt: at,
    stale: false,
  }
}
