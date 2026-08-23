/**
 * Pure anchor computation over the client `ConversationSnapshot`.
 *
 * The plugin's action is seated on one finalized assistant message (the
 * closing tail of a completed turn). Everything the rerun flow needs — which
 * question opened that turn, and where the fork must cut — is derived here so
 * the React entry stays a renderer and the whole rule set is unit-testable
 * without a browser.
 *
 * This module imports types only; it never touches a service.
 */
import type {
  ConversationSnapshot,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'

/** One durable message block, derived from the node type so no extra package is imported. */
type MessageBlock = UserMessageNode['content'][number]

/** Why the action refuses to offer itself on a given message. */
export type RerunRefusal =
  /** No finalized assistant message carries this id in the current window. */
  | 'unknown-message'
  /** The session log is gone (host/session-removed). */
  | 'session-removed'
  /** The message's turn has no `turn/end` in the window, so no boundary is durable yet. */
  | 'open-turn'
  /** The turn was not opened by a user message (a command or an injection opened it). */
  | 'no-user-message'
  /** The question carries an image or attachment block, which a text prefill cannot reproduce. */
  | 'non-text-question'
  /**
   * The turn is the earliest one in the loaded window but older events exist.
   * Forking would cut at the wrong place and starting a blank session would
   * silently drop the history above, so the action refuses instead.
   */
  | 'window-incomplete'

/** The rerun target: the question to prefill and where the child session begins. */
export interface RerunTarget {
  /**
   * Fork anchor: the `turn/end` seq of the last completed turn strictly before
   * the question. `sessions.fork({ atSeq })` cuts there, so the child's
   * transcript ends immediately before the edited turn. Null when the question
   * opened the session's first turn — there is nothing to fork from and the
   * flow connects a blank session in the same workspace instead.
   */
  forkAtSeq: number | null
  /** Verbatim text of the question, joined across its text blocks. */
  text: string
  /** Seq of the question's own `user/message` event (diagnostics and tests). */
  questionSeq: number
  /** Turn the question opened. */
  turn: number
}

/** Either a usable target or the reason the action stays hidden. */
export type RerunResolution =
  | { readonly ok: true; readonly target: RerunTarget }
  | { readonly ok: false; readonly refusal: RerunRefusal }

/**
 * Verbatim text of a question, or null when any block is not text.
 *
 * A question whose blocks include an image cannot be reproduced by a text
 * draft, and dropping the image silently would re-ask a different question, so
 * such a message is refused rather than partially carried.
 * @param content - the durable user-message blocks.
 * @returns the joined text, or null when a non-text block is present.
 */
export function questionText(content: readonly MessageBlock[]): string | null {
  if (content.length === 0) return null
  let text = ''
  for (const block of content) {
    if (block.type !== 'text') return null
    text += block.text
  }
  return text
}

/**
 * The `turn/end` seq of the last completed turn that ends strictly before a
 * given seq.
 *
 * Both the turn's exclusive start and the fork anchor are this same number: the
 * host cuts at the first `turn/end` at or after `atSeq` and then extends the
 * cut through standalone events (titles, injections) up to the next
 * `turn/start`, so anchoring here ends the child exactly before the turn that
 * follows.
 * @param turnEnds - the snapshot's completed-turn boundaries.
 * @param beforeSeq - exclusive upper bound.
 * @returns the boundary seq, or null when no completed turn ends before it.
 */
export function lastBoundaryBefore(
  turnEnds: ReadonlyMap<number, number>,
  beforeSeq: number,
): number | null {
  let boundary: number | null = null
  for (const end of turnEnds.values()) {
    if (end < beforeSeq && (boundary === null || end > boundary)) boundary = end
  }
  return boundary
}

/**
 * The user message that opened one turn: the first `user` node inside the
 * turn's event window.
 *
 * Steering messages admitted mid-turn are their own node kind and are never
 * returned; a later queued `user` node inside the same window is not the
 * opener either, so the scan takes the first rather than the last.
 * @param snapshot - the live conversation snapshot.
 * @param afterSeq - exclusive lower bound (the previous turn's boundary, or null for the first turn).
 * @param endSeq - the turn's `turn/end` seq.
 * @returns the opening question node, or null when the turn has none in-window.
 */
export function turnQuestion(
  snapshot: ConversationSnapshot,
  afterSeq: number | null,
  endSeq: number,
): UserMessageNode | null {
  const lower = afterSeq ?? -1
  for (const node of snapshot.nodes) {
    if (node.kind === 'user' && node.seq > lower && node.seq <= endSeq) return node
  }
  return null
}

/**
 * Resolve the rerun target for the finalized assistant message the action is
 * seated on.
 * @param snapshot - the live conversation snapshot.
 * @param messageId - the assistant message id the slot owner addressed.
 * @returns the target, or the refusal that keeps the action hidden.
 */
export function resolveRerunTarget(snapshot: ConversationSnapshot, messageId: string): RerunResolution {
  if (snapshot.removed) return { ok: false, refusal: 'session-removed' }
  let turn: number | undefined
  for (const node of snapshot.nodes) {
    if (node.kind === 'assistant' && node.messageId === messageId) turn = node.turn
  }
  if (turn === undefined) return { ok: false, refusal: 'unknown-message' }
  const endSeq = snapshot.turnEnds.get(turn)
  if (endSeq === undefined) return { ok: false, refusal: 'open-turn' }
  const forkAtSeq = lastBoundaryBefore(snapshot.turnEnds, endSeq)
  const question = turnQuestion(snapshot, forkAtSeq, endSeq)
  if (question === null) return { ok: false, refusal: 'no-user-message' }
  // An unloaded prefix would make the blank-session fallback drop real history.
  if (forkAtSeq === null && snapshot.hasMore) return { ok: false, refusal: 'window-incomplete' }
  const text = questionText(question.content)
  if (text === null) return { ok: false, refusal: 'non-text-question' }
  return { ok: true, target: { forkAtSeq, text, questionSeq: question.seq, turn } }
}
