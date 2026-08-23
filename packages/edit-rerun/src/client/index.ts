/**
 * Browser half of `@sumomok/dsh-edit-rerun`.
 *
 * Three registrations, all on published conversation seats:
 * - `conversation.chat.assistant-actions` — the edit-and-rerun and
 *   rerun-as-is buttons on each completed turn's action row;
 * - `conversation.chat.user-actions` — the 「修改」 button under the reader's
 *   own question. Hosts before that seat existed never declare it, so this one
 *   is registered lazily and simply never appears there;
 * - `conversation.input.dock` — the invisible applier that hands the parked
 *   question to the forked session's composer.
 *
 * Nothing here writes a session event, calls a host route, reads the
 * filesystem, or opens a network connection.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: merges ctx.locale into Context.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: merges the conversation.* SlotMap keys and the input standard kit.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: declares `conversation.chat.user-actions` until the host types carry it.
import type {} from './host-slot.ts'
import { createPrefillStore } from '../core/pending-prefill.ts'
import { EditUserMessageAction } from './EditUserMessageAction.tsx'
import { PrefillApplier } from './PrefillApplier.tsx'
import { RerunActions } from './RerunActions.tsx'
import { createStartRerun } from './rerun.ts'
import { en, zh, type EditRerunKey } from './locales.ts'
import { installStyles } from './styles.ts'

/** Locale namespace this plugin owns. */
const NS = 'edit-rerun'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** edit-and-rerun surface copy. */
    'edit-rerun': EditRerunKey
  }
}

/** Client services this plugin requires. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

/**
 * Mount the rerun surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'edit-rerun: dictionaries')
  ctx.effect(installStyles, 'edit-rerun: styles')

  const store = createPrefillStore()
  const startRerun = createStartRerun(ctx.sessions, ctx.workspaces, store)

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'edit-rerun',
    // After the host's own per-message contributions; the row's copy and
    // branch controls are painted by the owner, not by this list.
    order: 100,
    locale: NS,
    inject: () => ({ startRerun }),
  }, RerunActions))

  // The user-message seat exists only on a host that declares it. `inject`
  // runs its factory on declaration and never at all without one, so this
  // registration is what keeps the plugin loadable on a host that has no such
  // seat: registering into an undeclared slot throws.
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.chat.user-actions', () => ctx.slots.register({
    name: 'conversation.chat.user-actions',
    id: 'edit-rerun.edit',
    // Same rank as the sibling assistant entry: the host paints copy and the
    // clock itself, and this list carries only contributed actions.
    order: 100,
    // Thunked so the entry's name follows a locale change (SlotLabel contract).
    label: () => t('user.edit.label'),
    locale: NS,
    inject: () => ({ startRerun }),
  }, EditUserMessageAction))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'edit-rerun-prefill',
    order: 1000,
    inject: () => ({ store }),
  }, PrefillApplier))
}
