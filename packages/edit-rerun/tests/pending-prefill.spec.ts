import { describe, expect, it } from 'vitest'
import { createPrefillStore } from '../src/core/pending-prefill.ts'

describe('createPrefillStore', () => {
  it('hands a parked prefill to its own session exactly once', () => {
    const store = createPrefillStore()
    store.put('child', { text: 'question', autoSubmit: false })
    expect(store.take('child')).toEqual({ text: 'question', autoSubmit: false })
    expect(store.take('child')).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('keeps prefills apart per session', () => {
    const store = createPrefillStore()
    store.put('a', { text: 'one', autoSubmit: false })
    store.put('b', { text: 'two', autoSubmit: true })
    expect(store.take('b')).toEqual({ text: 'two', autoSubmit: true })
    expect(store.take('a')).toEqual({ text: 'one', autoSubmit: false })
  })

  it('reports nothing for a session that never had one', () => {
    expect(createPrefillStore().take('absent')).toBeUndefined()
  })

  it('replaces the entry waiting for the same session', () => {
    const store = createPrefillStore()
    store.put('child', { text: 'first', autoSubmit: false })
    store.put('child', { text: 'second', autoSubmit: true })
    expect(store.size).toBe(1)
    expect(store.take('child')).toEqual({ text: 'second', autoSubmit: true })
  })

  it('drops the oldest entry past the cap so an unopened child cannot leak', () => {
    const store = createPrefillStore()
    for (let i = 0; i < 9; i++) store.put(`s${String(i)}`, { text: `q${String(i)}`, autoSubmit: false })
    expect(store.size).toBe(8)
    expect(store.take('s0')).toBeUndefined()
    expect(store.take('s8')).toEqual({ text: 'q8', autoSubmit: false })
  })

  it('gives every store its own entries', () => {
    const one = createPrefillStore()
    const other = createPrefillStore()
    one.put('child', { text: 'question', autoSubmit: false })
    expect(other.take('child')).toBeUndefined()
    expect(one.take('child')).toBeDefined()
  })
})
