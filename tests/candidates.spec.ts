import { describe, expect, it } from 'vitest'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CANDIDATE_PREVIEW_LIMIT, candidateName, candidatePreview, filterQuoteSources,
  quoteIdentityAt, quoteSourceBySeq, quoteSources,
} from '../src/core/candidates.ts'
import type { QuoteRole } from '../src/core/quote.ts'

/** Localized role words the picker passes in (the fixtures use the English ones). */
const roleWord = (role: QuoteRole): string => (role === 'user' ? 'user' : 'assistant')

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
    blocks: [{ kind: 'reasoning', text: 'thinking' }, { kind: 'text', text }],
    ...messageId === undefined ? {} : { messageId },
  } as ConversationNode
}

const SNAPSHOT: readonly ConversationNode[] = [
  user(1, 'first question'),
  assistant(2, 'first answer', 'msg_a'),
  { kind: 'tool-result', seq: 3, time: 30, callId: 'c1', content: [{ type: 'text', text: 'tool output' }] } as unknown as ConversationNode,
  { kind: 'steering', seq: 4, time: 40, messageId: 'msg_s', content: [{ type: 'text', text: 'steer me' }], source: null } as ConversationNode,
  assistant(5, '', 'msg_empty'),
  assistant(6, 'second answer'),
]

describe('quoteSources', () => {
  it('lists user, steering, and assistant messages newest first', () => {
    expect(quoteSources(SNAPSHOT).map(source => [source.seq, source.role, source.text])).toEqual([
      [6, 'assistant', 'second answer'],
      [4, 'user', 'steer me'],
      [2, 'assistant', 'first answer'],
      [1, 'user', 'first question'],
    ])
  })

  it('carries the assistant message id when the host recorded one', () => {
    const sources = quoteSources(SNAPSHOT)
    expect(sources.find(source => source.seq === 2)?.messageId).toBe('msg_a')
    expect(sources.find(source => source.seq === 6)).not.toHaveProperty('messageId')
  })

  it('quotes what was said, not reasoning, tool output, or an empty message', () => {
    const texts = quoteSources(SNAPSHOT).map(source => source.text)
    expect(texts).not.toContain('thinking')
    expect(texts).not.toContain('tool output')
    expect(texts.every(text => text !== '')).toBe(true)
  })

  it('skips a human message with no text blocks, such as an image-only prompt', () => {
    const imageOnly = {
      kind: 'user', seq: 8, time: 80, source: null,
      content: [{ type: 'image', attachment: {} }],
    } as unknown as ConversationNode
    expect(quoteSources([imageOnly])).toEqual([])
  })

  it('joins several text blocks of one message', () => {
    const node = {
      kind: 'assistant', seq: 9, time: 90, turn: 1, step: 1,
      blocks: [{ kind: 'text', text: 'a' }, { kind: 'image' }, { kind: 'text', text: 'b' }],
    } as unknown as ConversationNode
    expect(quoteSources([node])[0]?.text).toBe('a\nb')
  })

  it('is empty for a session with nothing quotable', () => {
    expect(quoteSources([])).toEqual([])
  })
})

describe('filterQuoteSources', () => {
  const sources = quoteSources(SNAPSHOT)

  it('returns everything for a blank query', () => {
    expect(filterQuoteSources(sources, '   ')).toHaveLength(4)
  })

  it('matches message text case-insensitively, keeping the order', () => {
    expect(filterQuoteSources(sources, 'ANSWER').map(source => source.seq)).toEqual([6, 2])
  })

  it('answers empty when nothing matches', () => {
    expect(filterQuoteSources(sources, 'zzz')).toEqual([])
  })
})

describe('candidatePreview', () => {
  it('collapses newlines and runs of whitespace into single spaces', () => {
    expect(candidatePreview('  a\n\n  b\tc ')).toBe('a b c')
  })

  it('cuts at the preview limit and marks the cut', () => {
    const preview = candidatePreview('x'.repeat(CANDIDATE_PREVIEW_LIMIT + 10))
    expect(preview).toBe(`${'x'.repeat(CANDIDATE_PREVIEW_LIMIT)}…`)
  })

  it('leaves a text at exactly the limit whole', () => {
    expect(candidatePreview('y'.repeat(CANDIDATE_PREVIEW_LIMIT))).toHaveLength(CANDIDATE_PREVIEW_LIMIT)
  })
})

describe('candidateName', () => {
  it('reads seq, role, and the first line of the message', () => {
    expect(candidateName({ seq: 12, role: 'assistant', text: 'hello\nworld' }, roleWord))
      .toBe('#12 assistant · hello world')
  })
})

describe('quoteSourceBySeq', () => {
  it('resolves a picked row, and answers undefined once the snapshot dropped it', () => {
    const sources = quoteSources(SNAPSHOT)
    expect(quoteSourceBySeq(sources, 2)?.text).toBe('first answer')
    expect(quoteSourceBySeq(sources, 999)).toBeUndefined()
  })
})

describe('quoteIdentityAt', () => {
  it('names the role of a message row', () => {
    expect(quoteIdentityAt(SNAPSHOT, 1)).toEqual({ seq: 1, role: 'user' })
    expect(quoteIdentityAt(SNAPSHOT, 4)).toEqual({ seq: 4, role: 'user' })
    expect(quoteIdentityAt(SNAPSHOT, 2)).toEqual({ seq: 2, role: 'assistant', messageId: 'msg_a' })
    expect(quoteIdentityAt(SNAPSHOT, 6)).toEqual({ seq: 6, role: 'assistant' })
  })

  it('keeps the position of a non-message row, which is still worth quoting', () => {
    expect(quoteIdentityAt(SNAPSHOT, 3)).toEqual({ seq: 3 })
  })

  it('keeps the position of a row the window no longer holds', () => {
    expect(quoteIdentityAt(SNAPSHOT, 404)).toEqual({ seq: 404 })
  })
})
