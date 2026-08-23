/**
 * Copy for the two surfaces this plugin owns: the selection pill and the
 * `@message` picker rows, plus the chip label cached on each occurrence.
 *
 * The blockquote header the model reads is NOT here — it is fixed wording in
 * core/quote.ts, because the prompt must not change with the reader's UI
 * language.
 *
 * @module @haoran/dsh-quote-message/client/locales
 */

/** Locale namespace this plugin owns. */
export const NS = 'quote-message'

/** Chinese copy (the dictionary that defines the key domain). */
export const zh = {
  'pill.quote': '引用',
  'pill.title': '把选中的内容作为引用插入输入框',
  'section.messages': '本会话消息',
  'candidate.description': '整条消息 · {chars} 个字符',
  'role.user': '用户',
  'role.assistant': '助手',
  'chip.label': '引用 #{seq} {role}',
  'chip.labelUnknown': '引用',
}

/** English copy. */
export const en: Record<QuoteKey, string> = {
  'pill.quote': 'Quote',
  'pill.title': 'Insert the selected text into the composer as a quote',
  'section.messages': 'Messages in this session',
  'candidate.description': 'Whole message · {chars} chars',
  'role.user': 'user',
  'role.assistant': 'assistant',
  'chip.label': 'Quote #{seq} {role}',
  'chip.labelUnknown': 'Quote',
}

/** Dictionary key domain. */
export type QuoteKey = keyof typeof zh
