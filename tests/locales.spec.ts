import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('dictionaries', () => {
  it('carry the same key set in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('leave no entry blank', () => {
    for (const [key, value] of [...Object.entries(zh), ...Object.entries(en)]) {
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('keep the {reason} placeholder on the failure line in both languages', () => {
    expect(zh['error.fork']).toContain('{reason}')
    expect(en['error.fork']).toContain('{reason}')
  })
})
