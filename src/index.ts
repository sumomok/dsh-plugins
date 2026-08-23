/**
 * Host half of @sumomok/dsh-quote-message. The plugin is browser-only: the row
 * in cordis.patch.yml mounts this no-op half so the loader sees a real cordis
 * plugin and the client-modules registry serves the browser half declared in
 * `dsh.client`. No host service, no route, no session event.
 *
 * @module @sumomok/dsh-quote-message
 */
import type { Context } from '@deepseek-ai/cordis'

/** Plugin name in the loader's entry roster. */
export const name = 'quote-message'

/**
 * Apply the host half.
 * @param _ctx - loader context; this plugin contributes nothing host-side.
 */
export function apply(_ctx: Context): void {}
