/**
 * The two rerun actions, contributed to one finalized assistant message's
 * IconActions row (`conversation.chat.assistant-actions`).
 *
 * The slot owner addresses the message by id; everything else — which question
 * opened that turn and where the fork cuts — is derived from the session
 * snapshot by {@link resolveRerunTarget}. The component renders nothing at all
 * when the turn has no rerunnable question, so a transcript full of
 * tool-opened or image-bearing turns costs no chrome.
 */
import { useCallback, useState } from 'react'
import { IconEditOutline16, IconRefreshOutline16, Toast, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveRerunTarget, type RerunTarget } from '../core/anchor.ts'
import type { StartRerun } from './rerun.ts'
import { ACTION_CLASS, BUSY_ATTR } from './styles.ts'

/** The business face this entry's `inject` factory supplies. */
export interface RerunActionsFace {
  startRerun: StartRerun
}

export type RerunActionsProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & { t: TranslateNS<'edit-rerun'> }
  & RerunActionsFace

/**
 * Render the edit-and-rerun and rerun-as-is buttons for one assistant message.
 * @param props - slot runtime props, the locale seat, and the rerun flow.
 * @returns the two icon buttons, or null when this turn offers no rerun.
 */
export function RerunActions(props: RerunActionsProps) {
  const { messageId, sessionId, useSession, t, startRerun } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The resolver returns a fresh object on every snapshot publication, so the
  // comparator is spelled over the fields that change what a click does.
  const target = useSession(
    snapshot => {
      const resolution = resolveRerunTarget(snapshot, messageId)
      return resolution.ok ? resolution.target : null
    },
    (a, b) => a?.questionSeq === b?.questionSeq && a?.forkAtSeq === b?.forkAtSeq && a?.text === b?.text,
  )
  const run = useCallback((resolved: RerunTarget, autoSubmit: boolean) => {
    setBusy(true)
    setError(null)
    startRerun({ sessionId, target: resolved, autoSubmit }).then(
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

  if (target === null) return null
  return (
    <>
      <Tooltip label={busy ? t('busy') : t('edit.hint')} side="bottom">
        <button
          type="button"
          className={ACTION_CLASS}
          aria-label={t('edit.label')}
          {...(busy ? { [BUSY_ATTR]: true, 'aria-disabled': true } : {})}
          onClick={busy ? undefined : () => { run(target, false) }}
        >
          <IconEditOutline16 />
        </button>
      </Tooltip>
      <Tooltip label={busy ? t('busy') : t('rerun.hint')} side="bottom">
        <button
          type="button"
          className={ACTION_CLASS}
          aria-label={t('rerun.label')}
          {...(busy ? { [BUSY_ATTR]: true, 'aria-disabled': true } : {})}
          onClick={busy ? undefined : () => { run(target, true) }}
        >
          <IconRefreshOutline16 />
        </button>
      </Tooltip>
      {error !== null && (
        <Toast text={t('error.fork', { reason: error })} onDone={() => { setError(null) }} />
      )}
    </>
  )
}
