/**
 * Resolves which provider the balance chip should follow.
 *
 * Kept out of `./index.ts` (the plugin's composition root) so a test of this
 * pure function loads neither the slot registrations nor the React components
 * that root pulls in, none of which this resolution depends on.
 *
 * @module @sumomok/dsh-balance/client/resolve-followed-provider
 */

import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import { DEEPSEEK_PROVIDER_ID } from '../provider-id.ts'

/**
 * Resolve the provider whose balance the chip should follow: the current
 * session's selected model's provider, read straight off the session's own
 * durable `modelSelection` projection — the same synchronous, no-round-trip
 * read `@haoran/dsh-vision-switch`'s `SessionsFace.projectedSelection` uses.
 * Falls back to DeepSeek for a blank/no-session view, an addressed-subagent
 * session (no live scope, so `binding` reads undefined), or a session with no
 * recorded selection yet — following is a convenience, never a reason to show
 * nothing.
 *
 * Takes `sessions` on its own — not `ctx` — because this package's host half
 * also imports `@deepseek-ai/dsh-session`, whose own `Context.sessions`
 * merge (an unrelated host-side concept sharing the property name) coexists
 * with `@deepseek-ai/dsh-api-session-controller`'s in this package's single
 * TypeScript program; only an explicit `ISessions`-typed value here is
 * trustworthy, not `ctx.sessions` read fresh at every call site.
 * @param sessions - the sessions service (`ctx.sessions`, cast at the one call site that reads it off `ctx`).
 * @returns the provider id to read as followed.
 */
export function resolveFollowedProviderId(sessions: Pick<ISessions, 'list' | 'binding'>): string {
  const sessionId = sessions.list.getSnapshot().current
  if (sessionId === undefined) return DEEPSEEK_PROVIDER_ID
  const binding = sessions.binding(sessionId)
  if (binding === undefined) return DEEPSEEK_PROVIDER_ID
  const projection = binding.session.projections.faceOf('modelSelection').getSnapshot() as
    ModelSelectionProjection | undefined
  const provider = (projection?.next ?? projection?.lastUsed)?.provider
  return provider !== undefined && provider.length > 0 ? provider : DEEPSEEK_PROVIDER_ID
}
