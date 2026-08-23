/**
 * The child session's half of the rerun handoff.
 *
 * A fork's composer does not exist when `sessions.fork` resolves, so the
 * question waits in the prefill store. This entry mounts with the child's
 * input area, takes the waiting question exactly once, and writes it through
 * the public `inputActions.setDraft`. It renders nothing.
 *
 * For the rerun-as-is action it also sends the draft, but only after the input
 * machine reports the draft it just wrote and a `plain` phase — the machine is
 * never driven while it is adjudicating, claimed, or already submitting.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PendingPrefill, PrefillStore } from '../core/pending-prefill.ts'

/** The business face this entry's `inject` factory supplies. */
export interface PrefillApplierFace {
  store: PrefillStore
}

export type PrefillApplierProps =
  PropsRuntime<'conversation.input.dock'>
  & PrefillApplierFace

/**
 * Apply the question waiting for this session, then optionally send it.
 * @param props - slot runtime props and the prefill store.
 * @returns null; this entry occupies no space.
 */
export function PrefillApplier(props: PrefillApplierProps) {
  const { sessionId, input, inputActions, store } = props
  const [pending, setPending] = useState<PendingPrefill | null>(null)
  /** The session this instance already took a prefill for (one take per session). */
  const takenFor = useRef<string | null>(null)
  const submitted = useRef(false)

  useEffect(() => {
    if (takenFor.current === sessionId) return
    takenFor.current = sessionId
    submitted.current = false
    const prefill = store.take(sessionId)
    setPending(prefill ?? null)
    if (prefill === undefined) return
    inputActions.setDraft(prefill.text)
  }, [inputActions, sessionId, store])

  useEffect(() => {
    if (pending === null || !pending.autoSubmit || submitted.current) return
    if (input.draft !== pending.text || input.phase !== 'plain') return
    submitted.current = true
    inputActions.submit()
  }, [input.draft, input.phase, inputActions, pending])

  return null
}
