/**
 * The two decisions the shadowing user-bubble renderer makes, kept out of the
 * component so both are testable without a DOM: what to hand the incumbent
 * bubble, and which entry the incumbent is.
 *
 * @module @sumomok/dsh-quote-message/client/quoted-node
 */
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { splitQuoteBlocks, type QuoteBlockLines } from '../core/split-quotes.ts'

/** The one content-block kind this plugin rewrites. */
interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/** What to render for one message that carries quote blocks. */
export interface QuotedPlan {
  /** Blocks to render as cards, in document order. */
  readonly quotes: readonly QuoteBlockLines[]
  /** Content for the incumbent bubble, with the quote region removed. */
  readonly content: readonly unknown[]
}

/** Whether one content block is a text block. */
function isText(block: unknown): block is TextBlock {
  return typeof block === 'object' && block !== null
    && (block as { type?: unknown }).type === 'text'
    && typeof (block as { text?: unknown }).text === 'string'
}

/**
 * Decide what the bubble should show.
 *
 * `null` means "change nothing": the message carries no quote block, or its
 * shape is not one this plugin rewrites. A prompt the composer sent carries
 * exactly one text block; a message with none, or with several, is left to
 * the incumbent untouched rather than guessed at.
 * @param content - the node's content blocks.
 * @returns the cards and the reduced content, or null to render the incumbent unchanged.
 */
export function planQuotedContent(content: readonly unknown[]): QuotedPlan | null {
  // Exactly one text block, or this is not a shape to rewrite. (`findIndex`
  // takes a thisArg, not a start index, so the count is taken directly.)
  if (content.filter(isText).length !== 1) return null
  const index = content.findIndex(isText)
  const block = content[index] as TextBlock
  const split = splitQuoteBlocks(block.text)
  if (split.quotes.length === 0) return null
  const reduced = split.rest === ''
    ? [...content.slice(0, index), ...content.slice(index + 1)]
    : [...content.slice(0, index), { ...block, text: split.rest }, ...content.slice(index + 1)]
  return { quotes: split.quotes, content: reduced }
}

/**
 * Find the entry this renderer shadows: the host's own component for one node
 * kind.
 *
 * Shadowing keeps every entry of a cell registered and renders the lowest
 * priority, so the incumbent is still in the ledger and is read from there
 * rather than imported — a value import across plugin bundles would be a
 * second copy of the module, and there is no import to make anyway.
 * @param entries - the slot's registered entries (`ctx.slots.entries`).
 * @param key - the keyed cell, `user` or `steering`.
 * @param own - this plugin's own component, excluded from the search.
 * @returns the incumbent component, or undefined when this plugin is alone in the cell.
 */
export function pickIncumbent(
  entries: readonly StoredEntry[],
  key: string,
  own: unknown,
): unknown {
  let best: StoredEntry | undefined
  for (const entry of entries) {
    if (entry.options.key !== key || entry.component === own) continue
    if (best === undefined || (entry.options.priority ?? 0) < (best.options.priority ?? 0)) best = entry
  }
  return best?.component
}
