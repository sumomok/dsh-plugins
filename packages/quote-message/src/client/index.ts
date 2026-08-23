/**
 * Browser half of @sumomok/dsh-quote-message.
 *
 * One way to cite the current session: select text in the chat and click the
 * pill (`conversation.input.dock` entry, see QuoteDock.tsx). The `@` trigger
 * belongs to files, and this plugin contributes no rows to it.
 *
 * Once sent, the quote is shown as a card above the bubble rather than as raw
 * `>` lines inside it: this plugin shadows the host's own user-message
 * renderer and delegates the bubble itself back to it (QuotedUserNodeView).
 *
 * The chip carries the quoted text in its own `ref` payload — never a key
 * into module state, so a chip keeps working after this plugin re-registers.
 * Nothing is written to the session log: the quote reaches the model as part
 * of the ordinary prompt, expanded by the codec below when the composer
 * submits.
 *
 * @module @sumomok/dsh-quote-message/client
 */
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.* slots).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InputTriggerServiceContract, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  decodeQuoteRef, quoteBlock, serializeQuote, type QuotePayload,
} from '../core/quote.ts'
import { en, NS, zh, type QuoteKey } from './locales.ts'
import { QuoteDock } from './QuoteDock.tsx'
import { createQuotedUserNodeView } from './QuotedUserNodeView.tsx'
import { chipLabel, insertQuoteReference, QUOTE_SOURCE_NAME, quoteReference } from './reference.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Selection pill and chip copy. */
    'quote-message': QuoteKey
  }
}

/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'sessions', 'inputTriggers']

/** The host node kinds whose bubble carries a user's own prompt. */
type UserNodeKey = 'user' | 'steering'

/** The dictionary namespace the incumbent user-bubble renderer declares. */
const HOST_NS = 'conversation'

/**
 * Register the selection pill and the codec that expands its chips.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quote-message: dictionaries')
  const t = ctx.locale.bind(NS)

  // Read per call, never captured: the header follows the language the user is
  // working in when the draft is sent, not the one in effect when the chip was
  // inserted.
  const headerLine = (): string => t('header.line')

  /** The chip for one quote, with its label and clipboard block in the active locale. */
  const referenceFor = (payload: QuotePayload) =>
    quoteReference(payload, chipLabel(payload, t), quoteBlock(payload, headerLine()))

  // A codec belongs to a trigger source and to nothing else: the composer
  // expands a reference occurrence by looking its source name up in this
  // roster (`serializeReference(source, ref)`), so the registration is what
  // makes a chip sendable. This one contributes no rows — `@` is the file
  // trigger, and a second group there fights the user's muscle memory — and
  // exists only to own the codec below.
  const source: InputTriggerSource = {
    trigger: '@',
    name: QUOTE_SOURCE_NAME,
    showGroupTitle: false,
    candidates: () => Promise.resolve([]),
    onPick: () => undefined,
    codec: {
      clipboardText: ref => quoteBlock(decodeQuoteRef(ref), headerLine()),
      serialize: ref => Promise.resolve(serializeQuote(decodeQuoteRef(ref), headerLine())),
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'quote-message: chip codec')

  const quote = (
    sessionId: SessionId,
    payload: QuotePayload,
    input: { readonly draft: string; readonly draftRev: number },
  ): boolean => insertQuoteReference(ctx, sessionId, referenceFor(payload), input)

  // A dock entry is the session-scope seat that lives exactly as long as the
  // chat it watches, and it hands the component the conversation snapshot and
  // the draft revision the insert needs. The entry itself renders nothing in
  // the dock row — the pill is portaled to the selection.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'quote-message',
    order: 900,
    locale: NS,
    inject: () => ({ quote }),
  }, QuoteDock))

  // Every header this plugin has ever emitted, so a card drops the line
  // whichever language it was written in.
  const headings = [zh['header.line'], en['header.line']]

  // Shadow the host's user and steering renderers: a keyed cell renders its
  // lowest live priority, and the host's entries stay registered at the
  // default 0 so this view can delegate the bubble straight back to them.
  // Built once, outside the inject callbacks: those re-run when the declaring
  // owner remounts, and a fresh component identity each time would remount
  // every bubble in the transcript.
  const shadowFor = (key: UserNodeKey) => createQuotedUserNodeView({
    slotKey: key,
    entries: () => ctx.slots.entries('conversation.chat.node'),
    hostTranslate: () => ctx.locale.bind(HOST_NS),
    t: () => t,
    headings: () => headings,
  })
  const userView = shadowFor('user')
  const steeringView = shadowFor('steering')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'user', priority: -1, locale: NS }, userView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'steering', priority: -1, locale: NS }, steeringView))
}
