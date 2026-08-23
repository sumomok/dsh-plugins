/**
 * Local declaration of the host seat this plugin's user-message action needs.
 *
 * `@deepseek-ai/dsh-client-ui-conversation@0.1.1-rc.2` — the version this
 * package compiles against — declares `conversation.chat.assistant-actions`
 * but not `conversation.chat.user-actions`. The key below mirrors the harness
 * patch `patch/user-actions-slot` exactly (`kind: 'list'`, `scope: 'session'`,
 * owner `{ seq, text }`), so the component's props resolve to the same types
 * the host will hand it at runtime.
 *
 * RETIREMENT: delete this file, and its `import type {}` sites, as soon as the
 * `@deepseek-ai/dsh-client-ui-conversation` version in `peerDependencies`
 * carries the key itself. Two declarations of one SlotMap key do not merge —
 * TypeScript reports a duplicate member — so keeping this file after the host
 * types catch up is a compile error, not silent drift.
 *
 * Declaring the key here does not create it at runtime: a host that never
 * declares the slot simply never runs this plugin's registration factory (see
 * `ctx.slots.inject` in `./index.ts`).
 */

/** Owner currency of one user-side message's action strip, as the host passes it. */
export interface UserActionOwnerProps {
  /** Log position of the `user/message` event this strip addresses. */
  seq: number
  /** The message's joined text, the same string the built-in copy action writes. */
  text: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Action strip inside one user or admitted-steering message's IconActions row. */
    'conversation.chat.user-actions': {
      kind: 'list'
      scope: 'session'
      owner: UserActionOwnerProps
    }
  }
}
