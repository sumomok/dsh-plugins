/**
 * The `accountBalance` Service Definition and its Typert Remote face.
 *
 * The browser reaches this service only through the harness's own `/api`
 * Typert gateway, which inherits the host's trust fence. This plugin registers
 * no HTTP route of its own, so nothing it knows is reachable by a caller the
 * harness has not already admitted.
 *
 * Every method is a read. There is no mutator on this seam at all: the price
 * table, the currency preference, and the polling windows change only through
 * `cordis.yml`, so a caller admitted to `/api` behind a reverse proxy can read
 * numbers and change nothing — and learns no key, no endpoint, and no prompt.
 *
 * @module @sumomok/dsh-balance/service
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { BalanceView, ProviderOption, SpendView } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Account balance and spend reads (provided by `@sumomok/dsh-balance`). */
    accountBalance: AccountBalanceService
  }
}

/** Read-only account balance and spend capability. */
export abstract class AccountBalanceService extends TypertRemoteService {
  /**
   * @param ctx - owning plugin context.
   */
  constructor(ctx: Context) {
    super(ctx, 'accountBalance')
  }

  /**
   * One provider's account balance.
   * @param provider - provider route id; the DeepSeek route when omitted.
   * @param force - bypass the refresh and retry windows; an in-flight read is
   * joined rather than duplicated.
   * @returns the balance, or why it cannot be shown.
   */
  abstract get(provider?: string, force?: boolean): Promise<BalanceView>

  /**
   * Day, month, and all-time spend of one provider from this installation's
   * own ledger: what that route alone cost, so the figure sits under that
   * provider's balance.
   * @param provider - provider route id; the DeepSeek route when omitted.
   * @returns the totals, their currency, and the price table's date.
   */
  abstract spend(provider?: string): Promise<SpendView>

  /**
   * The provider picker's roster: every route this deployment could show a
   * balance for right now — statically supported by this plugin's adapters,
   * and probed as actually configured with a resolvable credential.
   * @returns the filtered roster; excludes an unsupported or unconfigured
   * route even when the harness's own directory lists it.
   */
  abstract providers(): Promise<ProviderOption[]>

  /**
   * Remote face of {@link AccountBalanceService.get}; the decorator cannot mark
   * the abstract member, so this concrete adapter carries the identical contract.
   * @param provider - provider route id; the DeepSeek route when omitted.
   * @param force - bypass the refresh and retry windows.
   * @returns the balance, or why it cannot be shown.
   */
  @Remote('get')
  remoteExportGet(provider?: string, force?: boolean): Promise<BalanceView> {
    return this.get(provider, force)
  }

  /**
   * Remote face of {@link AccountBalanceService.spend}.
   * @param provider - provider route id; the DeepSeek route when omitted.
   * @returns the totals, their currency, and the price table's date.
   */
  @Remote('spend')
  remoteExportSpend(provider?: string): Promise<SpendView> {
    return this.spend(provider)
  }

  /**
   * Remote face of {@link AccountBalanceService.providers}.
   * @returns the filtered roster.
   */
  @Remote('providers')
  remoteExportProviders(): Promise<ProviderOption[]> {
    return this.providers()
  }
}

export default AccountBalanceService
