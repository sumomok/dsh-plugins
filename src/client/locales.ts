/**
 * Copy for the surfaces this plugin owns: the selection pill, the chip label
 * cached on each occurrence, and the header line the blockquote the model
 * reads opens with.
 *
 * The header words are read at submit time rather than at insert time, so a
 * chip inserted before a language switch still serializes in the language the
 * user is working in when they send.
 *
 * @module @sumomok/dsh-quote-message/client/locales
 */

/** Locale namespace this plugin owns. */
export const NS = 'quote-message'

/** Chinese copy (the dictionary that defines the key domain). */
export const zh = {
  'pill.quote': '引用',
  'pill.title': '把选中的内容作为引用插入输入框',
  'role.user': '用户',
  'role.assistant': '助手',
  'chip.label': '引用 #{seq} {role}',
  'chip.labelUnknown': '引用',
  'header.line': '引用：',
  'card.expand': '展开',
  'card.collapse': '收起',
}

/** English copy. */
export const en: Record<QuoteKey, string> = {
  'pill.quote': 'Quote',
  'pill.title': 'Insert the selected text into the composer as a quote',
  'role.user': 'user',
  'role.assistant': 'assistant',
  'chip.label': 'Quote #{seq} {role}',
  'chip.labelUnknown': 'Quote',
  'header.line': 'Quote:',
  'card.expand': 'Show more',
  'card.collapse': 'Show less',
}

/** Dictionary key domain. */
export type QuoteKey = keyof typeof zh
