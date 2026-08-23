import { describe, expect, it } from 'vitest'
import {
  buildQuotePayload, capQuoteText, decodeQuoteRef, encodeQuoteRef, QUOTE_TEXT_LIMIT,
  quoteBlock, serializeQuote,
} from '../src/core/quote.ts'

/** The two shipped header lines, as the client reads them off the locale service. */
const ZH = '引用：'
const EN = 'Quote:'

describe('capQuoteText', () => {
  it('keeps a text at or below the limit unchanged and reports no total', () => {
    expect(capQuoteText('short', 5)).toEqual({ text: 'short' })
  })

  it('caps a longer text and reports the original length', () => {
    expect(capQuoteText('abcdef', 4)).toEqual({ text: 'abcd', totalChars: 6 })
  })

  it('counts code points, not UTF-16 units, so a cap never splits an emoji', () => {
    expect(capQuoteText('🙂🙂🙂', 2)).toEqual({ text: '🙂🙂', totalChars: 3 })
  })

  it('defaults to the 4000-character cap', () => {
    const capped = capQuoteText('x'.repeat(QUOTE_TEXT_LIMIT + 1))
    expect(capped.text).toHaveLength(QUOTE_TEXT_LIMIT)
    expect(capped.totalChars).toBe(QUOTE_TEXT_LIMIT + 1)
  })
})

describe('buildQuotePayload', () => {
  it('keeps only the identity fields it was given', () => {
    expect(buildQuotePayload({ text: 'hi' })).toEqual({ text: 'hi' })
    expect(buildQuotePayload({ text: 'hi', seq: 7, role: 'user' })).toEqual({ text: 'hi', seq: 7, role: 'user' })
  })

  it('drops explicitly undefined identity fields rather than storing them', () => {
    const payload = buildQuotePayload({ text: 'hi', seq: 7, role: 'assistant', messageId: undefined })
    expect(Object.keys(payload).sort()).toEqual(['role', 'seq', 'text'])
  })

  it('caps the text and records the original length', () => {
    const payload = buildQuotePayload({ text: 'y'.repeat(QUOTE_TEXT_LIMIT + 5) })
    expect(payload.text).toHaveLength(QUOTE_TEXT_LIMIT)
    expect(payload.totalChars).toBe(QUOTE_TEXT_LIMIT + 5)
  })
})

describe('quoteBlock', () => {
  it('prefixes every line, and keeps a bare marker on an empty line', () => {
    expect(quoteBlock({ text: 'first\n\nsecond', seq: 3, role: 'user' }, ZH)).toBe(
      '> 引用：\n> first\n>\n> second',
    )
  })

  it('opens with the header line alone — no position, no role, whatever the payload knows', () => {
    const rich = { text: 'body', seq: 12, role: 'assistant' as const, messageId: 'msg_9' }
    expect(quoteBlock(rich, EN)).toBe('> Quote:\n> body')
  })

  it('keeps the truncation note in English, a measurement rather than prose', () => {
    expect(quoteBlock({ text: 'kept', seq: 3, role: 'user', totalChars: 9000 }, EN)).toBe(
      '> Quote:\n> kept\n> …(truncated, 9000 chars total)',
    )
  })

  it('appends the truncation note as its own quoted line', () => {
    expect(quoteBlock({ text: 'kept', seq: 3, role: 'user', totalChars: 9000 }, ZH)).toBe(
      '> 引用：\n> kept\n> …(truncated, 9000 chars total)',
    )
  })
})

describe('serializeQuote', () => {
  it('opens on its own line and closes the blockquote with a blank line', () => {
    expect(serializeQuote({ text: 'body', seq: 1, role: 'user' }, ZH))
      .toBe('\n> 引用：\n> body\n\n')
  })
})

describe('the host message id', () => {
  const carried = buildQuotePayload({ text: 'body', seq: 12, role: 'assistant', messageId: 'msg_9' })

  it('survives the round trip, because resolution may want it', () => {
    expect(decodeQuoteRef(encodeQuoteRef(carried)).messageId).toBe('msg_9')
  })

  it('reaches none of the projections a human or the model reads', () => {
    // quoteBlock is also the chip's clipboardText, so this covers copy/paste.
    for (const projection of [quoteBlock(carried, ZH), serializeQuote(carried, EN)]) {
      expect(projection).not.toContain('msg_9')
    }
  })
})

describe('the reference payload', () => {
  it('round-trips through the opaque ref string', () => {
    const payload = buildQuotePayload({ text: 'line\nline', seq: 4, role: 'assistant', messageId: 'msg_1' })
    expect(decodeQuoteRef(encodeQuoteRef(payload))).toEqual(payload)
  })

  it('serializes from the payload alone, with no lookup into plugin state', () => {
    const ref = encodeQuoteRef(buildQuotePayload({ text: 'carried', seq: 2, role: 'user' }))
    expect(serializeQuote(decodeQuoteRef(ref), ZH)).toBe('\n> 引用：\n> carried\n\n')
  })

  it('refuses an unreadable reference instead of inventing a quote', () => {
    expect(() => decodeQuoteRef('not json')).toThrow(/unreadable reference payload/u)
  })

  it('refuses a well-formed value that carries no text', () => {
    expect(() => decodeQuoteRef('{"seq":1}')).toThrow(/carries no quoted text/u)
    expect(() => decodeQuoteRef('null')).toThrow(/carries no quoted text/u)
  })
})
