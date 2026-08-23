import { describe, expect, it } from 'vitest'
import { quoteInsertRange } from '../src/core/draft.ts'

describe('quoteInsertRange', () => {
  it('is the start of an empty draft', () => {
    expect(quoteInsertRange({ draft: '' })).toEqual({ start: 0, end: 0 })
  })

  it('is the end of a draft that already holds text, never its start', () => {
    expect(quoteInsertRange({ draft: '请解释' })).toEqual({ start: 3, end: 3 })
  })

  it('measures in UTF-16 units, the coordinates the input machine splices with', () => {
    // Two astral characters: four UTF-16 units, two code points. A code-point
    // count would name an offset inside the draft and the chip would land there.
    expect(quoteInsertRange({ draft: '🙂🙂' })).toEqual({ start: 4, end: 4 })
  })

  it('is zero-width, so the insert adds a chip instead of replacing draft text', () => {
    const range = quoteInsertRange({ draft: 'abc' })
    expect(range.start).toBe(range.end)
  })

  it('leaves the separator to the machine: a draft already ending in a space still ends there', () => {
    expect(quoteInsertRange({ draft: 'abc ' })).toEqual({ start: 4, end: 4 })
  })
})
