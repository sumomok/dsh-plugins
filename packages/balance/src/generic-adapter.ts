/**
 * The generic fallback adapter: best-effort balance reads for a provider
 * this plugin has no dedicated adapter for.
 *
 * It never guesses at a provider's own API — it tries a short, configured
 * list of endpoint shapes documented by widely deployed OpenAI-compatible
 * gateways (one-api/new-api's own user-quota endpoint, and the legacy OpenAI
 * dashboard billing endpoints several such gateways also answer), stopping at
 * the first one that returns something it understands. Egress is fenced to
 * the provider's own configured origin, the same fence
 * {@link file://./balance.ts}'s `balanceEndpoint` applies to DeepSeek; nothing
 * here is copied from any gateway's source, only the request/response shapes
 * its documentation describes.
 *
 * @module @sumomok/dsh-balance/generic-adapter
 */

import type { BalanceUnavailableReason, BalanceView } from './types.ts'

/** A successful read, before staleness is decided at serve time. */
type OkView = Extract<BalanceView, { state: 'ok' }>

/** A failed read. */
type UnavailableView = Extract<BalanceView, { state: 'unavailable' }>

/**
 * One-api/new-api's own convention: a self-quota endpoint returning a
 * dimensionless integer "quota" the deployment prices at some ratio per
 * currency unit. The ratio and currency are deployment facts (a self-hosted
 * gateway sets its own conversion), so both are configured per shape rather
 * than assumed.
 */
export interface OneApiQuotaShape {
  kind: 'one-api-quota'
  /** Path from the provider's origin to the endpoint. */
  path: string
  /** Quota units the gateway counts as one unit of `currency`. */
  unitsPerCurrency: number
  /** ISO 4217 code the converted amount is reported in. */
  currency: string
}

/**
 * The legacy OpenAI dashboard billing pair several OpenAI-compatible gateways
 * still answer: a subscription endpoint naming the account's hard limit, and
 * a usage endpoint naming what has been spent against it. Both are fixed by
 * that protocol (USD, a hard limit in dollars, usage in cents), so neither is
 * configurable the way {@link OneApiQuotaShape}'s ratio is.
 */
export interface OpenAiBillingShape {
  kind: 'openai-billing'
  /** Path to the subscription endpoint (answers `hard_limit_usd`). */
  subscriptionPath: string
  /** Path to the usage endpoint (answers `total_usage`, in cents). */
  usagePath: string
}

/** One candidate endpoint shape the generic adapter tries, in configured order. */
export type GenericEndpointShape = OneApiQuotaShape | OpenAiBillingShape

/** Shapes tried when a deployment configures none of its own. */
export const DEFAULT_GENERIC_ENDPOINTS: readonly GenericEndpointShape[] = [
  { kind: 'one-api-quota', path: '/api/user/self', unitsPerCurrency: 500_000, currency: 'USD' },
  { kind: 'openai-billing', subscriptionPath: '/dashboard/billing/subscription', usagePath: '/dashboard/billing/usage' },
]

/** Everything one generic read needs, resolved fresh by the caller. */
export interface GenericBalanceRequest {
  /** The provider's configured origin; every candidate URL is fenced to it. */
  origin: string
  /** The API key, held only for the duration of the call. */
  apiKey: string
  /** Wall-clock budget for one candidate request. */
  timeoutMs: number
  /** Candidate shapes to try, in order. */
  shapes: readonly GenericEndpointShape[]
}

/** A reason this failure carries no provider text for — the generic adapter never explains itself. */
const GENERIC_FAILURE_REASON: BalanceUnavailableReason = 'malformed'

/**
 * Build one candidate's absolute URL, fenced to the request's origin.
 * @param origin - the provider's configured origin.
 * @param path - a root-relative path from a shape.
 * @returns the absolute URL, or `null` when it would leave the origin.
 */
function candidateUrl(origin: string, path: string): URL | null {
  const url = new URL(path, origin)
  if (url.origin !== origin) return null
  return url
}

/** Decimal-string amount as a display string, or `null` when unusable. */
function decimal(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return value.trim()
  return null
}

/**
 * Try one {@link OneApiQuotaShape} candidate.
 * @param request - resolved connection facts.
 * @param shape - the shape to try.
 * @param fetchImpl - the HTTP client.
 * @returns the amount and currency on success, `null` on any failure.
 */
async function tryOneApiQuota(
  request: GenericBalanceRequest,
  shape: OneApiQuotaShape,
  fetchImpl: typeof globalThis.fetch,
): Promise<{ total: string; currency: string } | null> {
  const url = candidateUrl(request.origin, shape.path)
  if (url === null) return null
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${request.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(request.timeoutMs),
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const data = (body as Record<string, unknown>).data
  if (typeof data !== 'object' || data === null) return null
  const quota = (data as Record<string, unknown>).quota
  if (typeof quota !== 'number' || !Number.isFinite(quota)) return null
  if (shape.unitsPerCurrency <= 0) return null
  return { total: String(quota / shape.unitsPerCurrency), currency: shape.currency }
}

/**
 * Try one {@link OpenAiBillingShape} candidate. Both endpoints must answer for
 * the shape to count as matched — a subscription with no usage read (or the
 * reverse) is not a number this plugin can trust.
 * @param request - resolved connection facts.
 * @param shape - the shape to try.
 * @param fetchImpl - the HTTP client.
 * @returns the amount and currency on success, `null` on any failure.
 */
async function tryOpenAiBilling(
  request: GenericBalanceRequest,
  shape: OpenAiBillingShape,
  fetchImpl: typeof globalThis.fetch,
): Promise<{ total: string; currency: string } | null> {
  const subscriptionUrl = candidateUrl(request.origin, shape.subscriptionPath)
  const usageUrl = candidateUrl(request.origin, shape.usagePath)
  if (subscriptionUrl === null || usageUrl === null) return null
  const headers = { Authorization: `Bearer ${request.apiKey}`, Accept: 'application/json' }
  let subscription: Response
  let usage: Response
  try {
    [subscription, usage] = await Promise.all([
      fetchImpl(subscriptionUrl, { method: 'GET', headers, signal: AbortSignal.timeout(request.timeoutMs) }),
      fetchImpl(usageUrl, { method: 'GET', headers, signal: AbortSignal.timeout(request.timeoutMs) }),
    ])
  } catch {
    return null
  }
  if (!subscription.ok || !usage.ok) return null
  let subscriptionBody: unknown
  let usageBody: unknown
  try {
    [subscriptionBody, usageBody] = await Promise.all([subscription.json(), usage.json()])
  } catch {
    return null
  }
  if (typeof subscriptionBody !== 'object' || subscriptionBody === null) return null
  if (typeof usageBody !== 'object' || usageBody === null) return null
  const limit = (subscriptionBody as Record<string, unknown>).hard_limit_usd
  const used = (usageBody as Record<string, unknown>).total_usage
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return null
  if (typeof used !== 'number' || !Number.isFinite(used)) return null
  return { total: String(limit - used / 100), currency: 'USD' }
}

/**
 * Try one candidate shape.
 * @param request - resolved connection facts.
 * @param shape - the shape to try.
 * @param fetchImpl - the HTTP client.
 * @returns the amount and currency on success, `null` on any failure.
 */
async function tryShape(
  request: GenericBalanceRequest,
  shape: GenericEndpointShape,
  fetchImpl: typeof globalThis.fetch,
): Promise<{ total: string; currency: string } | null> {
  if (shape.kind === 'one-api-quota') return tryOneApiQuota(request, shape, fetchImpl)
  return tryOpenAiBilling(request, shape, fetchImpl)
}

/**
 * Build one provider's generic `perform`. The returned function remembers
 * which shape last answered, across calls, and tries that one first — so a
 * provider matched once no longer pays for probing shapes it is known not to
 * serve. The remembered index is runtime state, not configuration: a restart
 * re-probes from the configured order, same as a provider matched for the
 * first time.
 * @returns a `perform` function for {@link BalanceReader}.
 */
export function createGenericPerform(): (
  request: GenericBalanceRequest,
  at: number,
  fetchImpl: typeof globalThis.fetch,
) => Promise<OkView | UnavailableView> {
  let remembered: number | undefined
  return async (request, at, fetchImpl) => {
    const order = remembered === undefined
      ? request.shapes.map((_, index) => index)
      : [remembered, ...request.shapes.map((_, index) => index).filter(index => index !== remembered)]
    for (const index of order) {
      const shape = request.shapes[index]
      if (shape === undefined) continue
      const hit = await tryShape(request, shape, fetchImpl)
      if (hit === null) continue
      const total = decimal(hit.total)
      if (total === null) continue
      remembered = index
      return {
        state: 'ok',
        currency: hit.currency,
        total,
        isAvailable: true,
        fetchedAt: at,
        stale: false,
      }
    }
    return { state: 'unavailable', reason: GENERIC_FAILURE_REASON, fetchedAt: at }
  }
}
