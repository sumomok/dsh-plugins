/**
 * Where each provider this plugin has a named adapter for takes a top-up.
 *
 * **This table is maintained by hand and re-checked at every release.** These
 * are console pages, not an API: a provider can move, rename, or retire one
 * without any signal this plugin could read, and every entry below was opened
 * and confirmed against the provider's own console routing or documentation
 * before it was written down. Nothing here is derived from a base URL.
 *
 * Last re-checked: 2026-09-03.
 *
 * A provider absent from the table shows no button. That is every custom
 * gateway a deployment configures itself: its billing page is not something
 * this plugin can know, and guessing one from the API origin would send the
 * user somewhere arbitrary.
 *
 * @module @sumomok/dsh-balance/client/top-up-links
 */

import {
  DEEPSEEK_PROVIDER_ID, KIMI_CODING_PROVIDER_ID, MOONSHOTAI_CN_PROVIDER_ID, MOONSHOTAI_PROVIDER_ID,
} from '../provider-id.ts'

/**
 * Top-up page per provider id, keyed by the ids this plugin's named adapters
 * serve. Addresses are the canonical ones a provider's own console settles
 * on, so opening one costs no redirect.
 */
export const TOP_UP_LINKS: ReadonlyMap<string, string> = new Map([
  [DEEPSEEK_PROVIDER_ID, 'https://platform.deepseek.com/top_up'],
  [MOONSHOTAI_PROVIDER_ID, 'https://platform.kimi.ai/console/pay'],
  [MOONSHOTAI_CN_PROVIDER_ID, 'https://platform.kimi.com/console/pay'],
  // Kimi For Coding is sold as a subscription rather than a balance, so its
  // "top up" is the membership page the plan is bought and renewed on.
  [KIMI_CODING_PROVIDER_ID, 'https://www.kimi.com/membership/pricing'],
])

/**
 * The top-up page for one provider.
 * @param provider - provider route id.
 * @returns the page's address, or `undefined` for a provider this table does
 * not name, which renders no button.
 */
export function topUpLinkFor(provider: string): string | undefined {
  return TOP_UP_LINKS.get(provider)
}
