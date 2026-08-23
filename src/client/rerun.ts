/**
 * Runtime wiring for the rerun flow: turn a resolved {@link RerunTarget} into
 * an open child session with the question parked for its composer.
 *
 * Only official client services are used — `sessions.fork`, `sessions.open`,
 * and the workspace's own blank-session path. No session event is written and
 * no host route is called.
 */
import type {
  ISessions,
  IWorkspaces,
  SessionId,
  WorkspaceId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { PrefillStore } from '../core/pending-prefill.ts'
import type { RerunTarget } from '../core/anchor.ts'

/** Starting a rerun: the target plus how the child should treat the question. */
export interface StartRerunInput {
  /** The session the question was asked in; it is never modified. */
  sessionId: SessionId
  /** The resolved fork anchor and question text. */
  target: RerunTarget
  /** Send the question immediately instead of leaving it for the user to edit. */
  autoSubmit: boolean
}

/** The rerun flow, bound to the live services. */
export type StartRerun = (input: StartRerunInput) => Promise<void>

/**
 * Connect the workspace's reusable blank session, creating the workspace entry
 * when the client has not seen it yet. This is the first-turn fallback: the
 * question opened the session, so there is no earlier completed turn to fork
 * from and the rerun starts a sibling conversation in the same directory.
 * @param workspaces - the workspaces service.
 * @param cwd - the source session's workspace directory.
 * @returns the blank session's id.
 * @throws {Error} when the source session has no workspace directory.
 */
export async function connectBlankSession(workspaces: IWorkspaces, cwd: string | undefined): Promise<SessionId> {
  if (cwd === undefined || cwd === '') {
    throw new Error('the source session has no workspace directory, so a sibling session cannot be started')
  }
  const items = workspaces.list.getSnapshot().items
  let workspaceId: WorkspaceId | undefined = items.find(item => item.path === cwd)?.workspaceId
  if (workspaceId === undefined) workspaceId = (await workspaces.create({ path: cwd })).workspaceId
  return workspaces.connectWorkspace(workspaceId)
}

/**
 * Build the rerun flow over the live services.
 *
 * Ordering is deliberate: the prefill is parked BEFORE the child is opened, so
 * a composer that mounts synchronously with `open()` still finds it.
 * @param sessions - the sessions service.
 * @param workspaces - the workspaces service.
 * @param store - the pending-prefill handoff.
 * @returns the flow; it rejects with the host's own error text on refusal.
 */
export function createStartRerun(sessions: ISessions, workspaces: IWorkspaces, store: PrefillStore): StartRerun {
  return async ({ sessionId, target, autoSubmit }) => {
    const childId = target.forkAtSeq === null
      ? await connectBlankSession(workspaces, sessions.list.getSnapshot().byId[sessionId]?.cwd)
      : await sessions.fork({ sessionId, atSeq: target.forkAtSeq, increaseTitle: true })
    store.put(childId, { text: target.text, autoSubmit })
    sessions.open(childId)
  }
}
