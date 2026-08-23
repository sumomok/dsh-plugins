import { describe, expect, it } from 'vitest'
import {
  lastBoundaryBefore, questionText, resolveRerunTarget, turnQuestion,
} from '../src/core/anchor.ts'
import { image, snapshot, text } from './fixtures/snapshot.ts'

/**
 * Two completed turns. The event log reads:
 *   0 turn/start  1 user "first"   2 assistant a0   3 turn/end
 *   4 turn/start  5 user "second"  6 assistant a1   7 turn/end
 */
const twoTurns = snapshot({
  nodes: [
    { kind: 'user', seq: 1, content: [text('first')] },
    { kind: 'assistant', seq: 2, turn: 0, messageId: 'a0' },
    { kind: 'user', seq: 5, content: [text('second')] },
    { kind: 'assistant', seq: 6, turn: 1, messageId: 'a1' },
  ],
  turnEnds: [[0, 3], [1, 7]],
})

describe('questionText', () => {
  it('joins every text block verbatim', () => {
    expect(questionText([text('a'), text('b')])).toBe('ab')
  })

  it('refuses an empty question', () => {
    expect(questionText([])).toBeNull()
  })

  it('refuses a question carrying a non-text block', () => {
    expect(questionText([text('look at this'), image()])).toBeNull()
  })
})

describe('lastBoundaryBefore', () => {
  it('takes the largest boundary strictly below the bound', () => {
    expect(lastBoundaryBefore(new Map([[0, 3], [1, 7], [2, 11]]), 11)).toBe(7)
  })

  it('reports none when every boundary is at or above the bound', () => {
    expect(lastBoundaryBefore(new Map([[0, 3]]), 3)).toBeNull()
  })

  it('reports none for an empty boundary map', () => {
    expect(lastBoundaryBefore(new Map(), 9)).toBeNull()
  })
})

describe('turnQuestion', () => {
  it('takes the first user node inside the window', () => {
    expect(turnQuestion(twoTurns, 3, 7)?.seq).toBe(5)
  })

  it('opens the window at the log start for the first turn', () => {
    expect(turnQuestion(twoTurns, null, 3)?.seq).toBe(1)
  })

  it('reports none when the window holds no user node', () => {
    expect(turnQuestion(twoTurns, 7, 11)).toBeNull()
  })
})

describe('resolveRerunTarget', () => {
  it('anchors a middle turn at the previous turn/end', () => {
    const resolution = resolveRerunTarget(twoTurns, 'a1')
    expect(resolution).toEqual({
      ok: true,
      target: { forkAtSeq: 3, text: 'second', questionSeq: 5, turn: 1 },
    })
  })

  it('reports the first turn as having no anchor', () => {
    const resolution = resolveRerunTarget(twoTurns, 'a0')
    expect(resolution).toEqual({
      ok: true,
      target: { forkAtSeq: null, text: 'first', questionSeq: 1, turn: 0 },
    })
  })

  it('keeps the previous turn/end as the anchor across standalone events', () => {
    // A title and a context injection land between turn 0's end and turn 1's
    // start; the host extends its own cut through them, so the anchor stays
    // the boundary itself.
    const withStandalone = snapshot({
      nodes: [
        { kind: 'user', seq: 1, content: [text('first')] },
        { kind: 'assistant', seq: 2, turn: 0, messageId: 'a0' },
        { kind: 'context', seq: 4 },
        { kind: 'user', seq: 7, content: [text('second')] },
        { kind: 'assistant', seq: 8, turn: 1, messageId: 'a1' },
      ],
      turnEnds: [[0, 3], [1, 9]],
    })
    const resolution = resolveRerunTarget(withStandalone, 'a1')
    expect(resolution).toEqual({
      ok: true,
      target: { forkAtSeq: 3, text: 'second', questionSeq: 7, turn: 1 },
    })
  })

  it('resolves a steered turn to the question that opened it', () => {
    const steered = snapshot({
      nodes: [
        { kind: 'user', seq: 1, content: [text('first')] },
        { kind: 'steering', seq: 3, content: [text('also do this')] },
        { kind: 'assistant', seq: 4, turn: 0, messageId: 'a0' },
      ],
      turnEnds: [[0, 5]],
    })
    const resolution = resolveRerunTarget(steered, 'a0')
    expect(resolution).toEqual({
      ok: true,
      target: { forkAtSeq: null, text: 'first', questionSeq: 1, turn: 0 },
    })
  })

  it('refuses a message whose turn is still open', () => {
    const running = snapshot({
      nodes: [
        { kind: 'user', seq: 1, content: [text('first')] },
        { kind: 'assistant', seq: 2, turn: 0, messageId: 'a0' },
        { kind: 'user', seq: 5, content: [text('second')] },
        { kind: 'assistant', seq: 6, turn: 1, messageId: 'a1' },
      ],
      turnEnds: [[0, 3]],
    })
    expect(resolveRerunTarget(running, 'a1')).toEqual({ ok: false, refusal: 'open-turn' })
  })

  it('still offers an earlier completed turn while the last turn runs', () => {
    const running = snapshot({
      nodes: [
        { kind: 'user', seq: 1, content: [text('first')] },
        { kind: 'assistant', seq: 2, turn: 0, messageId: 'a0' },
        { kind: 'user', seq: 5, content: [text('second')] },
      ],
      turnEnds: [[0, 3]],
    })
    expect(resolveRerunTarget(running, 'a0')).toEqual({
      ok: true,
      target: { forkAtSeq: null, text: 'first', questionSeq: 1, turn: 0 },
    })
  })

  it('refuses an unknown message id', () => {
    expect(resolveRerunTarget(twoTurns, 'nope')).toEqual({ ok: false, refusal: 'unknown-message' })
  })

  it('refuses a removed session', () => {
    const removed = snapshot({ nodes: [], turnEnds: [], removed: true })
    expect(resolveRerunTarget(removed, 'a0')).toEqual({ ok: false, refusal: 'session-removed' })
  })

  it('refuses a turn no user message opened', () => {
    const commandTurn = snapshot({
      nodes: [
        { kind: 'command', seq: 1 },
        { kind: 'assistant', seq: 2, turn: 0, messageId: 'a0' },
      ],
      turnEnds: [[0, 3]],
    })
    expect(resolveRerunTarget(commandTurn, 'a0')).toEqual({ ok: false, refusal: 'no-user-message' })
  })

  it('refuses a question carrying an image', () => {
    const withImage = snapshot({
      nodes: [
        { kind: 'user', seq: 1, content: [text('what is this'), image()] },
        { kind: 'assistant', seq: 2, turn: 0, messageId: 'a0' },
      ],
      turnEnds: [[0, 3]],
    })
    expect(resolveRerunTarget(withImage, 'a0')).toEqual({ ok: false, refusal: 'non-text-question' })
  })

  it('refuses the earliest loaded turn when older events are unloaded', () => {
    const paged = snapshot({
      nodes: [
        { kind: 'user', seq: 41, content: [text('later')] },
        { kind: 'assistant', seq: 42, turn: 9, messageId: 'a9' },
      ],
      turnEnds: [[9, 43]],
      hasMore: true,
    })
    expect(resolveRerunTarget(paged, 'a9')).toEqual({ ok: false, refusal: 'window-incomplete' })
  })

  it('still forks the earliest loaded turn when it has an in-window anchor', () => {
    const paged = snapshot({
      nodes: [
        { kind: 'user', seq: 41, content: [text('later')] },
        { kind: 'assistant', seq: 42, turn: 9, messageId: 'a9' },
      ],
      turnEnds: [[8, 39], [9, 43]],
      hasMore: true,
    })
    expect(resolveRerunTarget(paged, 'a9')).toEqual({
      ok: true,
      target: { forkAtSeq: 39, text: 'later', questionSeq: 41, turn: 9 },
    })
  })
})
