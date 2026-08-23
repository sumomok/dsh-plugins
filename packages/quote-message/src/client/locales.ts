/**
 * Copy for the two surfaces this plugin owns: the selection pill and the
 * `@message` picker rows, the chip label cached on each occurrence, and the
 * `header.*` vocabulary the blockquote the model reads is built from.
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
  'section.messages': '本会话消息',
  'candidate.description': '整条消息 · {chars} 个字符',
  'role.user': '用户',
  'role.assistant': '助手',
  'chip.label': '引用 #{seq} {role}',
  'chip.labelUnknown': '引用',
  'header.quote': '引用',
  'header.user': '用户消息',
  'header.assistant': '助手消息',
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
  'header.quote': 'quote',
  'header.user': 'user message',
  'header.assistant': 'assistant message',
}

/** Dictionary key domain. */
export type QuoteKey = keyof typeof zh
