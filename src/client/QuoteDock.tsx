/**
 * The selection pill. Mounted as a session-scope entry in
 * `conversation.input.dock`, it renders nothing in the dock row itself: its
 * only output is a floating button portaled to `document.body` while a
 * selection stands inside the chat column.
 *
 * The listeners are on `document` and `window` alone — never on the composer,
 * never a MutationObserver over host-rendered bubbles. The chat row a
 * selection belongs to is read from the host's own `data-chat-flow-key`
 * attribute (see core/chat-dom.ts).
 *
 * @module @haoran/dsh-quote-message/client/QuoteDock
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { quoteIdentityAt } from '../core/candidates.ts'
import { chatAnchorOf } from '../core/chat-dom.ts'
import { buildQuotePayload, type QuotePayload } from '../core/quote.ts'
import type { QuoteKey } from './locales.ts'

/** What the dock reads off its owner share and its own inject. */
export interface QuoteDockProps {
  /** Owner share: the conversation snapshot backing the chat this pill points at. */
  readonly session: ConversationSnapshot
  /** Owner share: the live input state; only its revision matters (the insert's CAS guard). */
  readonly input: { readonly draftRev: number }
  /** Framework prop: the session this entry is mounted for. */
  readonly sessionId: SessionId
  /** Framework prop: translate bound to this plugin's namespace. */
  readonly t: Translate<QuoteKey>
  /** Injected: seat one quote in this session's composer. */
  readonly quote: (sessionId: SessionId, payload: QuotePayload, draftRev: number) => boolean
}

/** A standing selection worth offering to quote. */
interface PillState {
  readonly text: string
  /** Chat node key of the row the selection sits in; absent when it spans rows. */
  readonly nodeKey?: string
  /** Viewport coordinates of the selection's top edge, in CSS pixels. */
  readonly left: number
  readonly top: number
}

/** The nearest element of a selection boundary (a text node answers with its parent). */
function elementOf(node: Node | null): Element | null {
  if (node === null) return null
  return node.nodeType === 1 ? (node as Element) : node.parentElement
}

const PILL_STYLE: CSSProperties = {
  position: 'fixed',
  zIndex: 1000,
  transform: 'translate(-50%, calc(-100% - 8px))',
  padding: '4px 10px',
  borderRadius: '6px',
  border: '1px solid var(--dsw-alias-border-1, rgba(0, 0, 0, 0.12))',
  background: 'var(--dsw-alias-bg-layer-1, #fff)',
  color: 'var(--dsw-alias-label-primary, #111)',
  font: 'inherit',
  fontSize: '12px',
  lineHeight: '16px',
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.16)',
}

/**
 * Render the selection pill for one session.
 * @param props - owner share, framework props, and the injected insert path.
 * @returns the portaled pill, or null while no chat selection stands.
 */
export function QuoteDock({ session, input, sessionId, t, quote }: QuoteDockProps) {
  const [pill, setPill] = useState<PillState | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // Escape dismisses the pill for the selection that stands; without this
    // the next keyup would re-evaluate that same selection and bring it back.
    let dismissed = false
    const hide = (): void => { setPill(null) }
    const evaluate = (): void => {
      if (dismissed) return hide()
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return hide()
      const text = selection.toString()
      if (text.trim() === '') return hide()
      const range = selection.getRangeAt(0)
      const anchor = chatAnchorOf(elementOf(range.commonAncestorContainer))
      if (!anchor.inChat) return hide()
      const rect = range.getBoundingClientRect()
      setPill({
        text,
        ...anchor.nodeKey === undefined ? {} : { nodeKey: anchor.nodeKey },
        left: rect.left + rect.width / 2,
        top: rect.top,
      })
    }
    // The pointer gesture settles the selection after mouseup on some engines,
    // so the read is deferred to the next task rather than run in the handler.
    const settle = (): void => {
      clearTimeout(timer)
      timer = setTimeout(evaluate, 0)
    }
    const onSelectionChange = (): void => {
      // A changed selection is a new gesture, and a new gesture is offerable
      // again however the previous one ended.
      dismissed = false
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed) hide()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      dismissed = true
      hide()
    }
    document.addEventListener('mouseup', settle)
    document.addEventListener('keyup', settle)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('keydown', onKeyDown)
    // Capture: the chat scrolls in its own scrollport, not on window, and a
    // scrolled selection leaves the pill pointing at empty space.
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mouseup', settle)
      document.removeEventListener('keyup', settle)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])

  // Reads the props of the render the click happened in; the listeners above
  // never read them, so nothing here has to be mirrored into a ref.
  const onQuote = (): void => {
    if (pill === null) return
    const view = pill.nodeKey === undefined ? undefined : session.chat.nodes.get(pill.nodeKey)
    const identity = view === undefined ? undefined : quoteIdentityAt(session.nodes, view.anchorSeq)
    quote(sessionId, buildQuotePayload({ text: pill.text, ...identity }), input.draftRev)
    // The selection is consumed: clearing it also keeps the pill from
    // reappearing when this click's own mouseup settles.
    window.getSelection()?.removeAllRanges()
    setPill(null)
  }

  if (pill === null) return null
  return createPortal(
    <button
      type="button"
      data-quote-message-pill=""
      title={t('pill.title')}
      style={{ ...PILL_STYLE, left: `${String(pill.left)}px`, top: `${String(pill.top)}px` }}
      // Keep the composer's focus and the selection itself: a mousedown that
      // reaches the document would collapse the range before the click lands.
      onMouseDown={(event) => { event.preventDefault() }}
      onClick={onQuote}
    >
      {t('pill.quote')}
    </button>,
    document.body,
  )
}
