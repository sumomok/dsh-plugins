/**
 * The browser half's stylesheet, injected once as a tagged `<style>`.
 *
 * Every colour is a harness theme variable rather than a literal, so the chip
 * follows the light and dark schemes the shell already switches between.
 *
 * @module @sumomok/dsh-balance/client/styles
 */

/** Attribute marking this plugin's style tag, so a remount does not duplicate it. */
export const STYLE_TAG = 'data-dsh-balance'

const CSS = [
  // The anchor is an ordinary flex item in `sidebar.footer.action` (a list
  // slot other plugins may also occupy): no absolute positioning. It grows
  // to fill whatever width the row leaves it — the whole row when it is the
  // only occupant, its ordinary flex share when a sibling occupies the same
  // slot — rather than hugging its own text, so the chip's own
  // `justify-content:space-between` puts the provider name hard left and
  // the amount hard right of the full row. `min-width:0` is what lets the
  // provider span ellipsis instead of forcing the row wider.
  '.dshb-anchor{flex:1 1 auto;min-width:0;width:100%;max-width:none}',
  '.dshb-chip{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;min-width:0;height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:12px;line-height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left}',
  '.dshb-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dshb-chip-rail{justify-content:center;padding:0;font-size:11px;font-weight:600}',
  // The provider name is the one span that gives way when the row is
  // crowded: it shrinks and ellipsizes first. The amount never truncates or
  // hides here — the discrete "narrow" cutover in FooterChip.tsx (measured
  // against the chip's own width) is what drops the provider span entirely
  // once even an ellipsized provider would not leave the amount room.
  '.dshb-chip-provider{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshb-chip-amount{flex:none;margin-left:auto;font-variant-numeric:tabular-nums}',
  '.dshb-num{font-variant-numeric:tabular-nums}',
  '.dshb-warning{color:var(--dsw-alias-label-warning,#b46b00)}',
  '.dshb-critical{color:var(--dsw-alias-label-error,#c0392b)}',
  '.dshb-stale{opacity:.55}',
  '.dshb-muted{color:var(--dsw-alias-label-tertiary)}',
  // `position:fixed` with `left`/`top` set inline by `usePopoverPosition`
  // (FooterChip.tsx): the anchor may sit anywhere in a shared row, including
  // near the sidebar's own edge, so a CSS-only `right:0` can push the panel
  // half off-screen. The JS clamp keeps it inside the viewport regardless of
  // where the chip itself landed.
  '.dshb-pop{z-index:40;width:max-content;min-width:220px;max-width:280px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 8px 24px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}',
  '.dshb-pop-row{display:flex;justify-content:space-between;gap:12px}',
  '.dshb-pop-head{margin-bottom:6px;font-weight:600}',
  '.dshb-pop-sep{margin:8px 0;border:0;border-top:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.25))}',
  '.dshb-pop-foot{margin-top:8px;color:var(--dsw-alias-label-tertiary)}',
  // The popover's own footer controls — top up, refresh — right-aligned in
  // one row. Refresh moved here off the chip's own click, which toggles the
  // pinned popover instead. `flex-end` with a gap keeps refresh against the
  // right edge whether or not the picked provider has a top-up page.
  '.dshb-pop-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}',
  '.dshb-pop-btn{padding:4px 10px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.25));border-radius:6px;background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:12px;cursor:pointer}',
  '.dshb-pop-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dshb-provider-picker{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
  '.dshb-provider-select{flex:1;min-width:0;height:26px;padding:0 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:12px}',
  '.dshb-session{display:block;padding:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.dshb-settings{display:flex;flex-direction:column;gap:20px;max-width:100%}',
  '.dshb-settings-group{display:flex;flex-direction:column;gap:10px;min-width:0}',
  '.dshb-settings-group h3{margin:0;font-size:13px;font-weight:600}',
  '.dshb-settings-field{display:flex;align-items:center;gap:8px;font-size:12px}',
  '.dshb-settings-field span{min-width:140px;color:var(--dsw-alias-label-secondary)}',
  '.dshb-settings-field input,.dshb-settings-field select{flex:1;min-width:0;height:26px;padding:0 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:12px}',
  '.dshb-settings-price-row{border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.2));border-radius:8px;padding:8px;min-width:0}',
  // `auto-fill`/`minmax`, not a fixed column count: eight cells at a hardcoded
  // 4-per-row forced the row wider than the Settings modal's own content
  // column, cutting the last cells off past its edge. Letting the grid pick
  // its own column count keeps every cell inside whatever width the modal
  // actually gives this section.
  '.dshb-settings-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px 10px;min-width:0}',
  // A sibling flex row, not another grid item: the tiers summary and the
  // remove button used to sit inside the field grid itself, where CSS
  // Grid's default row-stretch made the button match the tallest cell's
  // height whenever the summary text wrapped to several lines.
  '.dshb-settings-price-row-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px}',
  '.dshb-settings-cell{display:flex;flex-direction:column;gap:2px;font-size:11px;min-width:0}',
  '.dshb-settings-cell span{color:var(--dsw-alias-label-tertiary)}',
  '.dshb-settings-cell input{width:100%;min-width:0;height:24px;padding:0 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:12px;box-sizing:border-box}',
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
