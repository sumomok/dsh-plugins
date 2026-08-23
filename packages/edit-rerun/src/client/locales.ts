/**
 * Surface copy for the edit-and-rerun actions. The zh dictionary is the key
 * source; en is typed against it, so a key added to one and not the other is a
 * compile error.
 */

export const zh = {
  'edit.label': '编辑上一条提问并重跑',
  'edit.hint': '从这一轮之前分叉出新会话，把原提问填进输入框；原会话保持不变。',
  'rerun.label': '直接重跑这一轮',
  'rerun.hint': '从这一轮之前分叉出新会话，并原样重发这条提问；原会话保持不变。',
  'user.edit.label': '修改',
  'user.edit.hint': '修改这条提问并重跑：从这一轮之前分叉出新会话，原会话保持不变。',
  'busy': '正在创建分支…',
  'error.fork': '创建分支失败：{reason}',
} as const

/** Every key this plugin's dictionaries define. */
export type EditRerunKey = keyof typeof zh

export const en: Record<EditRerunKey, string> = {
  'edit.label': 'Edit the prompt and rerun',
  'edit.hint': 'Branches a new session from before this turn and puts the original prompt in the composer; the original conversation is untouched.',
  'rerun.label': 'Rerun this turn as is',
  'rerun.hint': 'Branches a new session from before this turn and sends the original prompt again; the original conversation is untouched.',
  'user.edit.label': 'Edit',
  'user.edit.hint': 'Edit this prompt and run again: branches a new session from before this turn; the original conversation is untouched.',
  'busy': 'Creating branch…',
  'error.fork': 'Could not create the branch: {reason}',
}
