/**
 * The quoted passages shown above a user bubble: one left-ruled block per
 * quote, in a right-aligned column capped at the bubble's own width.
 *
 * The rendering is a bare citation — a rule and the text, no box, no head
 * label. The `引用：` / `Quote:` line the serialization opens with is the
 * model's marker, not the reader's: it is dropped from what is displayed and
 * never from what is logged.
 *
 * @module @sumomok/dsh-quote-message/client/QuoteCards
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { stripQuoteHeading, type QuoteBlockLines } from '../core/split-quotes.ts'
import type { QuoteKey } from './locales.ts'

/** Lines shown before a quote collapses. */
const CLAMP_LINES = 3

/**
 * The measuring effect must run before paint in a browser; without a DOM
 * (`renderToStaticMarkup` in the render test) a layout effect only warns, and
 * nothing it would measure exists.
 */
const useMeasureEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

/**
 * Right-aligned column that hugs its quotes, capped at `.userStack`'s own
 * width so a long quote wraps exactly where the bubble would. `fit-content`
 * keeps a short quote from reading as a banner detached from the bubble under
 * it; the 6px bottom margin is the whole gap to that bubble, because the
 * fragment this renders in is `display: contents` and the chat column adds
 * none of its own.
 */
const COLUMN: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  width: 'fit-content',
  maxWidth: 'min(525px, 82%)',
  marginLeft: 'auto',
  marginBottom: '6px',
}

/**
 * One quotation: a rule and its text. `--dsw-alias-border-l4` is the host
 * hairline token that resolves closest to the intended rule colour — about
 * rgb(214,214,214) on the light background and rgb(66,66,66) on the dark one.
 * The literal is only reached with no harness theme installed, where a light
 * page is the safer assumption.
 */
const QUOTE: CSSProperties = {
  alignSelf: 'stretch',
  borderLeft: '2px solid var(--dsw-alias-border-l4, rgb(207, 211, 214))',
  padding: '1px 0 1px 12px',
}

const BODY: CSSProperties = {
  fontSize: '14px',
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-secondary, inherit)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

const CLAMPED: CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: CLAMP_LINES,
  overflow: 'hidden',
}

const TOGGLE: CSSProperties = {
  marginTop: '2px',
  padding: 0,
  border: 'none',
  background: 'none',
  font: 'inherit',
  fontSize: '12px',
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, inherit)',
  cursor: 'pointer',
}

/** One quotation, collapsed to {@link CLAMP_LINES} until it is expanded. */
function QuoteBlock({ lines, t }: { lines: QuoteBlockLines; t: Translate<QuoteKey> }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const body = lines.join('\n')

  // Measured only while collapsed: expanding removes the clamp, so a
  // measurement taken then would always read "fits" and retire the toggle
  // that collapses it again. A ResizeObserver re-measures when the column
  // narrows, which changes how many lines the text wraps to.
  useMeasureEffect(() => {
    if (expanded) return
    const element = bodyRef.current
    if (element === null) return
    const measure = (): void => { setOverflowing(element.scrollHeight > element.clientHeight + 1) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [expanded, body])

  return (
    <div style={QUOTE} data-quote-message-card="">
      <div ref={bodyRef} style={expanded ? BODY : { ...BODY, ...CLAMPED }}>{body}</div>
      {overflowing && (
        <button type="button" style={TOGGLE} onClick={() => { setExpanded(value => !value) }}>
          {t(expanded ? 'card.collapse' : 'card.expand')}
        </button>
      )}
    </div>
  )
}

/**
 * Render one message's quote blocks above its bubble.
 * @param props - the blocks, the header lines to drop from them, and translate.
 * @returns the quote column, or null when nothing survives the heading strip.
 */
export function QuoteCards({ quotes, headings, t }: {
  readonly quotes: readonly QuoteBlockLines[]
  readonly headings: readonly string[]
  readonly t: Translate<QuoteKey>
}): ReactNode {
  const bodies = quotes
    .map(lines => stripQuoteHeading(lines, headings))
    .filter(lines => lines.some(line => line.trim() !== ''))
  if (bodies.length === 0) return null
  return (
    <div style={COLUMN} data-quote-message-cards="">
      {bodies.map((lines, index) => <QuoteBlock key={index} lines={lines} t={t} />)}
    </div>
  )
}
