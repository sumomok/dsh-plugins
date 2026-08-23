/**
 * Where a text selection sits in the chat. The web client marks every chat
 * row with `data-chat-flow-key` (its Conversation node key) inside the column
 * it marks `data-chat-flow` — the same attributes its own scroll anchoring
 * reads, which is why this plugin reads them instead of matching class names.
 *
 * The walk is typed against the two members it uses rather than `Element`, so
 * it is exercised by plain objects and needs no DOM at test time.
 *
 * @module @sumomok/dsh-quote-message/core/chat-dom
 */

/** The element members the walk reads. A real DOM `Element` satisfies it. */
export interface ChatElementLike {
  /** @param name - attribute name. @returns the value, or null when absent. */
  getAttribute(name: string): string | null
  readonly parentElement: ChatElementLike | null
}

/** Marks the chat column; present on exactly one ancestor of every chat row. */
export const CHAT_FLOW_ATTR = 'data-chat-flow'

/** Marks one chat row with its Conversation node key. */
export const CHAT_NODE_KEY_ATTR = 'data-chat-flow-key'

/** Where a selection anchor sits relative to the chat. */
export interface ChatSelectionAnchor {
  /** Whether the anchor is inside the chat column at all. */
  readonly inChat: boolean
  /** Node key of the enclosing chat row, when the anchor is inside one. */
  readonly nodeKey?: string
}

/**
 * Walk up from a selection anchor to the chat row and column that hold it.
 * A row without a key inside the column still answers `inChat` — the quote is
 * offered with an unknown source rather than withheld.
 * @param start - element the selection starts in (a text node's parentElement).
 * @returns the anchor's placement.
 */
export function chatAnchorOf(start: ChatElementLike | null): ChatSelectionAnchor {
  let nodeKey: string | undefined
  for (let node = start; node !== null; node = node.parentElement) {
    if (nodeKey === undefined) {
      const key = node.getAttribute(CHAT_NODE_KEY_ATTR)
      if (key !== null && key !== '') nodeKey = key
    }
    if (node.getAttribute(CHAT_FLOW_ATTR) !== null) {
      return nodeKey === undefined ? { inChat: true } : { inChat: true, nodeKey }
    }
  }
  return { inChat: false }
}
