/**
 * The 「修改」 action, contributed to one user message's IconActions row
 * (`conversation.chat.user-actions`).
 *
 * The slot owner addresses the message by its log position and hands over the
 * text the bubble rendered; where the fork must cut is derived from the
 * session snapshot by {@link resolveUserEditAnchor}. The component renders
 * nothing on a bubble that did not open its own turn — an admitted steering
 * message, a queued question — so mid-turn chatter costs no chrome.
 */
import { useCallback, useState } from 'react'
import { IconEditOutline16, Toast, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: declares the host seat this entry is registered into.
import type {} from './host-slot.ts'
import { resolveUserEditAnchor, type EditAnchor } from '../core/anchor.ts'
import type { StartRerun } from './rerun.ts'
import { ACTION_CLASS, BUSY_ATTR } from './styles.ts'

/** The business face this entry's `inject` factory supplies. */
export interface EditUserMessageFace {
  startRerun: StartRerun
}

export type EditUserMessageActionProps =
  PropsRuntime<'conversation.chat.user-actions'>
  & { t: TranslateNS<'edit-rerun'> }
  & EditUserMessageFace

/**
 * Render the edit-and-rerun button under one user message.
 * @param props - slot runtime props, the locale seat, and the rerun flow.
 * @returns the icon button, or null when this message cannot be re-asked.
 */
export function EditUserMessageAction(props: EditUserMessageActionProps) {
  const { seq, text, sessionId, useSession, t, startRerun } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The resolver returns a fresh object on every snapshot publication, so the
  // comparator is spelled over the fields that change what a click does.
  const anchor = useSession(
    snapshot => {
      const resolution = resolveUserEditAnchor(snapshot, seq, text)
      return resolution.ok ? resolution.anchor : null
    },
    (a, b) => a?.forkAtSeq === b?.forkAtSeq && a?.text === b?.text,
  )
  const run = useCallback((resolved: EditAnchor) => {
    setBusy(true)
    setError(null)
    // autoSubmit stays false: this action exists to let the user change the
    // question before it runs again. Re-sending it unchanged is the assistant
    // row's rerun button.
    startRerun({ sessionId, target: resolved, autoSubmit: false }).then(
      () => {
        // Success opens the child session: this session-scoped slot unmounts
        // with the source transcript, so no state reset is needed here.
        setBusy(false)
      },
      (reason: unknown) => {
        setBusy(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }, [sessionId, startRerun])

  if (anchor === null) return null
  return (
    <>
      <Tooltip label={busy ? t('busy') : t('user.edit.hint')} side="bottom">
        <button
          type="button"
          className={ACTION_CLASS}
          aria-label={t('user.edit.label')}
          {...(busy ? { [BUSY_ATTR]: true, 'aria-disabled': true } : {})}
          onClick={busy ? undefined : () => { run(anchor) }}
        >
          <IconEditOutline16 />
        </button>
      </Tooltip>
      {error !== null && (
        <Toast text={t('error.fork', { reason: error })} onDone={() => { setError(null) }} />
      )}
    </>
  )
}
