/**
 * The plugin's one stylesheet, injected once as a tagged `<style>` element.
 *
 * The two action buttons sit inside the host's message IconActions row, so
 * they reuse that row's geometry and `--dsw-*` alias tokens; hover and
 * disabled states need real CSS rules, which inline styles cannot express.
 */

/** Class name of the icon button (mirrors the host's own action chrome). */
export const ACTION_CLASS = 'dsh-edit-rerun-action'

/** `data-*` attribute marking a button that is busy and refuses clicks. */
export const BUSY_ATTR = 'data-busy'

const STYLE_TAG_ID = '@sumomok/dsh-edit-rerun'

const CSS = `
.${ACTION_CLASS} {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  border: none;
  border-radius: 28px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.${ACTION_CLASS}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
.${ACTION_CLASS}[${BUSY_ATTR}] {
  cursor: default;
  opacity: 0.4;
}
.${ACTION_CLASS}[${BUSY_ATTR}]:hover {
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
}
`

/**
 * Install the stylesheet, once per document.
 * @returns a disposer removing the tag, so unloading the plugin leaves no residue.
 */
export function installStyles(): () => void {
  const selector = `style[data-plugin="${STYLE_TAG_ID}"]`
  if (document.querySelector(selector) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = STYLE_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
