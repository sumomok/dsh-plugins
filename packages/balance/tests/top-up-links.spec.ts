/**
 * The hand-maintained top-up table. These assertions are the record of what
 * was opened and confirmed for this release: a failing one means the table
 * changed, which is exactly the change that has to be re-verified against the
 * provider's own console before it ships.
 */

import { describe, expect, it } from 'vitest'
import { TOP_UP_LINKS, topUpLinkFor } from '../src/client/top-up-links.ts'
import {
  DEEPSEEK_PROVIDER_ID, KIMI_CODING_PROVIDER_ID, MOONSHOTAI_CN_PROVIDER_ID, MOONSHOTAI_PROVIDER_ID,
} from '../src/provider-id.ts'

describe('the top-up table', () => {
  it('names a page for every provider this plugin has a named adapter for', () => {
    expect([...TOP_UP_LINKS.entries()]).toEqual([
      [DEEPSEEK_PROVIDER_ID, 'https://platform.deepseek.com/top_up'],
      [MOONSHOTAI_PROVIDER_ID, 'https://platform.kimi.ai/console/pay'],
      [MOONSHOTAI_CN_PROVIDER_ID, 'https://platform.kimi.com/console/pay'],
      [KIMI_CODING_PROVIDER_ID, 'https://www.kimi.com/membership/pricing'],
    ])
  })

  it('carries every address as an absolute https URL, so a click cannot land in-app', () => {
    for (const [provider, url] of TOP_UP_LINKS) {
      expect(new URL(url).protocol, provider).toBe('https:')
    }
  })

  it('answers nothing for a provider a deployment configured itself', () => {
    expect(topUpLinkFor('mock-gateway')).toBeUndefined()
    expect(topUpLinkFor('')).toBeUndefined()
  })
})
