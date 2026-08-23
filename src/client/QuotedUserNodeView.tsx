/**
 * The user bubble, with its quote blocks lifted out into cards.
 *
 * This renderer shadows the host's own `user` and `steering` node views: a
 * keyed slot renders its cell's LOWEST live priority, so registering at -1
 * puts this component in front of an entry that stays registered. Everything
 * it does not change it delegates to that incumbent, read out of the slot
 * ledger rather than imported — there is no import across plugin bundles, and
 * a value import would be a second copy of the module.
 *
 * Retirement: if the harness ships native quote rendering for user bubbles,
 * this renderer is deleted and the plugin keeps only its serialization.
 *
 * @module @sumomok/dsh-quote-message/client/QuotedUserNodeView
 */
import type { ComponentType, ReactNode } from 'react'
import type { StoredEntry, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { QuoteCards } from './QuoteCards.tsx'
import type { QuoteKey } from './locales.ts'
import { pickIncumbent, planQuotedContent } from './quoted-node.ts'

/** The props a keyed chat-node entry receives; only the parts this renderer reads are named. */
interface ChatNodeProps {
  readonly node?: { readonly data?: { readonly content?: readonly unknown[] } }
  readonly t?: unknown
}

/** What the view needs from the plugin context, resolved per render. */
export interface QuotedNodeViewDeps {
  /** The keyed cell this view shadows. */
  readonly slotKey: string
  /** Live ledger of `conversation.chat.node` entries. */
  readonly entries: () => readonly StoredEntry[]
  /** Translate bound to the INCUMBENT's namespace, not ours. */
  readonly hostTranslate: () => unknown
  /** Translate bound to this plugin's namespace, for the cards. */
  readonly t: () => Translate<QuoteKey>
  /** Header lines this plugin emits, dropped from a card's body. */
  readonly headings: () => readonly string[]
}

/**
 * Build the shadowing renderer for one keyed cell.
 *
 * The component is its own exclusion key when it looks the incumbent up, so
 * the factory returns it rather than exporting a bare component. The return
 * type is the bare function form the slot registration requires; a
 * `ComponentType` union would admit a class, which `SlotComponent` rejects.
 * @param deps - ledger access and the two translate bindings.
 * @returns the component to register at `priority: -1`.
 */
export function createQuotedUserNodeView(
  deps: QuotedNodeViewDeps,
): (props: ChatNodeProps) => ReactNode {
  const View = (props: ChatNodeProps): ReactNode => {
    // Capitalized so JSX reads it as a component rather than an intrinsic tag.
    const Incumbent = pickIncumbent(deps.entries(), deps.slotKey, View) as
      ComponentType<ChatNodeProps> | undefined
    // The incumbent declares the host's own dictionary namespace; rendering it
    // with our `t` would look every one of its keys up in our dictionary.
    const forHost = { ...props, t: deps.hostTranslate() } as ChatNodeProps
    const content = props.node?.data?.content
    const plan = content === undefined ? null : planQuotedContent(content)
    if (plan === null) {
      // Nothing to lift: the incumbent renders exactly what it would have
      // rendered without this plugin installed.
      return Incumbent === undefined ? null : <Incumbent {...forHost} />
    }
    const reduced = {
      ...forHost,
      node: { ...props.node, data: { ...props.node?.data, content: plan.content } },
    } as ChatNodeProps
    return (
      <>
        <QuoteCards quotes={plan.quotes} headings={deps.headings()} t={deps.t()} />
        {Incumbent !== undefined && <Incumbent {...reduced} />}
      </>
    )
  }
  return View
}
