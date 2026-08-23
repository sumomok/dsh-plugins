/**
 * In-memory handoff between the message that starts a rerun and the child
 * session's composer.
 *
 * The fork's composer is not mounted when the fork resolves, so the question
 * waits here until the child session's input dock mounts and takes it. Nothing
 * is written to the session log, to disk, or to any host route: an entry that
 * is never taken dies with the page.
 */

/** One waiting prefill. */
export interface PendingPrefill {
  /** Draft text the child's composer receives. */
  readonly text: string
  /** Whether the child should send it without waiting for the user (the rerun-as-is action). */
  readonly autoSubmit: boolean
}

/**
 * Entries kept at once. The applier takes an entry as soon as the child opens,
 * so the map is normally empty or holds one; the cap bounds the leak if a
 * child is closed before its composer ever mounts.
 */
const MAX_ENTRIES = 8

/** The handoff store: one waiting prefill per session, taken exactly once. */
export interface PrefillStore {
  /**
   * Park a prefill for a session, replacing any entry already waiting for it.
   * @param sessionId - the child session that will receive the draft.
   * @param prefill - the draft and its auto-submit intent.
   */
  put(sessionId: string, prefill: PendingPrefill): void
  /**
   * Take the prefill waiting for a session and forget it.
   * @param sessionId - the session whose composer just mounted.
   * @returns the prefill, or undefined when nothing was waiting.
   */
  take(sessionId: string): PendingPrefill | undefined
  /** Number of prefills currently waiting (diagnostics and tests). */
  readonly size: number
}

/**
 * Build an independent prefill store.
 * @returns a store with no shared state.
 */
export function createPrefillStore(): PrefillStore {
  const entries = new Map<string, PendingPrefill>()
  return {
    put(sessionId, prefill) {
      entries.delete(sessionId)
      entries.set(sessionId, prefill)
      while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next()
        if (oldest.done === true) break
        entries.delete(oldest.value)
      }
    },
    take(sessionId) {
      const prefill = entries.get(sessionId)
      entries.delete(sessionId)
      return prefill
    },
    get size() {
      return entries.size
    },
  }
}
