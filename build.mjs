/**
 * Package build: one TypeScript compile, then two bundles.
 *
 * `tsc -b` emits lib/types (JavaScript plus declarations), esbuild bundles
 * the node half into lib/index.js, and the browser half into lib/client.js in
 * the closure-factory form the web shell's module loader consumes:
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { … } })
 *
 * Externals are the shell's frozen module table. Everything the table cannot
 * answer must be inlined, and React must NEVER be inlined — a second React in
 * the page has its own hook dispatcher and every hook this plugin calls would
 * throw.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = dirname(fileURLToPath(import.meta.url))
const { name } = require('./package.json')

/**
 * Module specifiers the web shell shares into its frozen table. Kept in step
 * with `PLATFORM_MODULES` / `PRELOADED_CLIENT_EXTERNALS` in
 * @deepseek-ai/dsh-client-web; a specifier missing here is inlined instead,
 * and a specifier listed here but absent from the table throws at load.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-b', resolve(root, 'tsconfig.json')], {
  stdio: 'inherit',
})

await build({
  entryPoints: [resolve(root, 'lib/types/index.js')],
  outfile: resolve(root, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['@deepseek-ai/*'],
  logLevel: 'warning',
})

await build({
  entryPoints: [resolve(root, 'lib/types/client/index.js')],
  outfile: resolve(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  external: CLIENT_EXTERNALS,
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'warning',
})

console.log(`built ${name}: lib/index.js, lib/client.js, lib/types/`)
