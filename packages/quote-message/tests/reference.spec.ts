import { describe, expect, it } from 'vitest'
import { decodeQuoteRef, buildQuotePayload } from '../src/core/quote.ts'
import { chipLabel, QUOTE_SOURCE_NAME, quoteReference } from '../src/client/reference.ts'

/** The English dictionary's rendering, as the bound translate returns it. */
const t = ((key: string, params?: Record<string, unknown>): string => {
  const table: Record<string, string> = {
    'chip.label': `Quote #${String(params?.seq)} ${String(params?.role)}`,
    'chip.labelUnknown': 'Quote',
    'role.user': 'user',
    'role.assistant': 'assistant',
  }
  return table[key] ?? key
}) as Parameters<typeof chipLabel>[1]

describe('chipLabel', () => {
  it('names position and role', () => {
    expect(chipLabel(buildQuotePayload({ text: 'x', seq: 7, role: 'user' }), t)).toBe('Quote #7 user')
  })

  it('falls back to the bare marker when the source is unknown', () => {
    expect(chipLabel(buildQuotePayload({ text: 'x' }), t)).toBe('Quote')
    expect(chipLabel(buildQuotePayload({ text: 'x', seq: 7 }), t)).toBe('Quote')
  })

  it('never renders the host message id', () => {
    const payload = buildQuotePayload({ text: 'x', seq: 7, role: 'assistant', messageId: 'msg_9' })
    expect(chipLabel(payload, t)).not.toContain('msg_9')
  })
})

describe('quoteReference', () => {
  const payload = buildQuotePayload({ text: 'body', seq: 7, role: 'assistant', messageId: 'msg_9' })
  const reference = quoteReference(payload, 'Quote #7 assistant', '> Quote:\n> body')

  it('routes to this plugin\'s own codec', () => {
    // The composer expands an occurrence by looking this name up in the
    // trigger roster; a different name would leave the chip unsendable.
    expect(reference.source).toBe(QUOTE_SOURCE_NAME)
  })

  it('wears the session glyph, so it reads as a reference like the first-party chips', () => {
    expect(reference.appearance).toBe('session')
  })

  it('carries the quoted text in the ref itself, not a key into plugin state', () => {
    expect(decodeQuoteRef(reference.ref)).toEqual(payload)
  })

  it('shows neither the message id in its label nor in its clipboard text', () => {
    expect(reference.label).not.toContain('msg_9')
    expect(reference.clipboardText).not.toContain('msg_9')
  })
})
