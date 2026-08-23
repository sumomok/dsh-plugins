import { isBuiltin } from 'node:module'
import { defineConfig } from 'tsdown'

/**
 * This package emits three artifacts instead of the workspace default's one,
 * so it states its own layout (a package config replaces the root workspace
 * entry rather than adding to it):
 *
 * - `lib/index.js` — the Node half the harness Loader imports.
 * - `lib/typert.js` — the host-face Typert manifest. The typert loader imports
 *   it by file path, outside this package's module graph, so it is bundled on
 *   its own rather than as a chunk of the entry above.
 * - `lib/client.js` — the browser half, in the module-loader closure form the
 *   harness's own client bundles use: a CJS factory handed to
 *   `window.__ModuleLoader__.load`, resolving the shared module table through
 *   the injected `require`. Anything not in that table must be inlined, because
 *   `require` is synchronous and would throw on a specifier the table cannot
 *   answer.
 */

/** Module-table rows a dynamic client bundle may require: the shell baseline. */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

/** Specifiers the Node halves resolve from a real install rather than inlining. */
const nodeExternal = (specifier: string): boolean =>
  specifier === 'zod' || specifier.startsWith('@deepseek-ai/')

const nodeDeps = {
  neverBundle: nodeExternal,
  alwaysBundle: (specifier: string) => !isBuiltin(specifier) && !nodeExternal(specifier),
}

export default defineConfig([
  {
    name: '@sumomok/dsh-balance',
    entry: { index: 'lib/types/index.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: nodeDeps,
  },
  {
    name: '@sumomok/dsh-balance/typert',
    entry: { typert: 'lib/types/typert.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: nodeDeps,
  },
  {
    name: '@sumomok/dsh-balance/client',
    entry: { client: 'lib/types/client/index.js' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: (specifier: string) => CLIENT_EXTERNALS.has(specifier),
      alwaysBundle: (specifier: string) => !CLIENT_EXTERNALS.has(specifier),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@sumomok/dsh-balance", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
