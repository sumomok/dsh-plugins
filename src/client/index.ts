/**
 * Browser half of @haoran/dsh-quote-message.
 *
 * Two ways to cite the current session, one reference kind:
 * - a selection pill (`conversation.input.dock` entry, see QuoteDock.tsx);
 * - the `@message` trigger source registered here.
 *
 * Both produce the same chip, and the chip carries the quoted text in its own
 * `ref` payload — never a key into module state, so a chip keeps working
 * after this plugin re-registers. Nothing is written to the session log: the
 * quote reaches the model as part of the ordinary prompt, expanded by the
 * codec below when the composer submits.
 *
 * @module @haoran/dsh-quote-message/client
 */
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.* slots).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InputTriggerServiceContract, InputTriggerSource, PickOutcome,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  candidateName, filterQuoteSources, quoteSourceBySeq, quoteSources, type QuoteSource,
} from '../core/candidates.ts'
import {
  buildQuotePayload, decodeQuoteRef, quoteBlock, serializeQuote, type QuotePayload,
} from '../core/quote.ts'
import { en, NS, zh, type QuoteKey } from './locales.ts'
import { QuoteDock } from './QuoteDock.tsx'
import { chipLabel, insertQuoteReference, QUOTE_SOURCE_NAME, quoteReference } from './reference.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Selection pill and `@message` picker copy. */
    'quote-message': QuoteKey
  }
}

/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'sessions', 'inputTriggers']

/**
 * Register the `@message` reference source and the selection pill.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quote-message: dictionaries')
  const t = ctx.locale.bind(NS)

  /** Quotable messages of one session, read from the live snapshot at call time. */
  const sourcesOf = (sessionId: SessionId): QuoteSource[] => {
    const binding = ctx.sessions.binding(sessionId)
    return binding === undefined ? [] : quoteSources(binding.session.getSnapshot().nodes)
  }

  const source: InputTriggerSource = {
    trigger: '@',
    name: QUOTE_SOURCE_NAME,
    // After the first-party file/session source (which takes the default 0),
    // so `@` still opens on the references a user reaches for most.
    order: 10,
    showGroupTitle: false,
    candidates: (session, { query }) => Promise.resolve(
      filterQuoteSources(sourcesOf(session.sessionId), query).map(candidate => ({
        name: candidateName(candidate, role => t(`role.${role}`)),
        description: t('candidate.description', { chars: candidate.text.length }),
        section: t('section.messages'),
        value: String(candidate.seq),
      })),
    ),
    onPick: ({ candidate, session }): PickOutcome => {
      if (candidate.value === undefined) return undefined
      const picked = quoteSourceBySeq(sourcesOf(session.sessionId), Number(candidate.value))
      if (picked === undefined) return undefined
      const payload = buildQuotePayload(picked)
      return { insert: quoteReference(payload, chipLabel(payload, t)) }
    },
    codec: {
      clipboardText: ref => quoteBlock(decodeQuoteRef(ref)),
      serialize: ref => Promise.resolve(serializeQuote(decodeQuoteRef(ref))),
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'quote-message: @message source')

  const quote = (sessionId: SessionId, payload: QuotePayload, draftRev: number): boolean =>
    insertQuoteReference(ctx, sessionId, quoteReference(payload, chipLabel(payload, t)), draftRev)

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
}
