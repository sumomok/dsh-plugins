/**
 * The per-session spend line under the composer.
 *
 * It reads the host's own projection of this session's log, so it needs no
 * request of its own and it stays right when a session is resumed weeks later.
 * It renders nothing until that session has priced usage, so a conversation
 * with no model call — or one on a model the price table does not price —
 * shows no line rather than a confident zero.
 *
 * @module @sumomok/dsh-balance/client/SessionSpendLine
 */

import type { ReactNode } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `balanceSessionSpend` projection key merge.
import type {} from '../session-spend.ts'
import { fill, formatSpend } from './format.ts'
import { Guard } from './Guard.tsx'
import type { BalanceState } from './store.ts'

/** A `useSyncExternalStore`-backed selector hook, as the slot framework binds it. */
type BalanceHook = <S>(selector: (state: BalanceState) => S) => S

/** Props the line reads from its composed slot props. */
export interface SessionSpendLineProps {
  /** The framework-injected translate seat for this plugin's namespace. */
  t: TranslateNS<'balance'>
  /** The framework's projection reader for the current session. */
  useProjection: UseProjection
  /** Selector over the browser half's own store, for the surface toggle. */
  useBalance: BalanceHook
}

/** The line body, without the render guard. */
function LineBody({ t, useProjection, useBalance }: SessionSpendLineProps): ReactNode {
  const spend = useProjection('balanceSessionSpend')
  const enabled = useBalance(state => state.spend?.ui.sessionSpend ?? true)
  if (!enabled || spend === undefined) return null
  if (spend.total <= 0 && spend.unpricedTokens <= 0) return null
  const amount = fill(t('spend.session'), { amount: formatSpend(spend.currency, spend.total) })
  const unpriced = spend.unpricedTokens > 0
    ? ` · ${fill(t('spend.unpriced'), { tokens: String(spend.unpricedTokens) })}`
    : ''
  return <div className="dshb-session">{`${amount}${unpriced}`}</div>
}

/**
 * The registered slot component.
 * @param props - composed slot props.
 * @returns the line, or nothing while this session has no priced usage.
 */
export function SessionSpendLine(props: SessionSpendLineProps): ReactNode {
  return (
    <Guard>
      <LineBody {...props} />
    </Guard>
  )
}
