/**
 * Build smoke: what a profile install actually loads. The package's own
 * bundler runs here rather than being assumed, so a manifest that promises an
 * artifact the build does not emit fails in this suite instead of in a
 * browser.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { beforeAll, describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  name: string
  files: string[]
  exports: Record<string, unknown>
  keywords: string[]
  dsh: { bundle: { patch: string }; client: { platform: string; inject: string[] } }
}

beforeAll(() => {
  execFileSync(process.execPath, [resolve(root, 'build.mjs')], { cwd: root, stdio: 'inherit' })
}, 180_000)

const read = (relative: string): string => readFileSync(resolve(root, relative), 'utf8')

describe('the manifest', () => {
  it('declares both halves a profile install needs', () => {
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client.platform).toBe('web')
  })

  it('declares every client package whose service or slot map it depends on', () => {
    expect(manifest.dsh.client.inject).toEqual([
      '@deepseek-ai/dsh-api-session-controller',
      '@deepseek-ai/dsh-client-ui-input-trigger',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-locale',
    ])
  })

  it('ships the built artifacts, so an install never has to build', () => {
    expect(manifest.files).toContain('lib')
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(manifest.exports['.']).toMatchObject({ default: './lib/index.js' })
    expect(manifest.exports['./client']).toMatchObject({ default: './lib/client.js' })
  })

  it('is findable in the plugin registry', () => {
    expect(manifest.keywords).toContain('dsh-plugin')
  })
})

describe('the bundle layer', () => {
  it('inserts one plugin row naming this package', () => {
    expect(load(read('cordis.patch.yml'))).toEqual([
      { insert: [{ id: 'ui-quote-message', name: manifest.name }] },
    ])
  })
})

describe('the built halves', () => {
  it('emits a node half the loader can import', () => {
    expect(read('lib/index.js')).toMatch(/export\s*\{[^}]*\bapply\b/u)
  })

  it('hands the browser half to the shell module loader under the package name', () => {
    const client = read('lib/client.js')
    expect(client.startsWith(`window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`)).toBe(true)
    expect(client.trimEnd().endsWith('return module.exports; } });')
      || client.includes('return module.exports; } });')).toBe(true)
    expect(client).toMatch(/exports\.apply\s*=|apply:\s*\(\)\s*=>\s*apply/u)
  })

  it('requests React from the shell instead of bundling a second copy', () => {
    const client = read('lib/client.js')
    const requested = [...client.matchAll(/require\("([^"]+)"\)/gu)].map(match => match[1])
    expect(new Set(requested)).toEqual(new Set(['react', 'react/jsx-runtime', 'react-dom']))
    expect(client.length).toBeLessThan(200_000)
  })
})
