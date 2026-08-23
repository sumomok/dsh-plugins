/**
 * Build smoke: the shipped package must be loadable by the harness without a
 * build step at the install site, so the artifacts, the manifest declarations,
 * and the patch row are checked against each other rather than described in
 * prose only.
 *
 * The package's own bundler runs here rather than being assumed, so these
 * assertions read artifacts this suite produced and `vitest run` on a
 * never-built checkout still exercises them.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import manifest from '../package.json' with { type: 'json' }

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (relative: string): string => readFileSync(pkgRoot + relative, 'utf8')

beforeAll(() => {
  execFileSync(process.execPath, [pkgRoot + 'scripts/build.mjs'], { cwd: pkgRoot, stdio: 'inherit' })
}, 180_000)

describe('package manifest', () => {
  it('declares both a bundle patch and a client half', () => {
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-runtime')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-conversation')
  })

  it('exports the client half where the web plugin table looks for it', () => {
    expect(manifest.exports['./client'].default).toBe('./lib/client.js')
  })

  it('ships the prebuilt artifacts so an install never has to build', () => {
    expect(manifest.files).toContain('lib')
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(manifest.files).toContain('LICENSE')
  })

  it('is discoverable in the community registry', () => {
    expect(manifest.keywords).toEqual(
      expect.arrayContaining(['dsh', 'deepseek-harness', 'dsh-plugin', 'cordis-plugin']),
    )
    expect(manifest.license).toBe('MIT')
  })

  it('accepts a prerelease host across the 0.1.x line', () => {
    for (const [name, range] of Object.entries(manifest.peerDependencies)) {
      if (!name.startsWith('@deepseek-ai/dsh-')) continue
      expect(range, name).toBe('>=0.1.0-rc.1 <0.2.0-0')
    }
  })
})

describe('patch layer', () => {
  it('inserts the plugin under a stable id naming this package', () => {
    const patch = read('cordis.patch.yml')
    expect(patch).toMatch(/^\s+- id: edit-rerun$/m)
    // Read the name off the manifest so a rename cannot leave the row behind.
    expect(patch).toContain(`name: '${manifest.name}'`)
  })
})

describe('built artifacts', () => {
  it('emits the host half, the client bundle, and the declarations', () => {
    expect(existsSync(pkgRoot + 'lib/index.js')).toBe(true)
    expect(existsSync(pkgRoot + 'lib/client.js')).toBe(true)
    expect(existsSync(pkgRoot + 'lib/types/index.d.ts')).toBe(true)
    expect(existsSync(pkgRoot + 'lib/types/client/index.d.ts')).toBe(true)
  })

  it('hands the loader a factory returning the plugin under this package id', () => {
    // Drive the real artifact through a stand-in module loader: the bundle
    // registers itself, and its factory must produce a cordis plugin with the
    // service list the client apply needs.
    const loaded: { id?: string; exports?: unknown } = {}
    const table: Record<string, unknown> = {
      react: {}, 'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: null },
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    const shell = {
      __ModuleLoader__: {
        load({ id, factory }: { id: string; factory: (require: (name: string) => unknown) => unknown }) {
          loaded.id = id
          loaded.exports = factory(name => table[name] ?? {})
        },
      },
    }
    // The only input is this package's own freshly built artifact, executed
    // the way the browser executes it: as a classic script whose sole free
    // name is `window`.
    new Function('window', read('lib/client.js'))(shell)
    // The build script spells the loader id independently of the manifest;
    // the web plugin table keys the bundle by package name, so they must agree.
    expect(loaded.id).toBe(manifest.name)
    const plugin = loaded.exports as { apply?: unknown; inject?: unknown }
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.inject).toEqual(['slots', 'locale', 'sessions', 'workspaces'])
  })

  it('requires only modules the web shell seeds into its table', () => {
    const seeded = new Set([
      'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
      '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-runtime/client',
    ])
    const required = [...read('lib/client.js').matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])
    expect(required.length).toBeGreaterThan(0)
    for (const specifier of required) expect(seeded, specifier).toContain(specifier)
  })

  it('keeps the host half a dependency-free no-op', () => {
    const host = read('lib/index.js')
    expect(host).not.toContain('require(')
    expect(host).toMatch(/export\s*\{\s*apply/)
  })
})
