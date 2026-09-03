import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { FooterChip, type FooterChipProps } from '../src/client/FooterChip.tsx'
import type { BalanceState } from '../src/client/store.ts'
import { en, type BalanceKey } from '../src/client/locales.ts'
import type { BalanceView, ProviderOption } from '../src/types.ts'

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

/**
 * Stand-in for another plugin's own entry in the shared `sidebar.footer.action`
 * list slot: an ordinary flex item with its own share of the row's width.
 */
function FakeSibling({ label }: { label: string }): ReactNode {
  return <div className="fake-sibling" style={{ flex: '1 1 auto', minWidth: 0 }}>{label}</div>
}

describe('FooterChip — sibling tolerance', () => {
  it('renders between two fake siblings in document order, without occluding them while closed', () => {
    const html = renderToStaticMarkup(
      <div style={{ display: 'flex' }}>
        <FakeSibling label="left-neighbour" />
        <FooterChip {...chipProps()} />
        <FakeSibling label="right-neighbour" />
      </div>,
    )

    const leftAt = html.indexOf('left-neighbour')
    const chipAt = html.indexOf('dshb-anchor')
    const rightAt = html.indexOf('right-neighbour')
    expect(leftAt).toBeGreaterThan(-1)
    expect(chipAt).toBeGreaterThan(leftAt)
    expect(rightAt).toBeGreaterThan(chipAt)

    // Closed by default — no hover has happened yet — so the popover must
    // not exist in the tree at all: a mounted-but-hidden panel could still
    // occlude a sibling; an absent one cannot.
    expect(html).not.toContain('dshb-pop')

    // Both siblings render exactly as given: the chip does not wrap, absorb,
    // or otherwise rewrite the row around itself.
    expect(html).toContain('class="fake-sibling"')
    expect(html.match(/class="fake-sibling"/g)).toHaveLength(2)
  })

  it('carries no inline style on its own root — every layout rule lives in the shared stylesheet, not a per-render override', () => {
    const html = renderToStaticMarkup(<FooterChip {...chipProps()} />)
    expect(html).toContain('class="dshb-anchor"')
    // A `style=` attribute here would mean some dynamic value (e.g. a
    // computed `right`/`z-index`) is fighting the row's own flex layout;
    // the anchor's box is governed entirely by the `.dshb-anchor` rule in
    // styles.ts, which this test does not duplicate.
    expect(html).not.toMatch(/class="dshb-anchor"[^>]*\sstyle=/)
  })

  it('renders nothing at all for an unconfigured followed provider — no box to crowd the row with in the first place', () => {
    const html = renderToStaticMarkup(
      <div style={{ display: 'flex' }}>
        <FakeSibling label="left-neighbour" />
        <FooterChip {...chipProps({ useBalance: selector => selector(stateOf({ balance: { state: 'unconfigured' } })) })} />
        <FakeSibling label="right-neighbour" />
      </div>,
    )
    expect(html).not.toContain('dshb-anchor')
    expect(html.match(/class="fake-sibling"/g)).toHaveLength(2)
  })
})

describe('FooterChip — provider/amount layout', () => {
  it('renders the provider name and amount as separate spans, amount last', () => {
    const html = renderToStaticMarkup(<FooterChip {...chipProps()} />)
    const providerAt = html.indexOf('class="dshb-chip-provider"')
    const amountAt = html.indexOf('class="dshb-chip-amount"')
    expect(providerAt).toBeGreaterThan(-1)
    expect(amountAt).toBeGreaterThan(providerAt)
    expect(html).toContain('class="dshb-chip-provider">DeepSeek<')
    expect(html).toContain('class="dshb-chip-amount">¥12.34<')
  })

  it('hides the provider span entirely on the narrow rail, showing only the amount', () => {
    const html = renderToStaticMarkup(<FooterChip {...chipProps({ wide: false })} />)
    expect(html).not.toContain('dshb-chip-provider')
    expect(html).toContain('class="dshb-chip-amount">¥12.34<')
  })
})
