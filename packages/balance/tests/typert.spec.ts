import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TYPERT_HOST_EXPORT, validateTypertManifest } from '@deepseek-ai/dsh-typert-loader'
import { CONTRIBUTION } from '../src/client/contribution.ts'
import { TYPERT } from '../src/typert.ts'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as {
  name: string
  exports: Record<string, unknown>
  dsh?: { client?: { platform?: string } }
}

/** One invocation as the loader validates it. */
interface Invocation {
  id: string
  namespace: string
  method: string
  parameters: { wire: string; acceptsUndefined?: boolean }[]
}

const invocations = TYPERT.invocations as unknown as Invocation[]

describe('the host manifest', () => {
  it('passes the loader\'s own validation, which is what registers it', () => {
    expect(() => validateTypertManifest(manifest.name, TYPERT)).not.toThrow()
  })

  it('is owned by this package, so the loader accepts it under this name', () => {
    expect(TYPERT.package).toBe(manifest.name)
    expect(TYPERT.face).toBe('host')
  })

  it('is reachable through the export the loader reads', () => {
    // The loader resolves `<package>/package.json`, so that export is load-bearing too.
    expect(manifest.exports[TYPERT_HOST_EXPORT]).toBeDefined()
    expect(manifest.exports['./package.json']).toBe('./package.json')
  })

  it('exports exactly the three reads, and no mutator', () => {
    expect(invocations.map(one => `${one.namespace}/${one.method}`)).toEqual([
      'accountBalance/get',
      'accountBalance/spend',
      'accountBalance/providers',
    ])
  })

  it('lets the browser call get() with neither argument', () => {
    const get = invocations.find(one => one.method === 'get')
    expect(get?.parameters).toHaveLength(2)
    expect(get?.parameters.every(one => one.acceptsUndefined)).toBe(true)
    expect(get?.parameters.map(one => one.wire)).toEqual(['provider', 'force'])
  })

  it('rejects a manifest naming another package', () => {
    expect(() => validateTypertManifest('someone-else', TYPERT)).toThrow(/must be owned by the package/)
  })
})

describe('the browser contribution', () => {
  it('is owned by the same package', () => {
    expect(CONTRIBUTION.package).toBe(TYPERT.package)
  })

  it('mirrors every host invocation, id for id', () => {
    expect(CONTRIBUTION.descriptors.map(one => one.id)).toEqual(invocations.map(one => one.id))
  })

  it('mirrors the wire field names the gateway matches arguments by', () => {
    for (const descriptor of CONTRIBUTION.descriptors) {
      const host = invocations.find(one => one.id === descriptor.id)
      expect(host).toBeDefined()
      expect(descriptor.parameters.map(one => one.wire)).toEqual(host?.parameters.map(one => one.wire))
      expect(descriptor.parameters.map(one => one.acceptsUndefined ?? false))
        .toEqual(host?.parameters.map(one => one.acceptsUndefined ?? false))
    }
  })

  it('declares the same receiver kind as the host', () => {
    for (const descriptor of CONTRIBUTION.descriptors) {
      expect(descriptor.invocation.kind).toBe('direct')
    }
  })
})

describe('the package manifest', () => {
  it('declares a web client half, which is what puts the bundle in the boot graph', () => {
    expect(manifest.dsh?.client?.platform).toBe('web')
  })

  it('exports the three faces the harness loads', () => {
    for (const face of ['.', './client', './typert'] as const) {
      expect(manifest.exports[face]).toBeDefined()
    }
  })
})
