/**
 * Build smoke: what a consumer installing the tarball actually gets.
 *
 * These read `lib/`, so they depend on a build having run. `pnpm run build`
 * produces it; a bare `pnpm run test` on a clean checkout skips them rather
 * than failing on an absence that is not a defect.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const lib = (name: string): string => fileURLToPath(new URL(`../lib/${name}`, import.meta.url))
const built = existsSync(lib('index.js'))
const suite = built ? describe : describe.skip

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { exports: Record<string, { types?: string; default?: string } | string> }

suite('the built artifacts', () => {
  it('emits one file per declared export, plus its types', () => {
    for (const name of ['index.js', 'client.js', 'typert.js']) {
      expect(existsSync(lib(name)), name).toBe(true)
    }
    for (const name of ['types/index.d.ts', 'types/client/index.d.ts', 'types/typert.d.ts']) {
      expect(existsSync(lib(name)), name).toBe(true)
    }
  })

  it('resolves every export condition to a file that exists', () => {
    for (const [key, target] of Object.entries(manifest.exports)) {
      if (typeof target === 'string') continue
      for (const path of [target.types, target.default]) {
        if (path === undefined) continue
        expect(existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url))), `${key} -> ${path}`).toBe(true)
      }
    }
  })

  it('leaves the node half an ES module importing only its declared dependencies', () => {
    const source = readFileSync(lib('index.js'), 'utf8')
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map(match => match[1]!)
    expect(imports.length).toBeGreaterThan(0)
    for (const specifier of imports) {
      expect(
        specifier.startsWith('node:') || specifier.startsWith('@deepseek-ai/') || specifier === 'zod',
        specifier,
      ).toBe(true)
    }
  })

  it('ships the typert manifest with zod as its only import, since the loader imports it alone', () => {
    const source = readFileSync(lib('typert.js'), 'utf8')
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map(match => match[1]!)
    expect(imports).toEqual(['zod'])
    expect(source).toContain('TYPERT')
  })

  it('wraps the browser half in the module-loader closure the shell calls', () => {
    const source = readFileSync(lib('client.js'), 'utf8')
    expect(source.startsWith('window.__ModuleLoader__.load(')).toBe(true)
    expect(source).toContain('id: "@sumomok/dsh-balance"')
    expect(source).toContain('factory: (require)')
    expect(source).toContain('return module.exports;')
  })

  it('leaves the browser half requiring only modules the shell shares', () => {
    const source = readFileSync(lib('client.js'), 'utf8')
    const required = new Set([...source.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1]!))
    // The shell's frozen module table; a specifier outside it throws at load.
    const table = new Set([
      'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-runtime/client',
    ])
    for (const specifier of required) expect(table.has(specifier), specifier).toBe(true)
  })

  it('exports apply from both halves, which is what the loaders call', () => {
    expect(readFileSync(lib('index.js'), 'utf8')).toMatch(/\bapply\b/)
    expect(readFileSync(lib('client.js'), 'utf8')).toContain('exports.apply')
  })
})
