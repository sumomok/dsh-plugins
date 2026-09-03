/**
 * Message identity of the chat row a selection pill's anchored node key
 * names, read from the session's live "chat" Conversation View target.
 *
 * `ConversationSnapshot` used to carry a session's chat nodes directly
 * (`session.chat.nodes` / `session.nodes`) as the `conversation.input.dock`
 * slot's own owner share. The Conversation assembly is now target-neutral:
 * `InputZone.session` (the slot's owner share) is a `SessionSnapshot`
 * (lifecycle only, no node data), and chat node data lives behind
 * `ctx.uiConversation.binding(sessionId).target('chat')` instead — one
 * registered View target's own live snapshot, keyed by session. This module
 * is the one call site that reaches through to it, so `QuoteDock.tsx` stays
 * decoupled from the Conversation View machinery entirely.
 *
 * @module @sumomok/dsh-quote-message/client/identity
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ConversationViewSnapshotMap['chat'] merge (ChatSnapshot).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the Context.uiConversation merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { quoteIdentityAt } from '../core/message.ts'
import type { QuoteRole } from '../core/quote.ts'

/** Resolved identity of the chat row a quote pill's selection sits in. */
export interface QuoteIdentity {
  readonly seq: number
  readonly role?: QuoteRole
  readonly messageId?: string
}

/**
 * Build the `identityAt` lookup `QuoteDock` injects: a chat node key resolved
 * against the session's current "chat" View snapshot, one-shot (this reads
 * the live snapshot at call time; it is never subscribed to).
 * @param ctx - the plugin's client root context.
 * @returns the lookup function, or undefined when the row is not a message,
 * the node key does not resolve, or the session has no "chat" target yet.
 */
export function createIdentityAt(
  ctx: Context,
): (sessionId: SessionId, nodeKey: string) => QuoteIdentity | undefined {
  return (sessionId, nodeKey) => {
    const snapshot = ctx.uiConversation.binding(sessionId).target('chat').getSnapshot()
    if (snapshot === undefined) return undefined
    const view = snapshot.nodes.get(nodeKey)
    if (view === undefined) return undefined
    return quoteIdentityAt(snapshot.legacy.nodes, view.anchorSeq)
  }
}
