/**
 * The sidebar-footer chip: the remaining balance, and a popover breaking down
 * the balance and this installation's spend.
 *
 * Nothing renders while the plugin is unconfigured — no key, or an endpoint
 * this plugin may not talk to. An unconfigured deployment should see the
 * sidebar it had before installing this plugin, not a placeholder explaining
 * that a feature it did not ask for is not working.
 *
 * @module @sumomok/dsh-balance/client/FooterChip
 */

import { useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { BalanceView, SpendTotals, SpendView } from '../types.ts'
import { fill, formatAmount, formatDate, formatSpend, formatTime, tintOf } from './format.ts'
import { Guard } from './Guard.tsx'
import type { BalanceState } from './store.ts'

/** A `useSyncExternalStore`-backed selector hook, as the slot framework binds it. */
type BalanceHook = <S>(selector: (state: BalanceState) => S) => S

/** Props the chip reads from its composed slot props. */
export interface FooterChipProps {
  /** Whether the sidebar renders wide content; `false` is the 56px rail. */
  wide: boolean
  /** The framework-injected translate seat for this plugin's namespace. */
  t: TranslateNS<'balance'>
  /** Selector over the browser half's own store. */
  useBalance: BalanceHook
  /** Read both faces again, bypassing the host's refresh window. */
  refresh: (force: boolean) => void
}

/** One labelled amount inside the popover. */
function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="dshb-pop-row">
      <span className="dshb-muted">{label}</span>
      <span className="dshb-num">{value}</span>
    </div>
  )
}

/** One period's line, with its unpriced tail when there is one. */
function PeriodRow(
  { label, totals, currency, t }: {
    label: string
    totals: SpendTotals
    currency: string
    t: TranslateNS<'balance'>
  },
): ReactNode {
  const unpriced = totals.unpricedTokens > 0
    ? ` · ${fill(t('spend.unpriced'), { tokens: String(totals.unpricedTokens) })}`
    : ''
  return <Row label={label} value={`${formatSpend(currency, totals.cost)}${unpriced}`} />
}

/** The share each price tier took of the all-time spend. */
function scheduleShares(totals: SpendTotals): { name: string; percent: number }[] {
  if (totals.cost <= 0) return []
  return Object.entries(totals.bySchedule)
    .filter(([, cost]) => cost > 0)
    .map(([name, cost]) => ({ name, percent: Math.round((cost / totals.cost) * 100) }))
    .sort((left, right) => right.percent - left.percent)
}

/** The popover body: balance breakdown, spend, and the price table's date. */
function Popover(
  { balance, spend, t }: {
    balance: BalanceView | undefined
    spend: SpendView | undefined
    t: TranslateNS<'balance'>
  },
): ReactNode {
  return (
    <div className="dshb-pop">
      {balance?.state === 'ok' ? (
        <>
          <div className="dshb-pop-head">{t('title')}</div>
          <Row label={t('total')} value={formatAmount(balance.currency, balance.total) ?? balance.total} />
          <Row label={t('granted')} value={formatAmount(balance.currency, balance.granted) ?? balance.granted} />
          <Row label={t('toppedUp')} value={formatAmount(balance.currency, balance.toppedUp) ?? balance.toppedUp} />
          <div className="dshb-pop-foot">
            {fill(t('updated'), { time: formatTime(balance.fetchedAt) })}
            {balance.stale ? ` · ${t('stale')}` : ''}
            {balance.isAvailable ? '' : ` · ${t('suspended')}`}
          </div>
        </>
      ) : null}
      {balance?.state === 'unavailable' ? (
        <>
          <div className="dshb-pop-head">{t('unavailable')}</div>
          <div className="dshb-muted">{t(`reason.${balance.reason}`)}</div>
        </>
      ) : null}
      {spend === undefined ? null : (
        <>
          <hr className="dshb-pop-sep" />
          <div className="dshb-pop-head">{t('spend.title')}</div>
          <PeriodRow label={t('spend.today')} totals={spend.today} currency={spend.currency} t={t} />
          <PeriodRow label={t('spend.month')} totals={spend.month} currency={spend.currency} t={t} />
          <PeriodRow label={t('spend.allTime')} totals={spend.allTime} currency={spend.currency} t={t} />
          {scheduleShares(spend.allTime).map(share => (
            <Row key={share.name} label={share.name} value={`${String(share.percent)}%`} />
          ))}
          <div className="dshb-pop-foot">
            {spend.since === null
              ? t('spend.sinceEmpty')
              : fill(t('spend.since'), { date: formatDate(spend.since) })}
            {' · '}
            {fill(t('spend.pricesAsOf'), { currency: spend.currency, date: spend.pricesAsOf })}
          </div>
        </>
      )}
      <div className="dshb-pop-foot">{t('clickToRefresh')}</div>
    </div>
  )
}

/** The chip body, without the render guard. */
function ChipBody({ wide, t, useBalance, refresh }: FooterChipProps): ReactNode {
  const balance = useBalance(state => state.balance)
  const spend = useBalance(state => state.spend)
  const [open, setOpen] = useState(false)
  // Nothing to show, and nothing to explain: the deployment has no key for
  // this provider, or points at an endpoint this plugin will not talk to.
  if (balance === undefined || balance.state === 'unconfigured') return null
  if (spend !== undefined && !spend.ui.footer) return null

  const label = balance.state === 'ok'
    ? formatAmount(balance.currency, balance.total) ?? balance.total
    : '—'
  const tint = balance.state === 'ok' && spend !== undefined ? tintOf(balance, spend.ui) : 'normal'
  const title = balance.state === 'ok'
    ? `${t('title')} · ${t('clickToRefresh')}`
    : `${t('unavailable')} · ${t(`reason.${balance.reason}`)}`
  const classes = [
    'dshb-chip',
    wide ? '' : 'dshb-chip-rail',
    tint === 'normal' ? '' : `dshb-${tint}`,
    balance.state === 'ok' && balance.stale ? 'dshb-stale' : '',
    balance.state === 'unavailable' ? 'dshb-stale' : '',
  ].filter(part => part.length > 0).join(' ')

  return (
    <div className="dshb-anchor" onMouseLeave={() => { setOpen(false) }}>
      {open && wide ? <Popover balance={balance} spend={spend} t={t} /> : null}
      <button
        type="button"
        className={classes}
        title={title}
        onMouseEnter={() => { setOpen(true) }}
        onClick={() => { refresh(true) }}
      >
        <span className="dshb-num">{label}</span>
      </button>
    </div>
  )
}

/**
 * The registered slot component.
 * @param props - composed slot props.
 * @returns the chip, or nothing while unconfigured.
 */
export function FooterChip(props: FooterChipProps): ReactNode {
  return (
    <Guard>
      <ChipBody {...props} />
    </Guard>
  )
}
