/**
 * The shadowing user-bubble renderer, rendered against a fake incumbent.
 *
 * The point of the shadow is that a message without quotes must reach the
 * incumbent byte-identical to what it would have received with this plugin
 * uninstalled, so the passthrough case is asserted against that markup rather
 * than against a hand-written expectation.
 */
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StoredEntry, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { createQuotedUserNodeView } from '../src/client/QuotedUserNodeView.tsx'
import type { QuoteKey } from '../src/client/locales.ts'

/** Stand-in for the host's `UserMessageNodeView`: prints its text and its `t`. */
function FakeIncumbent(props: unknown): ReactNode {
  const { node, t } = props as {
    node: { data: { content: readonly { type: string; text?: string }[] } }
    t: (key: string) => string
  }
  const text = node.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
  return <div data-bubble="">{t('probe')}|{text}</div>
}

const hostTranslate = (key: string): string => `host:${key}`
const ours = ((key: string) => `ours:${key}`) as unknown as Translate<QuoteKey>

/** One user node carrying `text` as its single text block. */
function nodeOf(text: string): { data: { content: readonly unknown[] } } {
  return { data: { content: [{ type: 'text', text }] } }
}

/** The ledger the view reads its incumbent out of. */
function ledger(own: unknown): readonly StoredEntry[] {
  return [
    { component: FakeIncumbent, options: { key: 'user' } },
    { component: own, options: { key: 'user', priority: -1 } },
    { component: () => null, options: { key: 'assistant-step' } },
  ] as unknown as readonly StoredEntry[]
}

/** The view under test, wired to the fake ledger. */
function view(): (props: never) => ReactNode {
  // The ledger holds the view itself, which does not exist until the factory
  // returns; the holder closes that circle the way the plugin's own
  // registration does (the entry is in the ledger it reads).
  const holder: { own?: unknown } = {}
  const built = createQuotedUserNodeView({
    slotKey: 'user',
    entries: () => ledger(holder.own),
    hostTranslate: () => hostTranslate,
    t: () => ours,
    headings: () => ['引用：', 'Quote:'],
  })
  holder.own = built
  return built as (props: never) => ReactNode
}

/** Render one node through the view. */
function render(text: string): string {
  const View = view()
  return renderToStaticMarkup(<View {...{ node: nodeOf(text), t: ours } as never} />)
}

describe('QuotedUserNodeView', () => {
  it('renders a quote-free message exactly as the incumbent would', () => {
    const bare = renderToStaticMarkup(<FakeIncumbent node={nodeOf('just a question')} t={hostTranslate} />)
    expect(render('just a question')).toBe(bare)
  })

  it('leaves a message whose > run sits mid-text to the incumbent', () => {
    const text = 'before\n> mid\nafter'
    const bare = renderToStaticMarkup(<FakeIncumbent node={nodeOf(text)} t={hostTranslate} />)
    expect(render(text)).toBe(bare)
  })

  it('lifts the quote above the bubble and hands the incumbent the rest', () => {
    const html = render('> 引用：\n> quoted line\n\nmy question')
    expect(html).toContain('data-quote-message-cards')
    expect(html).toContain('quoted line')
    expect(html).toContain('<div data-bubble="">host:probe|my question</div>')
    // The heading line is the plugin's own marker for the model, never
    // displayed — and with the head label gone, the word appears nowhere.
    expect(html).not.toContain('引用')
  })

  it('renders a rule and text: no box, no background, no head label', () => {
    const html = render('> Quote:\n> cited passage\n\nask')
    expect(html).toContain('border-left:2px solid var(--dsw-alias-border-l4')
    expect(html).not.toContain('border-radius')
    expect(html).not.toContain('background')
    expect(html).not.toContain('>Quote<')
  })

  it('collapses a quote at three lines', () => {
    const html = render('> Quote:\n> one\n> two\n> three\n> four\n\nask')
    expect(html).toContain('-webkit-line-clamp:3')
  })

  it('gives the incumbent the host translate, not this plugin\'s', () => {
    expect(render('> Quote:\n> cited\n\nask')).not.toContain('ours:probe')
  })

  it('renders a quote-only message as a card with no bubble text', () => {
    const html = render('> Quote:\n> cited')
    expect(html).toContain('cited')
    expect(html).toContain('<div data-bubble="">host:probe|</div>')
  })

  it('renders nothing but the incumbent when no incumbent exists', () => {
    const View = createQuotedUserNodeView({
      slotKey: 'user',
      entries: () => [],
      hostTranslate: () => hostTranslate,
      t: () => ours,
      headings: () => [],
    })
    expect(renderToStaticMarkup(<View {...{ node: nodeOf('hi') } as never} />)).toBe('')
  })
})
