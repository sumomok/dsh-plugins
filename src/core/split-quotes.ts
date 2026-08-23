/**
 * Find the quote blocks in one user message so they can be rendered as cards
 * instead of as raw `>` lines inside the bubble.
 *
 * Only the blocks at the edges of the message are cards. A message is
 * normally a question plus the passage it cites, and the passage sits at one
 * end or the other depending on where the chip was inserted; a `>` run in the
 * middle of what someone wrote is their own prose and stays where they put it.
 *
 * @module @sumomok/dsh-quote-message/core/split-quotes
 */

/** One quote block: its lines with the `>` marker removed. */
export type QuoteBlockLines = readonly string[]

/** The cards found in a message and the text left for the bubble. */
export interface QuoteSplit {
  /** Blocks in document order; empty when the message carries none. */
  readonly quotes: readonly QuoteBlockLines[]
  /** The message without them. Identical to the input when no block was found. */
  readonly rest: string
}

/** Whether a line opens a quoted line (`>` alone or `> text`). */
function isQuoted(line: string): boolean {
  return line.startsWith('>')
}

/** Drop one `>` marker and the single space that conventionally follows it. */
function unquote(line: string): string {
  const body = line.slice(1)
  return body.startsWith(' ') ? body.slice(1) : body
}

/** Whether a line is empty or whitespace only. */
function isBlank(line: string): boolean {
  return line.trim() === ''
}

/**
 * Consume quote blocks from `lines` starting at `from`, walking forward.
 * A blank line ends a block; another `>` run after it is the next block; the
 * first non-blank unquoted line ends the region.
 * @param lines - the message's lines.
 * @param from - index to start at.
 * @returns the blocks found and the index the region ended at.
 */
function takeBlocks(lines: readonly string[], from: number): { blocks: string[][]; next: number } {
  const blocks: string[][] = []
  let index = from
  for (;;) {
    if (index >= lines.length || !isQuoted(lines[index] as string)) break
    const block: string[] = []
    while (index < lines.length && isQuoted(lines[index] as string)) {
      block.push(unquote(lines[index] as string))
      index += 1
    }
    // A block of nothing but markers carries no quotation.
    if (block.some(line => !isBlank(line))) blocks.push(block)
    // Blank lines may separate this block from the next one; anything else
    // ends the region, and the blanks then belong to the remaining text.
    let lookahead = index
    while (lookahead < lines.length && isBlank(lines[lookahead] as string)) lookahead += 1
    if (lookahead >= lines.length || !isQuoted(lines[lookahead] as string)) break
    index = lookahead
  }
  return { blocks, next: index }
}

/**
 * Split a message into its edge quote blocks and the rest.
 *
 * The text is returned unchanged when it carries no block at either edge, so
 * a caller can treat an unchanged `rest` as "nothing to do" by identity.
 * @param text - the message's text part.
 * @returns the blocks in document order and the remaining text.
 */
export function splitQuoteBlocks(text: string): QuoteSplit {
  const normalized = text.replace(/\r\n?/gu, '\n')
  const lines = normalized.split('\n')
  const leading = takeBlocks(lines, 0)
  let start = leading.next
  // Walk the tail backwards to find where a trailing region begins, then read
  // it forwards so the blocks inside it keep document order.
  let end = lines.length
  for (;;) {
    let probe = end
    while (probe > start && isBlank(lines[probe - 1] as string)) probe -= 1
    if (probe === start || !isQuoted(lines[probe - 1] as string)) break
    while (probe > start && isQuoted(lines[probe - 1] as string)) probe -= 1
    end = probe
  }
  const trailing = end < lines.length ? takeBlocks(lines, end).blocks : []
  const quotes = [...leading.blocks, ...trailing]
  if (quotes.length === 0) return { quotes: [], rest: text }
  // Both edges may have eaten the whole message.
  if (start > end) start = end
  const middle = lines.slice(start, end)
  while (middle.length > 0 && isBlank(middle[0] as string)) middle.shift()
  while (middle.length > 0 && isBlank(middle[middle.length - 1] as string)) middle.pop()
  return { quotes, rest: middle.join('\n') }
}

/**
 * Drop the block's own heading line when it is one this plugin wrote.
 *
 * The serialized block opens with the localized header (`引用：` / `Quote:`);
 * the card shows that word as its head instead, so keeping the line would
 * print it twice. A blockquote someone wrote by hand has no such line and
 * keeps every line as body.
 * @param lines - one block's lines.
 * @param headings - the header lines this plugin emits, in every locale.
 * @returns the body lines.
 */
export function stripQuoteHeading(
  lines: QuoteBlockLines,
  headings: readonly string[],
): QuoteBlockLines {
  const first = lines[0]
  if (first === undefined) return lines
  return headings.includes(first.trim()) ? lines.slice(1) : lines
}
