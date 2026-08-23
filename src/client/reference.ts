/**
 * The chip: how one quote becomes a `ReferenceInsert` the host's own
 * reference path can seat, and how it reaches a session's composer from
 * outside the trigger pipeline.
 *
 * @module @haoran/dsh-quote-message/client/reference
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
// Type-only: pulls the scoped input events (slash/input-insert-reference) into
// the cordis Events map.
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { encodeQuoteRef, quoteBlock, type QuotePayload } from '../core/quote.ts'
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
 * Build the reference insert for one quote. No `appearance`: that union names
 * the host's own domains (session / file / folder), and an entry without one
 * renders the plain chip — the `@` glyph plus our label — which is what a
 * quote is.
 * @param payload - the quote payload (the chip carries the text itself).
 * @param label - inline label from {@link chipLabel}.
 * @returns the insert the input machine seats as one occurrence.
 */
export function quoteReference(payload: QuotePayload, label: string): ReferenceInsert {
  return {
    source: QUOTE_SOURCE_NAME,
    ref: encodeQuoteRef(payload),
    label,
    clipboardText: quoteBlock(payload),
  }
}

/**
 * Seat one chip in a session's composer without going through the trigger
 * pipeline (the selection pill's path). The insert lands at draft offset 0:
 * the quote reads before the question it belongs to, and a zero-length span at
 * the start cannot glue the chip onto a word the user already typed.
 * @param ctx - the plugin's client root context.
 * @param sessionId - session whose composer receives the chip.
 * @param reference - the insert from {@link quoteReference}.
 * @param draftRev - draft revision read at click time (the machine's CAS guard).
 * @returns whether the input machine applied it (false = stale draft, or no live scope).
 */
export function insertQuoteReference(
  ctx: ClientContext,
  sessionId: SessionId,
  reference: ReferenceInsert,
  draftRev: number,
): boolean {
  const actx = ctx.sessions.scope(sessionId)
  if (actx === undefined) return false
  const span: TokenSpan = { start: 0, end: 0, draftRev }
  return actx.bail(actx, 'slash/input-insert-reference', { reference, span }) === true
}
