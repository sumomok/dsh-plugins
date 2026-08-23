/**
 * Turning host numbers into the few strings the chip shows.
 *
 * @module @haoran/dsh-balance/client/format
 */

import type { BalanceUiConfig, BalanceView } from '../types.ts'

/** Symbols for the currencies the shipped price tables use; anything else shows its code. */
const SYMBOLS: Readonly<Record<string, string>> = { CNY: '¥', USD: '$', EUR: '€', JPY: '¥', GBP: '£' }

/**
 * The prefix one currency code renders with.
 * @param currency - ISO 4217 code.
 * @returns a symbol, or the code followed by a space.
 */
export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? `${currency} `
}

/**
 * Render one amount with its currency prefix.
 * @param currency - ISO 4217 code.
 * @param amount - the amount, as a decimal string or a number.
 * @param digits - fraction digits; two for money, more for a fraction of a cent.
 * @returns the display string, or `undefined` when the amount is not a number.
 */
export function formatAmount(currency: string, amount: string | number, digits = 2): string | undefined {
  const value = typeof amount === 'number' ? amount : Number(amount.trim())
  if (!Number.isFinite(value)) return undefined
  return `${currencySymbol(currency)}${value.toFixed(digits)}`
}

/**
 * Render a spend amount, keeping a small-but-nonzero total from reading as zero.
 * @param currency - ISO 4217 code.
 * @param amount - the cost.
 * @returns the display string.
 */
export function formatSpend(currency: string, amount: number): string {
  if (amount > 0 && amount < 0.01) return `${currencySymbol(currency)}${amount.toFixed(4)}`
  return `${currencySymbol(currency)}${amount.toFixed(2)}`
}

/** How the chip is tinted. */
export type BalanceTint = 'normal' | 'warning' | 'critical'

/**
 * Decide the chip's tint.
 *
 * A provider that says the account cannot serve requests is critical whatever
 * the number says: an account can be suspended with a positive balance.
 * @param view - a successful balance read.
 * @param ui - the deployment's thresholds.
 * @returns the tint.
 */
export function tintOf(view: Extract<BalanceView, { state: 'ok' }>, ui: BalanceUiConfig): BalanceTint {
  if (!view.isAvailable) return 'critical'
  const total = Number(view.total.trim())
  if (!Number.isFinite(total)) return 'normal'
  if (total < ui.criticalBalance) return 'critical'
  if (total < ui.lowBalance) return 'warning'
  return 'normal'
}

/**
 * Render a timestamp as a short local time.
 * @param atMs - epoch milliseconds.
 * @returns the local time of day.
 */
export function formatTime(atMs: number): string {
  return new Date(atMs).toLocaleTimeString()
}

/**
 * Render a timestamp as a local date.
 * @param atMs - epoch milliseconds.
 * @returns the local date.
 */
export function formatDate(atMs: number): string {
  return new Date(atMs).toLocaleDateString()
}

/**
 * Fill `{name}` placeholders, for the few strings assembled outside the
 * framework's own translate seat.
 * @param template - the copy.
 * @param values - placeholder values.
 * @returns the filled string.
 */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}
