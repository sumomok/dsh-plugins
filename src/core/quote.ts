/**
 * The quote reference payload and its two projections: the model form spliced
 * into the prompt at submit, and the clipboard form. Pure — no DOM, no cordis,
 * no host services, so both entry points (selection pill and `@message`
 * picker) and the codec share one implementation.
 *
 * @module @sumomok/dsh-quote-message/core/quote
 */

/** Role of the quoted message, as the header names it. */
export type QuoteRole = 'user' | 'assistant'

/**
 * Everything one chip carries. The text travels IN the payload: the chip must
 * survive a page reload and a re-registered source, so nothing here may be a
 * key into module-level state.
 */
export interface QuotePayload {
  /** Quoted text, already capped to {@link QUOTE_TEXT_LIMIT}. */
  readonly text: string
  /** Session event seq of the source message; absent when the source is unknown. */
  readonly seq?: number
  /** Role of the source message; absent when the source is unknown. */
  readonly role?: QuoteRole
  /**
   * Assistant message identity, when the host recorded one. Carried for
   * resolution only: it is an internal host id, and neither the chip label nor
   * the serialized block ever renders it.
   */
  readonly messageId?: string
  /** Character count before capping; present only when the text was capped. */
  readonly totalChars?: number
}

/** Character cap for one quote. A longer message is capped and reports its full length. */
export const QUOTE_TEXT_LIMIT = 4000

/**
 * The header line the model reads, supplied by the caller so the block follows
 * the interface language the user is working in — `引用：` or `Quote:`.
 */
export type QuoteHeaderLine = string

/**
 * Cap one quoted excerpt at `limit` characters.
 * @param text - raw text to quote.
 * @param limit - maximum characters kept (defaults to {@link QUOTE_TEXT_LIMIT}).
 * @returns the kept text, plus the original length when the text was capped.
 */
export function capQuoteText(text: string, limit: number = QUOTE_TEXT_LIMIT): { text: string; totalChars?: number } {
  const units = [...text]
  if (units.length <= limit) return { text }
  return { text: units.slice(0, limit).join(''), totalChars: units.length }
}

/**
 * Build one payload from a raw excerpt and whatever is known about its source.
 * @param input - raw text plus the resolved source identity.
 * @returns the payload with the text capped.
 */
export function buildQuotePayload(input: {
  text: string
  seq?: number | undefined
  role?: QuoteRole | undefined
  messageId?: string | undefined
}): QuotePayload {
  const capped = capQuoteText(input.text)
  return {
    text: capped.text,
    ...input.seq === undefined ? {} : { seq: input.seq },
    ...input.role === undefined ? {} : { role: input.role },
    ...input.messageId === undefined ? {} : { messageId: input.messageId },
    ...capped.totalChars === undefined ? {} : { totalChars: capped.totalChars },
  }
}


/**
 * The markdown blockquote one chip expands to, without surrounding blank
 * lines. Every line carries the `>` marker so the block survives as one
 * quotation; an empty line keeps the bare marker rather than a trailing space.
 * The header names nothing but the fact that this is a quotation: position,
 * role, and the host message id are all the reader's context, not the model's,
 * and the block reads as a quotation without any of them.
 *
 * The truncation note stays in English on purpose: it is a machine-readable
 * measurement of the excerpt, not prose addressed to the reader.
 * @param payload - the quote payload.
 * @param header - localized header line, e.g. `引用：`.
 * @returns the block, newline-separated, with no trailing newline.
 */
export function quoteBlock(payload: QuotePayload, header: QuoteHeaderLine): string {
  const lines = [header, ...payload.text.split('\n')]
  if (payload.totalChars !== undefined) {
    lines.push(`…(truncated, ${String(payload.totalChars)} chars total)`)
  }
  return lines.map(line => (line === '' ? '>' : `> ${line}`)).join('\n')
}

/**
 * The model form of one chip. The leading newline closes whatever line the
 * chip sat on and the trailing blank line closes the blockquote, so text the
 * user typed after the chip cannot be absorbed into it by lazy continuation.
 * The host trims the assembled prompt, so a chip at either end of the draft
 * contributes no stray blank lines.
 * @param payload - the quote payload.
 * @param header - localized header line, e.g. `引用：`.
 * @returns the padded blockquote.
 */
export function serializeQuote(payload: QuotePayload, header: QuoteHeaderLine): string {
  return `\n${quoteBlock(payload, header)}\n\n`
}

/**
 * Encode one payload into the opaque `ref` string the host stores on the
 * occurrence and hands back to the codec.
 * @param payload - the quote payload.
 * @returns the encoded reference.
 */
export function encodeQuoteRef(payload: QuotePayload): string {
  return JSON.stringify(payload)
}

/**
 * Decode a `ref` produced by {@link encodeQuoteRef}.
 * @param ref - the reference string carried by the occurrence.
 * @returns the payload.
 * @throws {Error} when the reference is not one of ours — serialization must
 * fail loud, because the alternative is sending the display label to the model.
 */
export function decodeQuoteRef(ref: string): QuotePayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(ref)
  } catch (cause) {
    throw new Error(`quote-message: unreadable reference payload: ${ref.slice(0, 64)}`, { cause })
  }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { text?: unknown }).text !== 'string') {
    throw new Error(`quote-message: reference payload carries no quoted text: ${ref.slice(0, 64)}`)
  }
  return parsed as QuotePayload
}
