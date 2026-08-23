/**
 * Which message a selection landed in.
 *
 * The pill knows the chat row a selection sits in (see chat-dom.ts) and the
 * conversation snapshot behind it; this turns the row's anchor seq into the
 * identity the quote header names.
 *
 * @module @sumomok/dsh-quote-message/core/message
 */
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { QuoteRole } from './quote.ts'

/**
 * Identity of the message a selection landed in. A selection inside a tool
 * result or any other non-message row resolves to its seq alone, which is
 * still worth quoting — the header then names the position without a role.
 *
 * A steering message is a human prompt admitted mid-turn, so it reads as a
 * user message; every other node kind is not a message and keeps its position
 * only.
 *
 * The assistant `messageId` is carried for resolution and never rendered: see
 * {@link QuotePayload.messageId}.
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
