/**
 * How the plugin's three seats reach a host — and what happens on a host that
 * has only two of them.
 *
 * `conversation.chat.user-actions` was added to the harness after this
 * plugin's supported floor, so the community build must load on a host that
 * never declares it. That is not a claim prose can carry: registering into an
 * undeclared slot is a load error (asserted against the real `SlotCore`
 * below), so the plugin registers that one entry through `ctx.slots.inject`,
 * whose factory runs on declaration and never at all without one.
 */
import { describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

// The primitives package reaches the page through the web shell's module
// table; imported directly here it pulls CSS modules a node runner cannot
// load. This suite asserts registration wiring, never rendering, so the icons
// and chrome stand in as identities.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconEditOutline16: () => null,
  IconRefreshOutline16: () => null,
  Toast: () => null,
  Tooltip: () => null,
}))

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { EditUserMessageAction } from '../src/client/EditUserMessageAction.tsx'
import { zh } from '../src/client/locales.ts'

/** One registration the plugin made, as the slots service received it. */
interface Registration {
  options: Record<string, unknown>
  component: unknown
}

/** Slot keys a stock 0.1.1-rc.x host declares for this plugin's two original seats. */
const STOCK_HOST_KEYS = ['conversation.chat.assistant-actions', 'conversation.input.dock']

/** The seat this version adds; a stock host has never heard of it. */
const USER_SEAT = 'conversation.chat.user-actions'

/**
 * Mount the plugin against a host declaring exactly `declared`.
 *
 * `slots.inject` reproduces the service contract the plugin depends on: the
 * factory runs when the key is declared, and is never called otherwise.
 * @param declared - slot keys this host declares.
 * @returns what the plugin registered, and the locale namespaces it installed.
 */
function mount(declared: readonly string[]) {
  const registrations: Registration[] = []
  const namespaces: string[] = []
  const disposers: (() => void)[] = []
  // installStyles writes one <style> tag; the effect runs for real, so this
  // suite also proves apply() survives a document with nothing in it.
  const head = { appendChild: vi.fn() }
  vi.stubGlobal('document', {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '', remove: () => {} }),
    head,
  })
  const ctx = {
    effect: (fn: () => (() => void) | void) => {
      const undo = fn()
      if (typeof undo === 'function') disposers.push(undo)
    },
    locale: {
      register: (ns: string) => {
        namespaces.push(ns)
        return () => {}
      },
      bind: () => (key: string) => zh[key as keyof typeof zh],
    },
    slots: {
      inject: (key: string, factory: () => void) => {
        if (declared.includes(key)) factory()
        return () => {}
      },
      register: (options: Record<string, unknown>, component: unknown) => {
        if (!declared.includes(options['name'] as string)) {
          throw new Error(`slot "${String(options['name'])}" is not declared`)
        }
        registrations.push({ options, component })
        return () => {}
      },
    },
    sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
  } as unknown as ClientContext
  apply(ctx)
  vi.unstubAllGlobals()
  return { registrations, namespaces }
}

describe('a host without the user-message seat', () => {
  it('loads the plugin with no error and contributes nothing to the missing seat', () => {
    const { registrations, namespaces } = mount(STOCK_HOST_KEYS)
    expect(namespaces).toEqual(['edit-rerun'])
    expect(registrations.map(entry => entry.options['name'])).toEqual(STOCK_HOST_KEYS)
    expect(registrations.some(entry => entry.options['name'] === USER_SEAT)).toBe(false)
  })

  it('would be a load error without the lazy factory (the real slot core refuses)', () => {
    // The rule this plugin is built around, read off the shipped implementation
    // rather than assumed: a direct register into an undeclared slot throws, so
    // an eagerly registered entry would take the whole plugin down on a host
    // that predates the seat.
    expect(() => new SlotCore().register({ name: USER_SEAT, id: 'edit-rerun.edit' }, () => null))
      .toThrow(/not declared/)
  })
})

describe('a host that declares the user-message seat', () => {
  it('registers the edit action as a list entry carrying the rerun flow', () => {
    const { registrations } = mount([...STOCK_HOST_KEYS, USER_SEAT])
    const entry = registrations.find(candidate => candidate.options['name'] === USER_SEAT)
    if (entry === undefined) throw new Error('the user-message seat received no entry')
    expect(entry.component).toBe(EditUserMessageAction)
    expect(entry.options['id']).toBe('edit-rerun.edit')
    expect(entry.options['order']).toBe(100)
    expect(entry.options['locale']).toBe('edit-rerun')
    const face = (entry.options['inject'] as () => { startRerun: unknown })()
    expect(typeof face.startRerun).toBe('function')
  })

  it('labels the entry through the live locale rather than a frozen string', () => {
    const { registrations } = mount([...STOCK_HOST_KEYS, USER_SEAT])
    const entry = registrations.find(candidate => candidate.options['name'] === USER_SEAT)
    expect((entry?.options['label'] as () => string)()).toBe(zh['user.edit.label'])
  })

  it('leaves the two original seats exactly as they were', () => {
    const { registrations } = mount([...STOCK_HOST_KEYS, USER_SEAT])
    const assistant = registrations.find(
      candidate => candidate.options['name'] === 'conversation.chat.assistant-actions',
    )
    expect(assistant?.options['id']).toBe('edit-rerun')
    expect(assistant?.options['order']).toBe(100)
  })
})

describe('service requirements', () => {
  it('names the four client services apply reads', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'workspaces'])
  })
})
