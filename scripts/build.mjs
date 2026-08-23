/**
 * Self-contained build for @haoran/dsh-edit-rerun.
 *
 * Three artifacts, all under `lib/`:
 * - `lib/types/**` — declarations, emitted by tsc (this project is
 *   declaration-only; see tsconfig.json).
 * - `lib/index.js` — the host half, plain ESM with no dependencies.
 * - `lib/client.js` — the browser half, in the closure-factory format the
 *   harness web shell's module loader expects: the bundle calls
 *   `window.__ModuleLoader__.load({ id, factory })` and resolves its externals
 *   through the `require` the loader injects. The banner/intro/footer below
 *   reproduce that handoff exactly as the harness's own client packages emit
 *   it, so a bundle built here loads the same way a first-party one does.
 *
 * EXTERNALS is the shell's frozen module table — the specifiers the page
 * already answers. Anything outside it would have to be inlined, and a second
 * React or a second copy of a service package breaks identity across the page,
 * so this plugin imports nothing else at runtime.
 *
 * The client bundle ships no source map: esbuild computes mappings before it
 * prepends the loader banner, so the emitted map would be off by the banner's
 * lines. A map that points at the wrong line is worse than none.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const pkgId = '@haoran/dsh-edit-rerun'

/** Module specifiers the web shell seeds into its frozen module table. */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

rmSync(resolve(root, 'lib'), { recursive: true, force: true })

execFileSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-b', resolve(root, 'tsconfig.json'), '--force'],
  { stdio: 'inherit' },
)

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(root, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
})

await build({
  entryPoints: [resolve(root, 'src/client/index.ts')],
  outfile: resolve(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: false,
  external: EXTERNALS,
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkgId)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})
