/**
 * The browser half's stylesheet, injected once as a tagged `<style>`.
 *
 * Every colour is a harness theme variable rather than a literal, so the chip
 * follows the light and dark schemes the shell already switches between.
 *
 * @module @haoran/dsh-balance/client/styles
 */

/** Attribute marking this plugin's style tag, so a remount does not duplicate it. */
export const STYLE_TAG = 'data-dsh-balance'

const CSS = [
  '.dshb-chip{display:flex;align-items:center;gap:6px;width:100%;height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:12px;line-height:32px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;cursor:pointer;text-align:left}',
  '.dshb-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dshb-chip-rail{justify-content:center;padding:0;font-size:11px;font-weight:600}',
  '.dshb-num{font-variant-numeric:tabular-nums}',
  '.dshb-warning{color:var(--dsw-alias-label-warning,#b46b00)}',
  '.dshb-critical{color:var(--dsw-alias-label-error,#c0392b)}',
  '.dshb-stale{opacity:.55}',
  '.dshb-muted{color:var(--dsw-alias-label-tertiary)}',
  '.dshb-pop{position:absolute;bottom:calc(100% + 6px);left:8px;right:8px;z-index:40;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 8px 24px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}',
  '.dshb-pop-row{display:flex;justify-content:space-between;gap:12px}',
  '.dshb-pop-head{margin-bottom:6px;font-weight:600}',
  '.dshb-pop-sep{margin:8px 0;border:0;border-top:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.25))}',
  '.dshb-pop-foot{margin-top:8px;color:var(--dsw-alias-label-tertiary)}',
  '.dshb-anchor{position:relative;width:100%}',
  '.dshb-session{display:block;padding:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
].join('\n')

/**
 * Put the stylesheet in the document, once.
 * @returns a disposer removing the tag.
 */
export function insertStyles(): () => void {
  if (typeof document === 'undefined') return () => undefined
  const existing = document.head.querySelector(`style[${STYLE_TAG}]`)
  if (existing !== null) return () => undefined
  const tag = document.createElement('style')
  tag.setAttribute(STYLE_TAG, '')
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
