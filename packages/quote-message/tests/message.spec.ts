import { describe, expect, it } from 'vitest'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import { quoteIdentityAt } from '../src/core/message.ts'

function user(seq: number, text: string): ConversationNode {
  return { kind: 'user', seq, time: seq * 10, content: [{ type: 'text', text }], source: null } as ConversationNode
}

function assistant(seq: number, text: string, messageId?: string): ConversationNode {
  return {
    kind: 'assistant',
    seq,
    time: seq * 10,
    turn: 1,
    step: 1,
    blocks: [{ kind: 'text', text }],
    ...messageId === undefined ? {} : { messageId },
  } as ConversationNode
}

const SNAPSHOT: readonly ConversationNode[] = [
  user(1, 'first question'),
  assistant(2, 'first answer', 'msg_a'),
  { kind: 'tool-result', seq: 3, time: 30, callId: 'c1', content: [{ type: 'text', text: 'tool output' }] } as unknown as ConversationNode,
  { kind: 'steering', seq: 4, time: 40, messageId: 'msg_s', content: [{ type: 'text', text: 'steer me' }], source: null } as ConversationNode,
  assistant(6, 'second answer'),
]

describe('quoteIdentityAt', () => {
  it('names the role of a message row', () => {
    expect(quoteIdentityAt(SNAPSHOT, 1)).toEqual({ seq: 1, role: 'user' })
    expect(quoteIdentityAt(SNAPSHOT, 6)).toEqual({ seq: 6, role: 'assistant' })
  })

  it('reads a steering message as the human prompt it is', () => {
    expect(quoteIdentityAt(SNAPSHOT, 4)).toEqual({ seq: 4, role: 'user' })
  })

  it('carries the assistant message id for resolution', () => {
    expect(quoteIdentityAt(SNAPSHOT, 2)).toEqual({ seq: 2, role: 'assistant', messageId: 'msg_a' })
  })

  it('keeps the position of a non-message row, which is still worth quoting', () => {
    expect(quoteIdentityAt(SNAPSHOT, 3)).toEqual({ seq: 3 })
  })

  it('keeps the position of a row the window no longer holds', () => {
    expect(quoteIdentityAt(SNAPSHOT, 404)).toEqual({ seq: 404 })
  })
})
