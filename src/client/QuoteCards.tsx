/**
 * The quote cards shown above a user bubble: one card per quote block, in a
 * right-aligned column the width of the bubble it belongs to.
 *
 * @module @sumomok/dsh-quote-message/client/QuoteCards
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { stripQuoteHeading, type QuoteBlockLines } from '../core/split-quotes.ts'
import type { QuoteKey } from './locales.ts'

/** Lines shown before the card collapses. */
const CLAMP_LINES = 4

/**
 * The measuring effect must run before paint in a browser; without a DOM
 * (`renderToStaticMarkup` in the render test) a layout effect only warns, and
 * nothing it would measure exists.
 */
const useMeasureEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

/** Right-aligned column matching `.userStack`'s width cap in the host's bubble CSS. */
const COLUMN: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: '6px',
  maxWidth: 'min(525px, 82%)',
  marginLeft: 'auto',
  marginBottom: '6px',
}

const CARD: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  borderLeft: '2px solid var(--dsw-alias-label-caption, rgba(128, 128, 128, 0.6))',
  borderRadius: '8px',
  background: 'var(--dsw-specific-bubble, rgba(128, 128, 128, 0.12))',
  padding: '8px 12px',
  textAlign: 'left',
}

const HEAD: CSSProperties = {
  fontSize: '12px',
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-caption, rgba(128, 128, 128, 0.9))',
}

const BODY: CSSProperties = {
  fontSize: '14px',
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary, inherit)',
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
  marginTop: '4px',
  padding: 0,
  border: 'none',
  background: 'none',
  font: 'inherit',
  fontSize: '12px',
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-caption, rgba(128, 128, 128, 0.9))',
  cursor: 'pointer',
}

/** One card: our own head word, then the quoted lines. */
function QuoteCard({ lines, t }: { lines: QuoteBlockLines; t: Translate<QuoteKey> }): ReactNode {
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
    <div style={CARD} data-quote-message-card="">
      <div style={HEAD}>{t('card.head')}</div>
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
 * Render one message's quote blocks as cards.
 * @param props - the blocks, the header lines to drop from them, and translate.
 * @returns the card column, or null when nothing survives the heading strip.
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
      {bodies.map((lines, index) => <QuoteCard key={index} lines={lines} t={t} />)}
    </div>
  )
}
