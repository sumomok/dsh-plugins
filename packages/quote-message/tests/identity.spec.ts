import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createIdentityAt } from '../src/client/identity.ts'

/** A minimal ChatSnapshot-shaped fake: only what identityAt reads. */
function fakeSnapshot(nodesByKey: Record<string, { anchorSeq: number }>, legacyNodes: unknown[]) {
  return {
    nodes: { get: (key: string) => nodesByKey[key] },
    legacy: { nodes: legacyNodes },
  }
}

/** A fake ctx whose ctx.uiConversation.binding(id).target('chat') answers a fixed snapshot. */
function fakeCtx(snapshot: ReturnType<typeof fakeSnapshot> | undefined): Context {
  return {
    uiConversation: {
      binding: () => ({
        target: () => ({ getSnapshot: () => snapshot }),
      }),
    },
  } as unknown as Context
}

const SESSION_ID = 's1' as SessionId

describe('createIdentityAt', () => {
  it('resolves a message row through the chat snapshot to the flat node list', () => {
    const identityAt = createIdentityAt(fakeCtx(fakeSnapshot(
      { row1: { anchorSeq: 2 } },
      [{ kind: 'assistant', seq: 2, turn: 1, step: 1, blocks: [], messageId: 'msg_a' }],
    )))
    expect(identityAt(SESSION_ID, 'row1')).toEqual({ seq: 2, role: 'assistant', messageId: 'msg_a' })
  })

  it('is undefined when the node key does not resolve in the chat snapshot', () => {
    const identityAt = createIdentityAt(fakeCtx(fakeSnapshot({}, [])))
    expect(identityAt(SESSION_ID, 'missing')).toBeUndefined()
  })

  it('is undefined when the session has no "chat" View target yet', () => {
    const identityAt = createIdentityAt(fakeCtx(undefined))
    expect(identityAt(SESSION_ID, 'row1')).toBeUndefined()
  })
})
