import { describe, expect, it } from 'vitest'
import { splitQuoteBlocks, stripQuoteHeading } from '../src/core/split-quotes.ts'

describe('splitQuoteBlocks', () => {
  it('returns the text by identity when it carries no quote', () => {
    const text = 'just a question'
    const split = splitQuoteBlocks(text)
    expect(split.quotes).toEqual([])
    expect(split.rest).toBe(text)
  })

  it('takes a leading block and leaves the question', () => {
    expect(splitQuoteBlocks('> Quote:\n> passage\n\nwhat does this mean?')).toEqual({
      quotes: [['Quote:', 'passage']],
      rest: 'what does this mean?',
    })
  })

  it('takes a trailing block, which is where an appended chip lands', () => {
    expect(splitQuoteBlocks('what does this mean?\n\n> Quote:\n> passage')).toEqual({
      quotes: [['Quote:', 'passage']],
      rest: 'what does this mean?',
    })
  })

  it('takes blocks at both edges, in document order', () => {
    expect(splitQuoteBlocks('> first\n\nmiddle\n\n> last')).toEqual({
      quotes: [['first'], ['last']],
      rest: 'middle',
    })
  })

  it('reads a blank line as a block boundary, not as the end of the region', () => {
    expect(splitQuoteBlocks('> one\n\n> two\n\ntext').quotes).toEqual([['one'], ['two']])
  })

  it('accepts a bare marker as an empty quoted line', () => {
    expect(splitQuoteBlocks('> a\n>\n> b\n\ntext').quotes).toEqual([['a', '', 'b']])
  })

  it('leaves a quote in the middle of the message alone', () => {
    const text = 'before\n> quoted mid-sentence\nafter'
    expect(splitQuoteBlocks(text)).toEqual({ quotes: [], rest: text })
  })

  it('drops a block that is nothing but markers', () => {
    expect(splitQuoteBlocks('>\n>\n\ntext')).toEqual({ quotes: [], rest: '>\n>\n\ntext' })
  })

  it('normalizes CRLF before splitting', () => {
    expect(splitQuoteBlocks('> Quote:\r\n> passage\r\n\r\nquestion')).toEqual({
      quotes: [['Quote:', 'passage']],
      rest: 'question',
    })
  })

  it('handles a message that is nothing but the quote', () => {
    expect(splitQuoteBlocks('> Quote:\n> passage')).toEqual({
      quotes: [['Quote:', 'passage']],
      rest: '',
    })
  })

  it('trims the blank lines the blocks leave behind', () => {
    expect(splitQuoteBlocks('> a\n\n\nquestion\n\n\n> b').rest).toBe('question')
  })

  it('keeps a marker-less line that only looks quoted', () => {
    const text = 'a > b'
    expect(splitQuoteBlocks(text).rest).toBe(text)
  })
})

describe('stripQuoteHeading', () => {
  const headings = ['引用：', 'Quote:']

  it('drops the heading this plugin wrote, in either locale', () => {
    expect(stripQuoteHeading(['引用：', 'body'], headings)).toEqual(['body'])
    expect(stripQuoteHeading(['Quote:', 'body'], headings)).toEqual(['body'])
  })

  it('keeps every line of a blockquote written by hand', () => {
    expect(stripQuoteHeading(['some quote', 'more'], headings)).toEqual(['some quote', 'more'])
  })

  it('tolerates an empty block', () => {
    expect(stripQuoteHeading([], headings)).toEqual([])
  })
})
