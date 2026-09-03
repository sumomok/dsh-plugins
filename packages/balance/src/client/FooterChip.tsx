/**
 * The sidebar-footer chip: the followed provider's remaining balance, and a
 * popover breaking down that balance, an explicit provider picker, and this
 * installation's spend.
 *
 * Nothing renders while the followed provider is unconfigured — no key, or an
 * endpoint this plugin may not talk to. An unconfigured deployment should see
 * the sidebar it had before installing this plugin, not a placeholder
 * explaining that a feature it did not ask for is not working. The picker
 * inside the popover is a separate, explicit choice: selecting an
 * unsupported provider there shows why, rather than hiding, because the user
 * asked to see it.
 *
 * The chip is one ordinary item in `sidebar.footer.action`, a slot other
 * plugins may also occupy: no absolute positioning, no assumption that it
 * owns the row's edge, and a measured degrade — the full "Provider ¥12.34"
 * form drops the provider name to "¥12.34" once the row is too crowded for
 * it, rather than wrapping or overflowing a sibling's box.
 *
 * @module @sumomok/dsh-balance/client/FooterChip
 */

import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type ChangeEvent, type CSSProperties, type MouseEventHandler, type ReactNode, type RefObject,
} from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { BalanceView, ProviderOption, QuotaWindow, SpendTotals, SpendView } from '../types.ts'
import { fill, formatAmount, formatDate, formatResetAt, formatSpend, formatTime, remainingPercent, tintOf, windowSpan } from './format.ts'
import { Guard } from './Guard.tsx'
import type { BalanceState } from './store.ts'
import { topUpLinkFor } from './top-up-links.ts'

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
  /** Read both faces again for the followed provider, bypassing the host's refresh window. */
  refresh: (force: boolean) => void
  /** Change the popover's own provider selection; `undefined` reverts to following the session. */
  selectProvider: (provider: string | undefined) => void
}

/** Style for the off-screen span {@link useNarrow} measures, so it never reflows visible content. */
const MEASURE_STYLE: CSSProperties = {
  position: 'fixed', top: 0, left: -9_999, visibility: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none',
}

/** Horizontal padding `.dshb-chip` carries (styles.ts), subtracted from the measured box's content width. */
const CHIP_HORIZONTAL_PADDING = 16

/** One labelled amount inside the popover. */
function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="dshb-pop-row">
      <span className="dshb-muted">{label}</span>
      <span className="dshb-num">{value}</span>
    </div>
  )
}

/**
 * The label a quota window shows: the plan's weekly allowance, a rolling
 * span named by its length, or the raw key for one the UI cannot read.
 * @param key - the window key.
 * @param t - the translate seat.
 * @param short - the chip's compact form (`5小时` / `5h`) rather than the popover's.
 * @returns the label.
 */
function quotaWindowLabel(key: string, t: TranslateNS<'balance'>, short = false): string {
  if (key === 'weekly') return t(short ? 'quota.window.short.weekly' : 'quota.window.weekly')
  const span = windowSpan(key)
  if (span === null) return key
  return fill(t(short ? `quota.window.short.${span.unit}` : `quota.window.${span.unit}`), { n: String(span.n) })
}

/** One quota window's value line: what is left, and its reset time when the provider gave one. */
function quotaRowValue(window: QuotaWindow, t: TranslateNS<'balance'>): string {
  const left = fill(t('quota.left'), { percent: String(remainingPercent(window.usedPercent)) })
  if (window.resetsAt === null) return left
  return `${left} · ${fill(t('quota.resets'), { time: formatResetAt(window.resetsAt, Date.now()) })}`
}

/**
 * The one figure the chip shows for a read: a money amount, what is left of
 * each quota window (`剩余 5小时 63% · 7天 88%`), or a dash.
 * @param balance - the followed provider's read.
 * @param t - the translate seat.
 * @returns the chip text after the provider name.
 */
function chipAmount(balance: BalanceView | undefined, t: TranslateNS<'balance'>): string {
  if (balance?.state === 'ok') return formatAmount(balance.currency, balance.total) ?? balance.total
  if (balance?.state === 'quota') {
    if (balance.windows.length === 0) return '—'
    const parts = balance.windows.map(window =>
      `${quotaWindowLabel(window.key, t, true)} ${String(remainingPercent(window.usedPercent))}%`)
    return `${t('quota.chipLeft')} ${parts.join(' · ')}`
  }
  return '—'
}

/**
 * One period's line. A provider metered by subscription quota has no money to
 * show: its tokens are "within plan". A pay-as-you-go provider shows its cost,
 * with the tokens no price table covered as an unpriced tail — or, when
 * nothing was priced at all, the tokens alone.
 */
function PeriodRow(
  { label, totals, currency, quota, t }: {
    label: string
    totals: SpendTotals
    currency: string
    /** True when the provider these totals are for meters a quota rather than money. */
    quota: boolean
    t: TranslateNS<'balance'>
  },
): ReactNode {
  const tokens = String(totals.unpricedTokens)
  if (quota) return <Row label={label} value={fill(t('spend.withinPlan'), { tokens })} />
  const priced = totals.requests > 0 && totals.cost > 0
  if (!priced && totals.unpricedTokens > 0) return <Row label={label} value={fill(t('spend.unpriced'), { tokens })} />
  const unpriced = totals.unpricedTokens > 0 ? ` · ${fill(t('spend.unpriced'), { tokens })}` : ''
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

/**
 * The provider picker at the top of the popover, over the roster the store
 * already filtered to providers this deployment can show a balance for
 * ({@link file://./store.ts}'s `providers` state). The caller ({@link Popover})
 * renders this only once that roster holds at least two options.
 */
function ProviderPicker(
  { providers, selected, onSelect, t }: {
    providers: readonly ProviderOption[]
    selected: string
    onSelect: (provider: string) => void
    t: TranslateNS<'balance'>
  },
): ReactNode {
  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => { onSelect(event.target.value) }
  return (
    <div className="dshb-provider-picker">
      <span className="dshb-muted">{t('provider.label')}</span>
      <select className="dshb-provider-select" value={selected} onChange={onChange}>
        {providers.map(option => <option key={option.id} value={option.id}>{option.displayName}</option>)}
      </select>
    </div>
  )
}

/**
 * The top-up control for whichever provider the picker names, for the
 * providers {@link file://./top-up-links.ts} has a page for.
 *
 * `window.open` rather than an anchor: the desktop shell's window-open
 * handler routes a new window to the system browser, while an `href` inside
 * the app frame is an in-app navigation away from the running session.
 */
function TopUpButton({ provider, t }: { provider: string; t: TranslateNS<'balance'> }): ReactNode {
  const url = topUpLinkFor(provider)
  if (url === undefined) return null
  return (
    <button
      type="button"
      className="dshb-pop-btn"
      onClick={() => { window.open(url, '_blank', 'noopener,noreferrer') }}
    >
      {t('topUp')}
    </button>
  )
}

/** The balance section for whichever provider the picker names, previewing or unsupported. */
function BalanceSection(
  { balance, loading, t }: { balance: BalanceView | undefined; loading: boolean; t: TranslateNS<'balance'> },
): ReactNode {
  if (loading || balance === undefined) return <div className="dshb-muted">{t('loading')}</div>
  if (balance.state === 'unconfigured') return <div className="dshb-muted">{t('provider.unsupported')}</div>
  if (balance.state === 'unavailable') {
    return (
      <>
        <div className="dshb-pop-head">{t('unavailable')}</div>
        <div className="dshb-muted">{t(`reason.${balance.reason}`)}</div>
      </>
    )
  }
  if (balance.state === 'quota') {
    return (
      <>
        <div className="dshb-pop-head">{t('quota.title')}</div>
        {balance.windows.map(window => (
          <Row key={window.key} label={quotaWindowLabel(window.key, t)} value={quotaRowValue(window, t)} />
        ))}
        <div className="dshb-pop-foot">
          {fill(t('updated'), { time: formatTime(balance.fetchedAt) })}
          {balance.stale ? ` · ${t('stale')}` : ''}
          {balance.isAvailable ? '' : ` · ${t('suspended')}`}
        </div>
      </>
    )
  }
  return (
    <>
      <div className="dshb-pop-head">{t('title')}</div>
      <Row label={t('total')} value={formatAmount(balance.currency, balance.total) ?? balance.total} />
      {balance.granted === undefined
        ? null
        : <Row label={t('granted')} value={formatAmount(balance.currency, balance.granted) ?? balance.granted} />}
      {balance.toppedUp === undefined
        ? null
        : <Row label={t('toppedUp')} value={formatAmount(balance.currency, balance.toppedUp) ?? balance.toppedUp} />}
      <div className="dshb-pop-foot">
        {fill(t('updated'), { time: formatTime(balance.fetchedAt) })}
        {balance.stale ? ` · ${t('stale')}` : ''}
        {balance.isAvailable ? '' : ` · ${t('suspended')}`}
      </div>
    </>
  )
}

/** The popover body: provider picker, that provider's balance, spend, and a refresh control. */
function Popover(
  {
    providers, selectedProvider, onSelectProvider, balance, previewLoading, spend, t, panelRef, style,
    onRefresh, onMouseEnter, onMouseLeave,
  }: {
    providers: readonly ProviderOption[]
    selectedProvider: string
    onSelectProvider: (provider: string) => void
    balance: BalanceView | undefined
    previewLoading: boolean
    spend: SpendView | undefined
    t: TranslateNS<'balance'>
    /** Measured for {@link usePopoverPosition}, so the clamp uses the panel's real size. */
    panelRef: RefObject<HTMLDivElement>
    /** Viewport-clamped `position:fixed` coordinates; `undefined` before the first measurement. */
    style: CSSProperties | undefined
    /** Re-read both faces for the followed provider, bypassing the host's refresh window. */
    onRefresh: () => void
    /** Cancels any pending close timer — the popover sits in a `position:fixed` gap from the chip. */
    onMouseEnter: MouseEventHandler
    /** Starts the close grace period. */
    onMouseLeave: MouseEventHandler
  },
): ReactNode {
  return (
    <div ref={panelRef} className="dshb-pop" style={style} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {/* Nothing to pick with fewer than two options — the followed provider
          is always one of them, so this is "no other configured provider
          exists" rather than an empty picker. */}
      {providers.length >= 2
        ? <ProviderPicker providers={providers} selected={selectedProvider} onSelect={onSelectProvider} t={t} />
        : null}
      <BalanceSection balance={balance} loading={previewLoading} t={t} />
      {spend === undefined ? null : (
        <>
          <hr className="dshb-pop-sep" />
          <div className="dshb-pop-head">{t('spend.title')}</div>
          <PeriodRow label={t('spend.today')} totals={spend.today} currency={spend.currency} quota={balance?.state === 'quota'} t={t} />
          <PeriodRow label={t('spend.month')} totals={spend.month} currency={spend.currency} quota={balance?.state === 'quota'} t={t} />
          <PeriodRow label={t('spend.allTime')} totals={spend.allTime} currency={spend.currency} quota={balance?.state === 'quota'} t={t} />
          {scheduleShares(spend.allTime).map(share => (
            <Row key={share.name} label={share.name} value={`${String(share.percent)}%`} />
          ))}
          <div className="dshb-pop-foot">
            {spend.since === null
              ? t('spend.sinceEmpty')
              : fill(t('spend.since'), { date: formatDate(spend.since) })}
            {balance?.state === 'quota' ? '' : ` · ${fill(t('spend.pricesAsOf'), { currency: spend.currency, date: spend.pricesAsOf })}`}
          </div>
        </>
      )}
      <div className="dshb-pop-actions">
        <TopUpButton provider={selectedProvider} t={t} />
        <button type="button" className="dshb-pop-btn" onClick={onRefresh}>{t('refresh')}</button>
      </div>
    </div>
  )
}

/**
 * Measure the full "Provider ¥12.34" text against the chip's own allotted
 * width, switching to the amount alone once the full form would not fit.
 * Measures an off-screen span carrying the full text — never the currently
 * rendered (possibly already narrowed) label — so a row that grows back can
 * be measured back into the full form too.
 * @param buttonRef - the visible chip button, whose `clientWidth` is the available box.
 * @param measureRef - an off-screen span always carrying the full text, so
 * the measurement is never against an already-narrowed label.
 * @param fullText - the full "Provider ¥amount" form.
 * @returns whether the narrow (amount-only) form should render.
 */
function useNarrow(
  buttonRef: RefObject<HTMLButtonElement>,
  measureRef: RefObject<HTMLSpanElement>,
  fullText: string,
): boolean {
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const button = buttonRef.current
    const measure = measureRef.current
    if (button === null || measure === null) return
    const check = (): void => {
      setNarrow(measure.scrollWidth > button.clientWidth - CHIP_HORIZONTAL_PADDING)
    }
    check()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(check)
    observer.observe(button)
    return () => { observer.disconnect() }
    // Re-measures whenever the text itself changes, not only on resize.
  }, [fullText])
  return narrow
}

/** Margin kept between the popover and every viewport edge. */
const POPOVER_MARGIN = 8

/** Gap kept between the chip's top edge and the popover's bottom edge. */
const POPOVER_GAP = 6

/**
 * Delay before a mouse leave actually closes the unpinned popover. The
 * popover is `position:fixed`, positioned in a separate box from the chip
 * (see {@link usePopoverPosition}), so moving the pointer from one to the
 * other crosses a gap with no element under it — an immediate close on
 * `mouseleave` would make the popover unreachable.
 */
const POPOVER_CLOSE_GRACE_MS = 200

/**
 * Position the popover as `position:fixed`, clamped inside the viewport.
 *
 * The chip is an ordinary flex item that may sit anywhere in a row other
 * plugins share — including flush against the sidebar's own edge — so a
 * CSS-only anchor (`right:0` on a `position:relative` ancestor) can push the
 * panel half off-screen when the chip itself is narrow and near that edge.
 * Opens upward from the chip (`top = anchor.top - panelHeight - gap`), unlike
 * `@deepseek-ai/dsh-client-ui-primitives`'s `useAnchoredPosition`, which
 * anchors below — this chip sits at the sidebar foot, where "below" would
 * leave the viewport.
 * @param anchorRef - the chip button the panel is placed from.
 * @param panelRef - the panel itself, measured so the clamp uses its real size.
 * @param open - whether the panel is mounted and should track the anchor.
 * @returns `position:fixed` coordinates, or `undefined` before the first measurement.
 */
function usePopoverPosition(
  anchorRef: RefObject<HTMLElement>,
  panelRef: RefObject<HTMLElement>,
  open: boolean,
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined)
  useLayoutEffect(() => {
    if (!open) {
      setStyle(undefined)
      return
    }
    const place = (): void => {
      /* v8 ignore start -- geometry read from real layout: jsdom reports zero
         offset sizes, so the positive-size clamp arms are exercised by
         browser scenarios (the E2E screenshots) rather than unit tests. */
      const anchor = anchorRef.current
      const panel = panelRef.current
      if (anchor === null) return
      const rect = anchor.getBoundingClientRect()
      const width = panel?.offsetWidth ?? 0
      const height = panel?.offsetHeight ?? 0
      let left = rect.right - width
      if (width > 0) {
        left = Math.min(Math.max(left, POPOVER_MARGIN), window.innerWidth - width - POPOVER_MARGIN)
      }
      let top = rect.top - height - POPOVER_GAP
      if (height > 0) top = Math.max(top, POPOVER_MARGIN)
      setStyle({ position: 'fixed', left, top })
      /* v8 ignore stop */
    }
    place()
    const panel = panelRef.current
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && panel !== null) {
      observer = new ResizeObserver(place)
      observer.observe(panel)
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef, panelRef])
  return style
}

/**
 * The chip body, without the render guard.
 *
 * Every hook runs before the unconfigured-followed-provider guard below, so
 * the hook sequence stays identical across a poll tick that flips the
 * followed provider between configured and not.
 */
function ChipBody({ wide, t, useBalance, refresh, selectProvider }: FooterChipProps): ReactNode {
  const balance = useBalance(state => state.balance)
  const spend = useBalance(state => state.spend)
  const followedProvider = useBalance(state => state.followedProvider)
  const providers = useBalance(state => state.providers)
  const selectedProvider = useBalance(state => state.selectedProvider)
  const preview = useBalance(state => state.preview)
  const previewSpend = useBalance(state => state.previewSpend)
  const previewLoading = useBalance(state => state.previewLoading)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectProviderRef = useRef(selectProvider)
  selectProviderRef.current = selectProvider

  const clearCloseTimer = useCallback((): void => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  // Entering the anchor or the popover always cancels a pending close,
  // pinned or not — this also re-opens a popover a stray unmount raced shut.
  const openNow = useCallback((): void => {
    clearCloseTimer()
    setOpen(true)
  }, [clearCloseTimer])

  // Leaving the anchor or the popover starts the grace-period close, unless
  // pinned (never auto-closes) or the popover holds focus right now (the
  // native `<select>` list still counts as focused while its OS-level
  // options are open, even though it fires its own `mouseleave`). The
  // focus check re-runs when the timer actually fires, not here, so a
  // `mouseleave` immediately followed by a focus change is still covered.
  const scheduleClose = useCallback((): void => {
    if (pinnedRef.current) return
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      const panel = panelRef.current
      const active = document.activeElement
      if (panel !== null && active !== null && panel.contains(active)) return
      setOpen(false)
    }, POPOVER_CLOSE_GRACE_MS)
  }, [clearCloseTimer])

  const togglePin = useCallback((): void => {
    clearCloseTimer()
    if (pinnedRef.current) {
      setPinned(false)
      setOpen(false)
    } else {
      setPinned(true)
      setOpen(true)
    }
  }, [clearCloseTimer])

  useEffect(() => clearCloseTimer, [clearCloseTimer])

  // Escape and an outside click both unpin and close, regardless of hover —
  // only armed while the popover is actually open.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      clearCloseTimer()
      setPinned(false)
      setOpen(false)
    }
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (containerRef.current?.contains(target) === true) return
      if (panelRef.current?.contains(target) === true) return
      clearCloseTimer()
      setPinned(false)
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open, clearCloseTimer])

  const popoverOpen = open && wide

  // Every opening starts the picker on the provider the session follows: a
  // choice made in it holds a different provider's balance and spend on
  // screen for as long as that popover stays open, and is dropped with it,
  // so the next opening reads the session again rather than a comparison the
  // user made a while ago. Runs before paint so the reset is never a visible
  // flash of the previous choice, and is keyed on the popover's own
  // visibility alone — re-running on a fresh `selectProvider` identity would
  // throw away the choice the user just made.
  useLayoutEffect(() => {
    if (popoverOpen) selectProviderRef.current(undefined)
  }, [popoverOpen])

  const providerName = providers.find(option => option.id === followedProvider)?.displayName ?? followedProvider
  const amount = chipAmount(balance, t)
  const fullText = `${providerName} ${amount}`
  const narrow = useNarrow(buttonRef, measureRef, fullText)
  const popoverStyle = usePopoverPosition(buttonRef, panelRef, popoverOpen)

  // Nothing to show, and nothing to explain: the deployment has no key for
  // the followed provider, or points at an endpoint this plugin will not
  // talk to. The explicit picker inside the popover is a different case —
  // see this module's doc.
  if (balance === undefined || balance.state === 'unconfigured') return null
  if (spend !== undefined && !spend.ui.footer) return null

  const tint = balance.state === 'ok' && spend !== undefined ? tintOf(balance, spend.ui) : 'normal'
  const title = balance.state === 'unavailable'
    ? `${providerName} · ${t('unavailable')} · ${t(`reason.${balance.reason}`)}`
    : `${fullText} · ${t(pinned ? 'clickToUnpin' : 'clickToPin')}`
  const classes = [
    'dshb-chip',
    wide ? '' : 'dshb-chip-rail',
    tint === 'normal' ? '' : `dshb-${tint}`,
    (balance.state === 'ok' || balance.state === 'quota') && balance.stale ? 'dshb-stale' : '',
    balance.state === 'unavailable' ? 'dshb-stale' : '',
  ].filter(part => part.length > 0).join(' ')

  const effectiveSelection = selectedProvider ?? followedProvider
  const displayed = selectedProvider === undefined ? balance : preview
  const displayedLoading = selectedProvider !== undefined && selectedProvider !== followedProvider && previewLoading

  return (
    <div ref={containerRef} className="dshb-anchor" onMouseEnter={openNow} onMouseLeave={scheduleClose}>
      {popoverOpen ? (
        <Popover
          panelRef={panelRef}
          style={popoverStyle}
          providers={providers}
          selectedProvider={effectiveSelection}
          onSelectProvider={selectProvider}
          balance={displayed}
          previewLoading={displayedLoading}
          spend={selectedProvider === undefined ? spend : previewSpend}
          t={t}
          onRefresh={() => { refresh(true) }}
          onMouseEnter={openNow}
          onMouseLeave={scheduleClose}
        />
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        className={classes}
        title={title}
        onClick={togglePin}
      >
        {wide && !narrow ? <span className="dshb-chip-provider">{providerName}</span> : null}
        <span className="dshb-chip-amount">{amount}</span>
        <span ref={measureRef} style={MEASURE_STYLE} aria-hidden="true">{fullText}</span>
      </button>
    </div>
  )
}

/**
 * The registered slot component.
 * @param props - composed slot props.
 * @returns the chip, or nothing while the followed provider is unconfigured.
 */
export function FooterChip(props: FooterChipProps): ReactNode {
  return (
    <Guard>
      <ChipBody {...props} />
    </Guard>
  )
}
