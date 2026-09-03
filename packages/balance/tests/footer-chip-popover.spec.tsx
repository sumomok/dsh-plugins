// @vitest-environment jsdom

// Interactive popover reachability (Defect B): unlike footer-chip.spec.tsx's
// SSR-rendered sibling-tolerance checks, these exercise real hover timing,
// click-to-pin, Escape/outside-click, and focus, so they mount through jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore, type ReactNode } from 'react'
import { FooterChip, type FooterChipProps } from '../src/client/FooterChip.tsx'
import { createBalanceStore, type BalanceState, type BalanceStore } from '../src/client/store.ts'
import { en, type BalanceKey } from '../src/client/locales.ts'
import type { BalanceView, ProviderOption, SpendView } from '../src/types.ts'

function translateFrom(dict: Record<BalanceKey, string>): FooterChipProps['t'] {
  return key => dict[key]
}

const PROVIDERS: readonly ProviderOption[] = [
  { id: 'deepseek-official', displayName: 'DeepSeek' },
  { id: 'mock-gateway', displayName: 'Mock Gateway' },
]

const BALANCE: Extract<BalanceView, { state: 'ok' }> = {
  state: 'ok',
  currency: 'CNY',
  total: '12.34',
  granted: '0',
  toppedUp: '12.34',
  isAvailable: true,
  fetchedAt: 1_000,
  stale: false,
}

function stateOf(overrides: Partial<BalanceState> = {}): BalanceState {
  return {
    followedProvider: 'deepseek-official',
    balance: BALANCE,
    spend: undefined,
    loading: false,
    providers: PROVIDERS,
    selectedProvider: undefined,
    preview: undefined,
    previewSpend: undefined,
    previewLoading: false,
    ...overrides,
  }
}

function chipProps(overrides: Partial<FooterChipProps> = {}): FooterChipProps {
  return {
    wide: true,
    t: translateFrom(en),
    useBalance: selector => selector(stateOf()),
    refresh: () => undefined,
    selectProvider: () => undefined,
    ...overrides,
  }
}

/** Mounts the chip and hands back the anchor, chip button, and a live popover lookup. */
function renderChip(overrides: Partial<FooterChipProps> = {}) {
  const view = render(<FooterChip {...chipProps(overrides)} />)
  const anchor = view.container.querySelector('.dshb-anchor')
  const chip = view.container.querySelector('button.dshb-chip')
  if (anchor === null || chip === null) throw new Error('chip did not render')
  return {
    view,
    anchor: anchor as HTMLElement,
    chip: chip as HTMLElement,
    popover: () => view.container.querySelector('.dshb-pop'),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('FooterChip — popover reachability', () => {
  it('starts a close grace period on mouse leave, cancelled by entering the popover before it elapses', () => {
    const { anchor, popover } = renderChip()
    act(() => { fireEvent.mouseEnter(anchor) })
    expect(popover()).not.toBeNull()

    act(() => { fireEvent.mouseLeave(anchor) })
    act(() => { vi.advanceTimersByTime(100) })
    expect(popover()).not.toBeNull() // still mid-grace-period

    const panel = popover()
    if (panel === null) throw new Error('popover missing')
    act(() => { fireEvent.mouseEnter(panel) })
    act(() => { vi.advanceTimersByTime(200) })
    expect(popover()).not.toBeNull() // entering the popover cancelled the close
  })

  it('closes once the grace period elapses with neither the anchor nor the popover re-entered', () => {
    const { anchor, popover } = renderChip()
    act(() => { fireEvent.mouseEnter(anchor) })
    act(() => { fireEvent.mouseLeave(anchor) })
    act(() => { vi.advanceTimersByTime(200) })
    expect(popover()).toBeNull()
  })

  it('pins the popover open on click, surviving a mouse leave that would otherwise close it', () => {
    const { chip, anchor, popover } = renderChip()
    act(() => { fireEvent.click(chip) })
    expect(popover()).not.toBeNull()
    act(() => { fireEvent.mouseLeave(anchor) })
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(popover()).not.toBeNull()
  })

  it('unpins and closes on Escape', () => {
    const { chip, popover } = renderChip()
    act(() => { fireEvent.click(chip) })
    expect(popover()).not.toBeNull()
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(popover()).toBeNull()
  })

  it('unpins and closes on a click outside the anchor and popover', () => {
    const { chip, popover } = renderChip()
    act(() => { fireEvent.click(chip) })
    expect(popover()).not.toBeNull()
    act(() => { fireEvent.mouseDown(document.body) })
    expect(popover()).toBeNull()
  })

  it('closes immediately when the chip is clicked again while pinned', () => {
    const { chip, popover } = renderChip()
    act(() => { fireEvent.click(chip) })
    expect(popover()).not.toBeNull()
    act(() => { fireEvent.click(chip) })
    expect(popover()).toBeNull()
  })

  it('never closes on mouse leave while an element inside the popover has focus', () => {
    const { anchor, popover } = renderChip()
    act(() => { fireEvent.mouseEnter(anchor) })
    const panel = popover()
    if (panel === null) throw new Error('popover missing')
    const select = panel.querySelector('select.dshb-provider-select')
    if (select === null) throw new Error('provider select missing')
    // A real focus move (not fireEvent.focus, which never updates
    // document.activeElement) — mirrors the native <select> keeping focus
    // while its OS-level options list is open.
    act(() => { (select as HTMLSelectElement).focus() })
    act(() => { fireEvent.mouseLeave(anchor) })
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(popover()).not.toBeNull()
  })

  it('hides the provider picker row with fewer than two roster options, keeping the rest of the popover', () => {
    const { anchor, popover } = renderChip({
      useBalance: selector => selector(stateOf({ providers: [PROVIDERS[0]!] })),
    })
    act(() => { fireEvent.mouseEnter(anchor) })
    const panel = popover()
    if (panel === null) throw new Error('popover missing')
    expect(panel.querySelector('select.dshb-provider-select')).toBeNull()
    expect(panel.querySelector('.dshb-pop-head')).not.toBeNull()
  })

  it('shows the provider picker row once the roster holds two or more options', () => {
    const { anchor, popover } = renderChip()
    act(() => { fireEvent.mouseEnter(anchor) })
    const panel = popover()
    if (panel === null) throw new Error('popover missing')
    expect(panel.querySelector('select.dshb-provider-select')).not.toBeNull()
  })

  it('refreshes from the popover footer button, never from the chip click', () => {
    const refresh = vi.fn()
    const { chip, popover } = renderChip({ refresh })
    act(() => { fireEvent.click(chip) })
    expect(refresh).not.toHaveBeenCalled()

    const panel = popover()
    if (panel === null) throw new Error('popover missing')
    // The footer's two controls share one class; the label tells them apart.
    const refreshButton = [...panel.querySelectorAll('.dshb-pop-actions button')]
      .find(button => button.textContent === en.refresh)
    if (refreshButton === undefined) throw new Error('refresh button missing')
    act(() => { fireEvent.click(refreshButton) })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith(true)
    // The popover stays open — refreshing is not a close gesture.
    expect(popover()).not.toBeNull()
  })
})

const KIMI_PROVIDERS: readonly ProviderOption[] = [{ id: 'kimi-coding', displayName: 'Kimi For Coding' }]

const QUOTA: Extract<BalanceView, { state: 'quota' }> = {
  state: 'quota',
  windows: [
    { key: 'weekly', usedPercent: 42, resetsAt: 1_800_000_000_000 },
    { key: '5h', usedPercent: 5, resetsAt: null },
  ],
  isAvailable: true,
  fetchedAt: 1_000,
  stale: false,
}

/** Chip props driven by a quota read for a followed kimi-coding provider. */
function quotaProps(quota: Extract<BalanceView, { state: 'quota' }> = QUOTA): Partial<FooterChipProps> {
  return { useBalance: selector => selector(stateOf({ balance: quota, followedProvider: 'kimi-coding', providers: KIMI_PROVIDERS })) }
}

/** A quota provider's spend: nothing priced, every token within the plan. */
const KIMI_SPEND: SpendView = {
  provider: 'kimi-coding',
  today: { cost: 0, bySchedule: {}, requests: 2, unpricedTokens: 1_200 },
  month: { cost: 0, bySchedule: {}, requests: 9, unpricedTokens: 8_800 },
  allTime: { cost: 0, bySchedule: {}, requests: 9, unpricedTokens: 8_800 },
  since: 1_000,
  currency: 'CNY',
  pricesAsOf: '2026-08-23',
  timezone: 'UTC',
  ui: { footer: true, sessionSpend: true, lowBalance: 10, criticalBalance: 1, refreshMs: 60_000 },
}

describe('FooterChip — quota provider', () => {
  it('shows what is left of every window on the closed chip, labelled, not a money amount', () => {
    const { chip } = renderChip(quotaProps())
    // 42% used of the weekly window, 5% of the 5-hour one: the chip says what remains.
    expect(chip.textContent).toContain(`${en['quota.chipLeft']} 7d 58% · 5h 95%`)
    expect(chip.textContent).not.toContain('42%')
    expect(chip.textContent).not.toContain('¥')
  })

  it('lists every window in the popover as remaining, naming the weekly and rolling windows by their span', () => {
    const { anchor, popover } = renderChip(quotaProps())
    act(() => { fireEvent.mouseEnter(anchor) })
    const panel = popover()
    if (panel === null) throw new Error('popover missing')
    const text = panel.textContent ?? ''
    expect(text).toContain(en['quota.title'])
    expect(text).toContain(en['quota.window.weekly'])
    expect(text).toContain('5-hour window')
    expect(text).toContain('58% left')
    expect(text).toContain('95% left')
    expect(text).not.toContain('Used')
    // The weekly window names a reset time; the rolling window here does not.
    expect(text).toContain('resets')
  })

  it('shows a quota provider\'s spend as tokens within the plan, never as money', () => {
    const { anchor, popover } = renderChip({
      useBalance: selector => selector(stateOf({
        balance: QUOTA, spend: KIMI_SPEND, previewSpend: KIMI_SPEND, followedProvider: 'kimi-coding', providers: KIMI_PROVIDERS,
      })),
    })
    act(() => { fireEvent.mouseEnter(anchor) })
    const text = popover()?.textContent ?? ''
    expect(text).toContain('1200 tok · within plan')
    expect(text).toContain('8800 tok · within plan')
    expect(text).not.toContain('¥')
    expect(text).not.toContain('unpriced')
    expect(text).not.toContain('Prices:')
  })

  it('marks the chip stale and shows the suspended note when a fully-consumed window reports the account cannot serve', () => {
    const exhausted: Extract<BalanceView, { state: 'quota' }> = {
      ...QUOTA, windows: [{ key: 'weekly', usedPercent: 100, resetsAt: null }], isAvailable: false, stale: true,
    }
    const { chip, anchor, popover } = renderChip(quotaProps(exhausted))
    expect(chip.className).toContain('dshb-stale')
    act(() => { fireEvent.mouseEnter(anchor) })
    expect(popover()?.textContent).toContain(en.suspended)
    expect(popover()?.textContent).toContain(en.stale)
  })
})

const THREE_PROVIDERS: readonly ProviderOption[] = [
  { id: 'deepseek-official', displayName: 'DeepSeek' },
  { id: 'mock-gateway', displayName: 'Mock Gateway' },
  { id: 'other-gateway', displayName: 'Other Gateway' },
]

/** One distinguishable total per provider, so the popover names which read it is showing. */
const TOTALS: Record<string, string> = {
  'deepseek-official': '12.34',
  'mock-gateway': '56.78',
  'other-gateway': '90.12',
}

const FOOTER_SPEND: SpendView = {
  provider: 'deepseek-official',
  today: { cost: 0, bySchedule: {}, requests: 0, unpricedTokens: 0 },
  month: { cost: 0, bySchedule: {}, requests: 0, unpricedTokens: 0 },
  allTime: { cost: 0, bySchedule: {}, requests: 0, unpricedTokens: 0 },
  since: 1_000,
  currency: 'CNY',
  pricesAsOf: '2026-08-23',
  timezone: 'UTC',
  ui: { footer: true, sessionSpend: true, lowBalance: 1, criticalBalance: 0, refreshMs: 60_000 },
}

/** The chip over a real store, wired the way `client/index.ts` wires it — a fresh `selectProvider` identity every render included. */
function StoreChip({ store }: { store: BalanceStore }): ReactNode {
  const useBalance = <S,>(selector: (state: BalanceState) => S): S =>
    useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
  return (
    <FooterChip
      wide
      t={translateFrom(en)}
      useBalance={useBalance}
      refresh={() => undefined}
      selectProvider={(provider) => { store.selectProvider(provider) }}
    />
  )
}

/** Lets the store's already-resolved reads settle; fake timers rule out a real tick. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let step = 0; step < 5; step += 1) await Promise.resolve()
  })
}

/** Mounts {@link StoreChip} over a store already refreshed for `followed`. */
async function renderStoreChip(followed = 'deepseek-official') {
  const store = createBalanceStore({
    get: async (provider) => {
      const total = TOTALS[provider ?? ''] ?? '0.00'
      return { ...BALANCE, total, toppedUp: total }
    },
    spend: async provider => ({ ...FOOTER_SPEND, provider }),
    providers: async () => [...THREE_PROVIDERS],
  }, () => undefined)
  await store.refresh(followed)
  const view = render(<StoreChip store={store} />)
  const anchor = view.container.querySelector('.dshb-anchor')
  if (anchor === null) throw new Error('chip did not render')
  const picker = (): HTMLSelectElement => {
    const select = view.container.querySelector('select.dshb-provider-select')
    if (select === null) throw new Error('provider picker missing')
    return select as HTMLSelectElement
  }
  const pick = async (provider: string): Promise<void> => {
    act(() => { fireEvent.change(picker(), { target: { value: provider } }) })
    await settle()
  }
  return {
    store,
    anchor: anchor as HTMLElement,
    popover: () => view.container.querySelector('.dshb-pop'),
    text: () => view.container.querySelector('.dshb-pop')?.textContent ?? '',
    picker,
    pick,
    open: () => { act(() => { fireEvent.mouseEnter(anchor) }) },
    close: () => {
      act(() => { fireEvent.mouseLeave(anchor) })
      act(() => { vi.advanceTimersByTime(200) })
    },
  }
}

describe('FooterChip — the picker starts from the followed provider', () => {
  it('shows the picked provider\'s balance while the popover stays open', async () => {
    const chip = await renderStoreChip()
    chip.open()
    expect(chip.text()).toContain('¥12.34')

    await chip.pick('mock-gateway')
    expect(chip.picker().value).toBe('mock-gateway')
    expect(chip.text()).toContain('¥56.78')
    expect(chip.text()).not.toContain('¥12.34')
    // The popover is still the same one: switching providers is not a close gesture.
    expect(chip.popover()).not.toBeNull()
  })

  it('drops a previous opening\'s pick, starting again on the followed provider', async () => {
    const chip = await renderStoreChip()
    chip.open()
    await chip.pick('mock-gateway')
    chip.close()
    expect(chip.popover()).toBeNull()

    chip.open()
    expect(chip.picker().value).toBe('deepseek-official')
    expect(chip.text()).toContain('¥12.34')
  })

  it('drops a pinned opening\'s pick too, whichever gesture opens the next one', async () => {
    const chip = await renderStoreChip()
    // Click pins the popover open; a second click closes it.
    const pin = (): void => { act(() => { fireEvent.click(chip.anchor.querySelector('button.dshb-chip') as HTMLElement) }) }
    pin()
    await chip.pick('other-gateway')
    expect(chip.picker().value).toBe('other-gateway')
    pin()
    expect(chip.popover()).toBeNull()

    pin()
    expect(chip.picker().value).toBe('deepseek-official')
  })

  it('starts the next opening on the provider the session moved to while the popover was open', async () => {
    const chip = await renderStoreChip()
    chip.open()
    await chip.pick('other-gateway')

    // The session switches model mid-hover: the followed provider becomes
    // Mock Gateway, while the open popover keeps the comparison on screen.
    await act(async () => { await chip.store.refresh('mock-gateway', true) })
    expect(chip.picker().value).toBe('other-gateway')
    expect(chip.text()).toContain('¥90.12')

    chip.close()
    chip.open()
    expect(chip.picker().value).toBe('mock-gateway')
    expect(chip.text()).toContain('¥56.78')
  })
})

describe('FooterChip — the top-up button', () => {
  /** The popover footer's top-up control, told apart from Refresh by its label. */
  const topUp = (panel: Element | null): HTMLElement | undefined =>
    [...(panel?.querySelectorAll('.dshb-pop-actions button') ?? [])]
      .find(button => button.textContent === en.topUp) as HTMLElement | undefined

  it('opens the picked provider\'s own page in a new window, never in this one', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { anchor, popover } = renderChip()
    act(() => { fireEvent.mouseEnter(anchor) })

    const button = topUp(popover())
    expect(button).toBeDefined()
    act(() => { fireEvent.click(button as HTMLElement) })
    expect(open).toHaveBeenCalledWith('https://platform.deepseek.com/top_up', '_blank', 'noopener,noreferrer')
  })

  it('renders no button for a provider the table does not name, leaving Refresh alone', () => {
    const { anchor, popover } = renderChip({
      useBalance: selector => selector(stateOf({ followedProvider: 'mock-gateway' })),
    })
    act(() => { fireEvent.mouseEnter(anchor) })

    const panel = popover()
    expect(topUp(panel)).toBeUndefined()
    expect(panel?.querySelectorAll('.dshb-pop-actions button')).toHaveLength(1)
    expect(panel?.querySelector('.dshb-pop-actions button')?.textContent).toBe(en.refresh)
  })

  it('follows the picker rather than the followed provider', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { anchor, popover } = renderChip({
      useBalance: selector => selector(stateOf({
        followedProvider: 'deepseek-official',
        selectedProvider: 'moonshotai-cn',
        preview: BALANCE,
        providers: [...PROVIDERS, { id: 'moonshotai-cn', displayName: 'Moonshot AI (CN)' }],
      })),
    })
    act(() => { fireEvent.mouseEnter(anchor) })

    act(() => { fireEvent.click(topUp(popover()) as HTMLElement) })
    expect(open).toHaveBeenCalledWith('https://platform.kimi.com/console/pay', '_blank', 'noopener,noreferrer')
  })
})
