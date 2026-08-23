/**
 * Where a pill-inserted chip lands in the draft.
 *
 * The `@` picker needs none of this — the trigger pipeline hands the source
 * the span of the `@` token it replaces. The selection pill has no such span:
 * it fires while the user is reading the chat, so it must name a position in
 * the draft itself.
 *
 * @module @sumomok/dsh-quote-message/core/draft
 */

/** A zero-width position in draft character coordinates. */
export interface DraftRange {
  readonly start: number
  readonly end: number
}

/**
 * Resolve the insertion position for one pill-inserted chip: the end of the
 * current draft.
 *
 * The caret would be the better answer, and it is not available: the input
 * machine publishes `draft`, `draftRev`, `phase`, `occurrences`, `imageIds`,
 * `paste`, and `queue` — no caret and no selection (the composer keeps the
 * DOM selection to itself, and the pill fires while focus is in the chat
 * anyway, so a DOM read would name wherever the user last typed rather than
 * where they are now). The end of the draft is the position that is both
 * published and stable, and it keeps the quote in front of nothing the user
 * has written.
 *
 * Offsets are UTF-16 string indices because that is what the machine splices
 * with, so a draft holding astral characters still ends where `length` says.
 * The separator after the chip is the machine's own: `replaceSpanWithChip`
 * appends one space unless the text that follows already starts with one.
 * @param input - the published input state (only the draft is read).
 * @returns the zero-width range the reference replaces.
 */
export function quoteInsertRange(input: { readonly draft: string }): DraftRange {
  const at = input.draft.length
  return { start: at, end: at }
}
