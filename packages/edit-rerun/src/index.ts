/**
 * Host half of `@sumomok/dsh-edit-rerun`, loaded in the DSH host process.
 *
 * The plugin is browser-only. The row `cordis.patch.yml` inserts mounts this
 * no-op so the loader sees a real cordis plugin and the web plugin table finds
 * the package's `dsh.client` declaration; all behavior lives in `src/client`.
 */
import type { Context } from '@deepseek-ai/cordis'

/**
 * Apply the host half. It ignores the context cordis hands it: this plugin
 * contributes nothing to the host process.
 */
export const apply: (ctx: Context) => void = () => {}
