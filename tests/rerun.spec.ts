import { describe, expect, it } from 'vitest'
import type { ISessions, IWorkspaces, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { createPrefillStore } from '../src/core/pending-prefill.ts'
import { connectBlankSession, createStartRerun } from '../src/client/rerun.ts'

/** Calls recorded by the service doubles, in order. */
type Call =
  | { kind: 'fork'; sessionId: string; atSeq?: number; increaseTitle?: boolean }
  | { kind: 'open'; sessionId: string }
  | { kind: 'createWorkspace'; path: string }
  | { kind: 'connectWorkspace'; workspaceId: string }

/**
 * Sessions and workspaces doubles narrow to the four members the flow uses.
 * @param options - source session cwd, known workspaces, and an optional fork rejection.
 */
function services(options: {
  cwd?: string
  workspaces?: readonly { workspaceId: string; path: string }[]
  forkError?: Error
} = {}) {
  const calls: Call[] = []
  const sessions = {
    list: { getSnapshot: () => ({ byId: { source: { cwd: options.cwd } } }) },
    fork: (opts: { sessionId: string; atSeq?: number; increaseTitle?: boolean }) => {
      calls.push({ kind: 'fork', ...opts })
      if (options.forkError !== undefined) return Promise.reject(options.forkError)
      return Promise.resolve('child' as SessionId)
    },
    open: (sessionId: string) => { calls.push({ kind: 'open', sessionId }) },
  } as unknown as ISessions
  const workspaces = {
    list: { getSnapshot: () => ({ items: options.workspaces ?? [] }) },
    create: ({ path }: { path: string }) => {
      calls.push({ kind: 'createWorkspace', path })
      return Promise.resolve({ workspaceId: 'made' })
    },
    connectWorkspace: (workspaceId: string) => {
      calls.push({ kind: 'connectWorkspace', workspaceId })
      return Promise.resolve('blank' as SessionId)
    },
  } as unknown as IWorkspaces
  return { calls, sessions, workspaces }
}

describe('connectBlankSession', () => {
  it('connects a workspace the client already knows', async () => {
    const { calls, workspaces } = services({ workspaces: [{ workspaceId: 'w1', path: '/repo' }] })
    await expect(connectBlankSession(workspaces, '/repo')).resolves.toBe('blank')
    expect(calls).toEqual([{ kind: 'connectWorkspace', workspaceId: 'w1' }])
  })

  it('creates the workspace entry first when the client has not seen it', async () => {
    const { calls, workspaces } = services()
    await expect(connectBlankSession(workspaces, '/repo')).resolves.toBe('blank')
    expect(calls).toEqual([
      { kind: 'createWorkspace', path: '/repo' },
      { kind: 'connectWorkspace', workspaceId: 'made' },
    ])
  })

  it('refuses a session with no workspace directory', async () => {
    const { workspaces } = services()
    await expect(connectBlankSession(workspaces, undefined)).rejects.toThrow(/no workspace directory/)
    await expect(connectBlankSession(workspaces, '')).rejects.toThrow(/no workspace directory/)
  })
})

describe('createStartRerun', () => {
  const target = { forkAtSeq: 3, text: 'second', questionSeq: 5, turn: 1 }

  it('forks at the anchor, parks the question, then opens the child', async () => {
    const { calls, sessions, workspaces } = services({ cwd: '/repo' })
    const store = createPrefillStore()
    await createStartRerun(sessions, workspaces, store)({
      sessionId: 'source' as SessionId, target, autoSubmit: false,
    })
    expect(calls).toEqual([
      { kind: 'fork', sessionId: 'source', atSeq: 3, increaseTitle: true },
      { kind: 'open', sessionId: 'child' },
    ])
    // Parked before open: a composer mounting synchronously with open() finds it.
    expect(store.take('child')).toEqual({ text: 'second', autoSubmit: false })
  })

  it('carries the auto-submit intent to the child', async () => {
    const { sessions, workspaces } = services({ cwd: '/repo' })
    const store = createPrefillStore()
    await createStartRerun(sessions, workspaces, store)({
      sessionId: 'source' as SessionId, target, autoSubmit: true,
    })
    expect(store.take('child')?.autoSubmit).toBe(true)
  })

  it('starts a blank sibling session when the question opened the first turn', async () => {
    const { calls, sessions, workspaces } = services({
      cwd: '/repo', workspaces: [{ workspaceId: 'w1', path: '/repo' }],
    })
    const store = createPrefillStore()
    await createStartRerun(sessions, workspaces, store)({
      sessionId: 'source' as SessionId,
      target: { forkAtSeq: null, text: 'first', questionSeq: 1, turn: 0 },
      autoSubmit: false,
    })
    expect(calls).toEqual([
      { kind: 'connectWorkspace', workspaceId: 'w1' },
      { kind: 'open', sessionId: 'blank' },
    ])
    expect(store.take('blank')).toEqual({ text: 'first', autoSubmit: false })
  })

  it('leaves the source session untouched and parks nothing when the fork is refused', async () => {
    const forkError = new Error('session fork failed: fork-unavailable: no completed turn')
    const { calls, sessions, workspaces } = services({ cwd: '/repo', forkError })
    const store = createPrefillStore()
    await expect(createStartRerun(sessions, workspaces, store)({
      sessionId: 'source' as SessionId, target, autoSubmit: false,
    })).rejects.toThrow(/fork-unavailable/)
    expect(calls).toEqual([{ kind: 'fork', sessionId: 'source', atSeq: 3, increaseTitle: true }])
    expect(store.size).toBe(0)
  })
})
