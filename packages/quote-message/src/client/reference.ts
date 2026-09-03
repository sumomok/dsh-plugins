/**
 * The chip: how one quote becomes a `ReferenceInsert` the host's own
 * reference path can seat, and how it reaches a session's composer from
 * outside the trigger pipeline.
 *
 * @module @sumomok/dsh-quote-message/client/reference
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
// Type-only: pulls the scoped input events (slash/input-insert-reference) into
// the cordis Events map.
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { quoteInsertRange } from '../core/draft.ts'
import { encodeQuoteRef, type QuotePayload } from '../core/quote.ts'
import type { QuoteKey } from './locales.ts'

/**
 * Source name of the `@message` picker. It is also the serializer routing key
 * the host stores on every occurrence, so it must stay stable: a chip in a
 * draft is expanded by looking this name up in the source roster.
 */
export const QUOTE_SOURCE_NAME = 'message'

/**
 * Inline label cached on the occurrence, e.g. `引用 #12 助手`. The draft shows
 * it after the `@` glyph.
 * @param payload - the quote payload.
 * @param t - bound translate for this plugin's namespace.
 * @returns the chip label.
 */
export function chipLabel(payload: QuotePayload, t: Translate<QuoteKey>): string {
  if (payload.seq === undefined || payload.role === undefined) return t('chip.labelUnknown')
  return t('chip.label', { seq: payload.seq, role: t(`role.${payload.role}`) })
}

/**
 * Build the reference insert for one quote.
 *
 * `appearance` is `session` — the closest of the three the host's chip
 * renderer knows (session / file / folder), and a quote does point at a
 * message in the current session. It is not decoration: an entry without an
 * appearance renders a bare `@` where every first-party chip renders a domain
 * glyph, so the quote chip would be the one reference in the composer that
 * does not look like a reference.
 * @param payload - the quote payload (the chip carries the text itself).
 * @param label - inline label from {@link chipLabel}.
 * @param clipboardText - the block a copy of the draft carries.
 * @returns the insert the input machine seats as one occurrence.
 */
export function quoteReference(payload: QuotePayload, label: string, clipboardText: string): ReferenceInsert {
  return {
    source: QUOTE_SOURCE_NAME,
    ref: encodeQuoteRef(payload),
    label,
    appearance: 'session',
    clipboardText,
  }
}

/**
 * Seat one chip in a session's composer without going through the trigger
 * pipeline (the selection pill's path). The position comes from
 * {@link quoteInsertRange}; `draftRev` rides along as the machine's CAS guard,
 * so a draft that changed between the click and the dispatch is left alone.
 * @param ctx - the plugin's client root context.
 * @param sessionId - session whose composer receives the chip.
 * @param reference - the insert from {@link quoteReference}.
 * @param input - published input state read at click time.
 * @returns whether the input machine applied it (false = stale draft, or no live scope).
 */
export function insertQuoteReference(
  ctx: Context,
  sessionId: SessionId,
  reference: ReferenceInsert,
  input: { readonly draft: string; readonly draftRev: number },
): boolean {
  // ctx.sessions is genuinely an ISessions at runtime (registered by
  // @deepseek-ai/dsh-api-session-controller/client), but this package's
  // single shared tsconfig compiles the host half (src/index.ts) and the
  // client half (src/client/**) in one program. The host half's own
  // dependency chain (transitively, through
  // @deepseek-ai/dsh-api-session-controller/client -> @deepseek-ai/
  // dsh-workspace/types -> the bare @deepseek-ai/dsh-session package) also
  // pulls in @deepseek-ai/dsh-session's OWN Context.sessions: SessionStore
  // merge (its host-side durable session store, an unrelated service that
  // happens to share the same cordis service name). skipLibCheck (this
  // workspace's shared compiler face) does not validate that two merged
  // Context.sessions declarations agree, so the property silently resolves
  // to whichever declaration wins internally — SessionStore, not ISessions —
  // for any file in this compilation. The explicit cast asserts what is
  // actually true at runtime.
  const sessions = ctx.sessions as unknown as ISessions
  const actx = sessions.scope(sessionId)
  if (actx === undefined) return false
  const span: TokenSpan = { ...quoteInsertRange(input), draftRev: input.draftRev }
  return actx.bail(actx, 'slash/input-insert-reference', { reference, span }) === true
}
