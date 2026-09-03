/**
 * The `settings.section` page this plugin contributes: the price table and
 * the low/critical-balance thresholds, read and written through the
 * settings-namespace scope every settings row binds through
 * (`ctx.settingsScope.bind`, `@deepseek-ai/dsh-client-ui-settings`).
 *
 * Adding a currency, and editing a model's time-of-day tiers, are not
 * exposed here — only an existing currency's per-model base rates are
 * editable as rows, add/remove included. A row's own schedules and timezone
 * (when it already has them) are carried through unedited on save, never
 * dropped, and summarized as read-only text: the plugin configuration
 * (`cordis.yml`, or a direct settings-document edit) is still where a tier
 * itself is authored.
 *
 * @module @sumomok/dsh-balance/client/PriceTableSection
 */

import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { Config } from '../config.ts'
import type { PriceEntry, PriceTable } from '../prices.ts'
import { fill } from './format.ts'
import type { BalanceKey } from './locales.ts'

/** Props the section reads from its composed slot props. */
export interface PriceTableSectionProps {
  /** Close the settings panel; unused here — this page has no flow that leaves settings. */
  close: () => void
  /** The bound settings scope over this plugin's own namespace. */
  scope: SettingsScope<Config>
  /** The framework-injected translate seat for this plugin's namespace. */
  t: TranslateNS<'balance'>
}

/** One save action's inline status, shown beside its own control. */
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** @param state - one save action's status. @returns its copy key, or `undefined` while idle. */
export function saveStatusKey(state: SaveState): BalanceKey | undefined {
  switch (state) {
    case 'idle': return undefined
    case 'saving': return 'settings.saving'
    case 'saved': return 'settings.saved'
    case 'error': return 'settings.error'
  }
}

/** One price-table row being edited, as plain strings so an empty field stays representable. */
export interface DraftRow {
  model: string
  provider: string
  per: string
  input: string
  inputCacheHit: string
  output: string
  cacheWrite: string
  reasoning: string
  /** Carried through unedited; this form draws no control for it. */
  schedules: PriceEntry['schedules']
  timezone: string
}

/** @param entry - a price-table entry. @returns its editable draft. */
export function draftOf(entry: PriceEntry): DraftRow {
  return {
    model: entry.model,
    provider: entry.provider ?? '',
    per: String(entry.per),
    input: String(entry.base.input),
    inputCacheHit: String(entry.base.inputCacheHit),
    output: String(entry.base.output),
    cacheWrite: entry.base.cacheWrite === undefined ? '' : String(entry.base.cacheWrite),
    reasoning: entry.base.reasoning === undefined ? '' : String(entry.base.reasoning),
    schedules: entry.schedules,
    timezone: entry.timezone,
  }
}

/** @returns a fresh row for "add model", with no schedules and the usual per-1M unit. */
export function blankDraft(): DraftRow {
  return {
    model: '',
    provider: '',
    per: '1000000',
    input: '0',
    inputCacheHit: '0',
    output: '0',
    cacheWrite: '',
    reasoning: '',
    schedules: undefined,
    timezone: 'UTC',
  }
}

/**
 * @param text - a form field's raw text.
 * @param fallback - value when the text is empty or not a number.
 * @returns the parsed number.
 */
export function numberOr(text: string, fallback: number): number {
  const trimmed = text.trim()
  // `Number('')` is `0`, not `NaN` — an emptied field must fall back, not
  // silently become a real zero rate or threshold.
  if (trimmed.length === 0) return fallback
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : fallback
}

/** @param draft - one edited row. @returns the {@link PriceEntry} it saves as. */
export function entryOf(draft: DraftRow): PriceEntry {
  return {
    model: draft.model,
    ...draft.provider.trim().length === 0 ? {} : { provider: draft.provider.trim() },
    per: numberOr(draft.per, 1_000_000),
    base: {
      input: numberOr(draft.input, 0),
      inputCacheHit: numberOr(draft.inputCacheHit, 0),
      output: numberOr(draft.output, 0),
      ...draft.cacheWrite.trim().length === 0 ? {} : { cacheWrite: numberOr(draft.cacheWrite, 0) },
      ...draft.reasoning.trim().length === 0 ? {} : { reasoning: numberOr(draft.reasoning, 0) },
    },
    timezone: draft.timezone,
    ...draft.schedules === undefined ? {} : { schedules: draft.schedules },
  }
}

/** One save action's inline status line; nothing while idle. */
function SaveStatus({ state, t }: { state: SaveState; t: TranslateNS<'balance'> }): ReactNode {
  const key = saveStatusKey(state)
  return key === undefined ? null : <p className="dshb-muted">{t(key)}</p>
}

/** One labelled number field, saved on blur. */
function ThresholdField(
  { label, value, disabled, onCommit }: {
    label: string
    value: number
    disabled: boolean
    onCommit: (next: number) => void
  },
): ReactNode {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  return (
    <label className="dshb-settings-field">
      <span>{label}</span>
      <input
        type="number"
        value={text}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => { setText(event.target.value) }}
        onBlur={() => {
          const next = numberOr(text, value)
          setText(String(next))
          if (next !== value) onCommit(next)
        }}
      />
    </label>
  )
}

/** The low/critical-balance threshold group. */
function ThresholdsGroup(
  { config, writable, t, onSave }: {
    config: Config
    writable: boolean
    t: TranslateNS<'balance'>
    onSave: (field: 'lowBalance' | 'criticalBalance', value: number) => void
  },
): ReactNode {
  return (
    <section className="dshb-settings-group">
      <h3>{t('settings.thresholds.title')}</h3>
      <ThresholdField
        label={t('settings.thresholds.low')}
        value={config.lowBalance ?? 10}
        disabled={!writable}
        onCommit={next => { onSave('lowBalance', next) }}
      />
      <ThresholdField
        label={t('settings.thresholds.critical')}
        value={config.criticalBalance ?? 1}
        disabled={!writable}
        onCommit={next => { onSave('criticalBalance', next) }}
      />
    </section>
  )
}

/** One editable price-table row. */
function PriceRow(
  { draft, writable, t, onChange, onRemove }: {
    draft: DraftRow
    writable: boolean
    t: TranslateNS<'balance'>
    onChange: (next: DraftRow) => void
    onRemove: () => void
  },
): ReactNode {
  const field = (key: Exclude<keyof DraftRow, 'schedules'>, label: string): ReactNode => (
    <label className="dshb-settings-cell">
      <span>{label}</span>
      <input
        value={draft[key]}
        disabled={!writable}
        onChange={(event: ChangeEvent<HTMLInputElement>) => { onChange({ ...draft, [key]: event.target.value }) }}
      />
    </label>
  )
  const tiers = (draft.schedules ?? []).map(schedule => schedule.name)
  return (
    <div className="dshb-settings-price-row">
      <div className="dshb-settings-row">
        {field('model', t('settings.prices.model'))}
        {field('provider', t('settings.prices.provider'))}
        {field('per', t('settings.prices.per'))}
        {field('input', t('settings.prices.input'))}
        {field('inputCacheHit', t('settings.prices.inputCacheHit'))}
        {field('output', t('settings.prices.output'))}
        {field('cacheWrite', t('settings.prices.cacheWrite'))}
        {field('reasoning', t('settings.prices.reasoning'))}
      </div>
      <div className="dshb-settings-price-row-footer">
        {tiers.length > 0 && <p className="dshb-muted">{fill(t('settings.prices.tiers'), { names: tiers.join(', ') })}</p>}
        <button type="button" disabled={!writable} onClick={onRemove}>{t('settings.prices.removeRow')}</button>
      </div>
    </div>
  )
}

/** The per-currency price-table editor. */
function PricesGroup(
  { prices, writable, t, onSave }: {
    prices: PriceTable
    writable: boolean
    t: TranslateNS<'balance'>
    onSave: (currency: string, entries: PriceEntry[]) => void
  },
): ReactNode {
  const currencies = Object.keys(prices.tables)
  const [currency, setCurrency] = useState(currencies[0] ?? '')
  const [rows, setRows] = useState<DraftRow[]>(() => (prices.tables[currency]?.entries ?? []).map(draftOf))

  // Re-drafts from the currently accepted table whenever the currency
  // selection changes; an in-progress edit is not merged against a
  // concurrent external change, matching this form's explicit-save model.
  // Deliberately keyed on `currency` alone: re-running on every `prices`
  // reference change would discard whatever the user is mid-editing the
  // instant this section's own save (or another tab's) lands.
  useEffect(() => {
    setRows((prices.tables[currency]?.entries ?? []).map(draftOf))
  }, [currency])

  return (
    <section className="dshb-settings-group">
      <h3>{t('settings.prices.title')}</h3>
      <label className="dshb-settings-field">
        <span>{t('settings.prices.currency')}</span>
        <select value={currency} onChange={(event: ChangeEvent<HTMLSelectElement>) => { setCurrency(event.target.value) }}>
          {currencies.map(code => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      {rows.map((draft, index) => (
        // Rows carry no stable id of their own; index order is exactly what
        // "Add model" and "Remove" mutate, so it is the correct React key too.
        <PriceRow
          key={index}
          draft={draft}
          writable={writable}
          t={t}
          onChange={(next) => { setRows(rows.map((row, i) => (i === index ? next : row))) }}
          onRemove={() => { setRows(rows.filter((_row, i) => i !== index)) }}
        />
      ))}
      <button type="button" disabled={!writable} onClick={() => { setRows([...rows, blankDraft()]) }}>
        {t('settings.prices.addRow')}
      </button>
      <button
        type="button"
        disabled={!writable || currency.length === 0}
        onClick={() => { onSave(currency, rows.map(entryOf)) }}
      >
        {t('settings.prices.save')}
      </button>
    </section>
  )
}

/**
 * The registered `settings.section` component.
 * @param props - composed slot props.
 * @returns the page, or a loading/unavailable placeholder before the first accepted section.
 */
export function PriceTableSection({ scope, t }: PriceTableSectionProps): ReactNode {
  const [snapshot, setSnapshot] = useState(scope.getSnapshot())
  useEffect(() => scope.subscribe(() => { setSnapshot(scope.getSnapshot()) }), [scope])
  const [status, setStatus] = useState<{ thresholds: SaveState; prices: SaveState }>({
    thresholds: 'idle',
    prices: 'idle',
  })

  if (snapshot.status === 'loading') return <p className="dshb-muted">{t('loading')}</p>
  if (snapshot.status === 'unavailable' || snapshot.value === undefined) {
    return <p className="dshb-muted">{t('settings.unavailable')}</p>
  }
  const config = snapshot.value

  const saveThreshold = (field: 'lowBalance' | 'criticalBalance', value: number): void => {
    setStatus(previous => ({ ...previous, thresholds: 'saving' }))
    void scope.set(field, value).then(
      () => { setStatus(previous => ({ ...previous, thresholds: 'saved' })) },
      () => { setStatus(previous => ({ ...previous, thresholds: 'error' })) },
    )
  }
  const savePrices = (currency: string, entries: PriceEntry[]): void => {
    // Only reachable through `PricesGroup`'s `onSave`, rendered exclusively
    // while `config.prices` holds a table — see the render below.
    if (config.prices === undefined) return
    setStatus(previous => ({ ...previous, prices: 'saving' }))
    const next: PriceTable = { ...config.prices, tables: { ...config.prices.tables, [currency]: { entries } } }
    void scope.set('prices', next).then(
      () => { setStatus(previous => ({ ...previous, prices: 'saved' })) },
      () => { setStatus(previous => ({ ...previous, prices: 'error' })) },
    )
  }

  return (
    <div className="dshb-settings">
      {snapshot.writable ? null : <p className="dshb-muted">{t('settings.readOnly')}</p>}
      <ThresholdsGroup config={config} writable={snapshot.writable} t={t} onSave={saveThreshold} />
      <SaveStatus state={status.thresholds} t={t} />
      {config.prices === undefined ? null : (
        <PricesGroup prices={config.prices} writable={snapshot.writable} t={t} onSave={savePrices} />
      )}
      <SaveStatus state={status.prices} t={t} />
    </div>
  )
}
