/**
 * Minimal `ConversationSnapshot` fixtures.
 *
 * The plugin reads five fields — `nodes`, `turnEnds`, `hasMore`, `removed`,
 * and (through the node union) `seq`/`turn`/`messageId`/`content`. The builder
 * below supplies exactly those and casts once at the boundary: reproducing the
 * whole snapshot interface would pin fields no assertion here depends on.
 */
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** One transcript node in a fixture, in the shapes the resolver switches on. */
export type FixtureNode =
  | { kind: 'user'; seq: number; content: readonly { type: string; text?: string }[] }
  | { kind: 'steering'; seq: number; content: readonly { type: string; text?: string }[] }
  | { kind: 'assistant'; seq: number; turn: number; messageId?: string }
  | { kind: 'context'; seq: number }
  | { kind: 'command'; seq: number }

/** A plain text question block. */
export function text(value: string): { type: string; text: string } {
  return { type: 'text', text: value }
}

/** An image block, which the resolver refuses to reproduce as a draft. */
export function image(): { type: string } {
  return { type: 'image' }
}

/**
 * Assemble a snapshot from the fields the resolver reads.
 * @param input - nodes in seq order, completed-turn boundaries, and window flags.
 * @returns the snapshot, typed as the runtime's.
 */
export function snapshot(input: {
  nodes: readonly FixtureNode[]
  turnEnds: readonly (readonly [turn: number, endSeq: number])[]
  hasMore?: boolean
  removed?: boolean
}): ConversationSnapshot {
  return {
    nodes: input.nodes,
    turnEnds: new Map(input.turnEnds),
    hasMore: input.hasMore ?? false,
    removed: input.removed ?? false,
  } as unknown as ConversationSnapshot
}
