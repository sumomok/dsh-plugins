import { describe, expect, it } from 'vitest'
import {
  chatAnchorOf, CHAT_FLOW_ATTR, CHAT_NODE_KEY_ATTR, type ChatElementLike,
} from '../src/core/chat-dom.ts'

/** Build a chain of stub elements, outermost first; the innermost is returned. */
function chain(...levels: Record<string, string>[]): ChatElementLike | null {
  let element: ChatElementLike | null = null
  for (const attributes of levels) {
    element = { getAttribute: name => attributes[name] ?? null, parentElement: element }
  }
  return element
}

describe('chatAnchorOf', () => {
  it('resolves the row key of a selection inside a chat message', () => {
    const anchor = chain(
      { [CHAT_FLOW_ATTR]: '' },
      { [CHAT_NODE_KEY_ATTR]: 'chat/user/7' },
      {},
      {},
    )
    expect(chatAnchorOf(anchor)).toEqual({ inChat: true, nodeKey: 'chat/user/7' })
  })

  it('reports a chat selection with no row key rather than withholding the quote', () => {
    expect(chatAnchorOf(chain({ [CHAT_FLOW_ATTR]: '' }, {}))).toEqual({ inChat: true })
  })

  it('takes the innermost row key when rows nest', () => {
    const anchor = chain(
      { [CHAT_FLOW_ATTR]: '' },
      { [CHAT_NODE_KEY_ATTR]: 'outer' },
      { [CHAT_NODE_KEY_ATTR]: 'inner' },
    )
    expect(chatAnchorOf(anchor)).toEqual({ inChat: true, nodeKey: 'inner' })
  })

  it('ignores an empty row key', () => {
    expect(chatAnchorOf(chain({ [CHAT_FLOW_ATTR]: '' }, { [CHAT_NODE_KEY_ATTR]: '' }))).toEqual({ inChat: true })
  })

  it('reports a selection outside the chat column, key or not', () => {
    expect(chatAnchorOf(chain({}, { [CHAT_NODE_KEY_ATTR]: 'chat/user/7' }))).toEqual({ inChat: false })
    expect(chatAnchorOf(null)).toEqual({ inChat: false })
  })
})
