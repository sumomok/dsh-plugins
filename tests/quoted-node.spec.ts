import { describe, expect, it } from 'vitest'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { pickIncumbent, planQuotedContent } from '../src/client/quoted-node.ts'

const text = (value: string) => ({ type: 'text', text: value })

describe('planQuotedContent', () => {
  it('changes nothing when the message carries no quote', () => {
    expect(planQuotedContent([text('just a question')])).toBeNull()
  })

  it('changes nothing for a message with no text block at all', () => {
    expect(planQuotedContent([{ type: 'image', attachment: {} }])).toBeNull()
  })

  it('changes nothing when several text blocks make the shape ambiguous', () => {
    expect(planQuotedContent([text('> a'), text('b')])).toBeNull()
  })

  it('lifts the quote out and leaves the question in the bubble', () => {
    expect(planQuotedContent([text('question\n\n> Quote:\n> passage')])).toEqual({
      quotes: [['Quote:', 'passage']],
      content: [text('question')],
    })
  })

  it('drops the text block entirely when the quote was the whole message', () => {
    expect(planQuotedContent([text('> Quote:\n> passage')])).toEqual({
      quotes: [['Quote:', 'passage']],
      content: [],
    })
  })

  it('keeps the other blocks of the message in place', () => {
    const image = { type: 'image', attachment: {} }
    expect(planQuotedContent([image, text('> a\n\nq')])).toEqual({
      quotes: [['a']],
      content: [image, text('q')],
    })
  })
})

/** One ledger row, as `ctx.slots.entries` returns them. */
function entry(key: string, component: unknown, priority?: number): StoredEntry {
  return { component, options: { key, ...priority === undefined ? {} : { priority } } }
}

describe('pickIncumbent', () => {
  const ours = () => null
  const host = () => null
  const other = () => null

  it('finds the host entry of the cell it shadows', () => {
    const entries = [entry('user', host), entry('user', ours, -1)]
    expect(pickIncumbent(entries, 'user', ours)).toBe(host)
  })

  it('ignores entries of other keys', () => {
    const entries = [entry('assistant-step', host), entry('user', other)]
    expect(pickIncumbent(entries, 'user', ours)).toBe(other)
  })

  it('takes the lowest priority when several others share the cell', () => {
    const entries = [entry('user', host, 5), entry('user', other, 1), entry('user', ours, -1)]
    expect(pickIncumbent(entries, 'user', ours)).toBe(other)
  })

  it('treats a missing priority as the default 0', () => {
    const entries = [entry('user', host), entry('user', other, 2)]
    expect(pickIncumbent(entries, 'user', ours)).toBe(host)
  })

  it('answers undefined when this plugin is alone in the cell', () => {
    expect(pickIncumbent([entry('user', ours, -1)], 'user', ours)).toBeUndefined()
  })
})
