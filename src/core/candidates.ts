/**
 * Message candidates for the `@message` picker, derived from the current
 * session's conversation snapshot. Pure: the client half hands in the node
 * list and the localized role words, everything else is computed here.
 *
 * @module @haoran/dsh-quote-message/core/candidates
 */
import type { ConversationNode, UserMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { QuoteRole } from './quote.ts'

/** One quotable message: the identity the header needs plus its full text. */
export interface QuoteSource {
  /** Session event seq — the picker's key and the header's `#<seq>`. */
  readonly seq: number
  readonly role: QuoteRole
  /** Assistant message identity, when the host recorded one. */
  readonly messageId?: string
  /** Complete message text, uncapped (capping happens when a payload is built). */
  readonly text: string
}

/** Characters of message text shown in one menu row. */
export const CANDIDATE_PREVIEW_LIMIT = 80

/** Join every text block of a finalized human message. */
function messageText(content: UserMessageNode['content']): string {
  return content
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim()
}

/**
 * Quotable messages of one session, newest first. Assistant reasoning, tool
 * calls, and images are left out: a quote carries what was said, and a
 * message whose text is empty is not offered at all.
 *
 * A steering message is a human prompt admitted mid-turn, so it lists as a
 * user message; every other node kind (tool results, context injections,
 * compaction markers, command rows) is not a message and is skipped.
 * @param nodes - the conversation snapshot's finalized node list.
 * @returns quotable messages ordered newest first.
 */
export function quoteSources(nodes: readonly ConversationNode[]): QuoteSource[] {
  const out: QuoteSource[] = []
  for (const node of nodes) {
    if (node.kind === 'user' || node.kind === 'steering') {
      const text = messageText(node.content)
      if (text !== '') out.push({ seq: node.seq, role: 'user', text })
      continue
    }
    if (node.kind !== 'assistant') continue
    const text = node.blocks
      .flatMap(block => (block.kind === 'text' ? [block.text] : []))
      .join('\n')
      .trim()
    if (text === '') continue
    out.push({
      seq: node.seq,
      role: 'assistant',
      text,
      ...node.messageId === undefined ? {} : { messageId: node.messageId },
    })
  }
  return out.reverse()
}

/**
 * Narrow the roll to the messages whose text contains the typed query
 * (case-insensitive, order preserved).
 * @param sources - candidate messages.
 * @param query - the text typed after `@`.
 * @returns the matching messages.
 */
export function filterQuoteSources(sources: readonly QuoteSource[], query: string): QuoteSource[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...sources]
  return sources.filter(source => source.text.toLowerCase().includes(needle))
}

/**
 * One-line preview of a message: newlines and runs of whitespace collapse to
 * single spaces so a menu row cannot wrap or break the menu's own layout.
 * @param text - message text.
 * @returns at most {@link CANDIDATE_PREVIEW_LIMIT} characters, with an ellipsis when cut.
 */
export function candidatePreview(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  const units = [...flat]
  if (units.length <= CANDIDATE_PREVIEW_LIMIT) return flat
  return `${units.slice(0, CANDIDATE_PREVIEW_LIMIT).join('')}…`
}

/**
 * Menu row title: `#12 助手 · the first line of what it said`.
 * @param source - the candidate message.
 * @param roleWord - localized word for a role (the picker's copy, unlike the header's fixed wording).
 * @returns the row title.
 */
export function candidateName(source: QuoteSource, roleWord: (role: QuoteRole) => string): string {
  return `#${String(source.seq)} ${roleWord(source.role)} · ${candidatePreview(source.text)}`
}

/**
 * Resolve the message a picked row names.
 * @param sources - candidate messages.
 * @param seq - seq carried by the picked candidate.
 * @returns the message, or undefined when the snapshot no longer holds it.
 */
export function quoteSourceBySeq(sources: readonly QuoteSource[], seq: number): QuoteSource | undefined {
  return sources.find(source => source.seq === seq)
}

/**
 * Identity of the message a selection landed in. A selection inside a tool
 * result or any other non-message row resolves to its seq alone, which is
 * still worth quoting — the header then names the position without a role.
 * @param nodes - the conversation snapshot's finalized node list.
 * @param seq - anchor seq of the row the selection sits in.
 * @returns seq, plus role and message identity when the row is a message.
 */
export function quoteIdentityAt(
  nodes: readonly ConversationNode[],
  seq: number,
): { seq: number; role?: QuoteRole; messageId?: string } {
  const node = nodes.find(candidate => candidate.seq === seq)
  if (node === undefined) return { seq }
  if (node.kind === 'user' || node.kind === 'steering') return { seq, role: 'user' }
  if (node.kind !== 'assistant') return { seq }
  return node.messageId === undefined
    ? { seq, role: 'assistant' }
    : { seq, role: 'assistant', messageId: node.messageId }
}
