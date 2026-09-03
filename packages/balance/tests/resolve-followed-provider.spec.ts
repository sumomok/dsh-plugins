import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import { describe, expect, it } from 'vitest'
import { resolveFollowedProviderId } from '../src/client/resolve-followed-provider.ts'
import { DEEPSEEK_PROVIDER_ID } from '../src/provider-id.ts'

type Sessions = Pick<ISessions, 'list' | 'binding'>

/**
 * A sessions face over one current session and the projection its binding
 * reads back, matching the real `ISessions` shape (`.list.getSnapshot().current`,
 * `.binding(id).session.projections.faceOf('modelSelection').getSnapshot()`).
 * @param current - the current session id, or undefined for no open session.
 * @param projection - the projection `binding(current)` resolves, or
 *   undefined to stand in for a session with no live scope (e.g. an
 *   addressed subagent).
 * @returns the fake sessions face.
 */
function sessionsWith(current: string | undefined, projection?: ModelSelectionProjection): Sessions {
  return {
    list: { getSnapshot: () => ({ current }) },
    binding: (id: string) => id !== current || projection === undefined
      ? undefined
      : { session: { projections: { faceOf: () => ({ getSnapshot: () => projection }) } } },
  } as unknown as Sessions
}

describe('resolveFollowedProviderId', () => {
  it('falls back to DeepSeek when no session is open, asking nothing', () => {
    const sessions = sessionsWith(undefined, { lastUsed: null, next: { provider: 'should-not-be-read', model: 'x' } })
    expect(resolveFollowedProviderId(sessions)).toBe(DEEPSEEK_PROVIDER_ID)
  })

  it('reads the current session\'s selected model\'s provider', () => {
    const sessions = sessionsWith('session-1', { lastUsed: null, next: { provider: 'anthropic', model: 'x' } })
    expect(resolveFollowedProviderId(sessions)).toBe('anthropic')
  })

  it('falls back to the last used selection when no next selection is pending', () => {
    const sessions = sessionsWith('session-1', { lastUsed: { provider: 'anthropic', model: 'x' }, next: null })
    expect(resolveFollowedProviderId(sessions)).toBe('anthropic')
  })

  it('falls back to DeepSeek for a session with no live scope (e.g. an addressed subagent)', () => {
    const sessions = sessionsWith('session-1', undefined)
    expect(resolveFollowedProviderId(sessions)).toBe(DEEPSEEK_PROVIDER_ID)
  })

  it('falls back to DeepSeek when the session has recorded no selection yet', () => {
    const sessions = sessionsWith('session-1', { lastUsed: null, next: null })
    expect(resolveFollowedProviderId(sessions)).toBe(DEEPSEEK_PROVIDER_ID)
  })

  it('falls back to DeepSeek when the selection names an empty provider', () => {
    const sessions = sessionsWith('session-1', { lastUsed: null, next: { provider: '', model: 'x' } })
    expect(resolveFollowedProviderId(sessions)).toBe(DEEPSEEK_PROVIDER_ID)
  })
})
