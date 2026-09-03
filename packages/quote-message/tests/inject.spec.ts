/**
 * The declared `inject` against what the browser half actually reads off `ctx`.
 *
 * A cordis context is a proxy: reading a property whose name the plugin did
 * not declare throws `cannot get property "<name>" without inject`, at the
 * moment of the read and inside whatever callback touched it. A unit test that
 * hands its subject a plain-object fake `ctx` cannot see that, so the
 * declaration is checked here twice — statically, against every `ctx.<name>`
 * in the sources, and against a real `Context` arranged the way the shell
 * arranges one, with the services provided by a sibling plugin.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { inject } from '../src/client/index.ts'

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src/client')

/** Head segment of each declared entry: `remote.session` declares `remote`. */
const declared = new Set(inject.map(entry => entry.split('.')[0] ?? entry))

/**
 * Every TypeScript source under the browser half.
 * @param dir - directory to walk.
 * @returns absolute paths of its `.ts` and `.tsx` files, at any depth.
 */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : []
  })
}

/**
 * Names read as a property of a variable called `ctx`.
 *
 * Parsed rather than matched with a regular expression, so a name that occurs
 * only in a comment or a string literal is not counted, and `actx.bail` is not
 * mistaken for `ctx.bail`. Every context this package passes around is named
 * `ctx`, which is what makes the identifier a sound filter.
 *
 * @param file - absolute path of the source to parse.
 * @returns the property names read off `ctx`, with duplicates.
 */
function ctxReads(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const names: string[] = []
  const onCtx = (node: ts.Node): boolean => ts.isIdentifier(node) && node.text === 'ctx'
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && onCtx(node.expression)) {
      names.push(node.name.text)
    } else if (ts.isElementAccessExpression(node) && onCtx(node.expression)
      && ts.isStringLiteralLike(node.argumentExpression)) {
      names.push(node.argumentExpression.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return names
}

/**
 * Names a context answers without any `inject`: its own properties, its
 * prototype methods, and the accessors `ReflectService` mixes on for the core
 * services (`ctx.effect`, `ctx.get`, `ctx.on`, ...).
 *
 * Read off a live context rather than listed by hand, so a cordis upgrade that
 * moves a name between the core surface and an injectable service cannot leave
 * a stale allowance behind here.
 *
 * @returns every property name the core context resolves on its own.
 */
function coreSurface(): ReadonlySet<string> {
  const probe = new Context()
  const names = new Set(Object.getOwnPropertyNames(probe))
  for (
    let proto: object | null = Object.getPrototypeOf(probe) as object | null;
    proto !== null && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name)
  }
  for (const [name, def] of Object.entries(probe.reflect.props)) {
    if (def.type === 'accessor') names.add(name)
  }
  return names
}

/**
 * Read names off `ctx` inside a plugin that declares this package's `inject`.
 *
 * The services are provided by a *sibling* plugin rather than on the root
 * context, because that is the only arrangement in which an undeclared read
 * fails: a service provided on the root itself sits in the root fiber's store,
 * which every descendant fiber walks past on its way to throwing, so it would
 * resolve whether or not the reader declared it.
 *
 * @param names - property names to read inside the plugin body.
 * @param provided - service names a sibling plugin provides; the declared ones
 * by default.
 * @returns each name mapped to the message its read threw, or `undefined` when
 * the read succeeded.
 */
async function readsUnderInject(
  names: readonly string[],
  provided: readonly string[] = [...declared],
): Promise<Map<string, string | undefined>> {
  const app = new Context()
  await app.plugin({
    apply: (ctx: Context) => {
      for (const name of provided) ctx.provide(name, {})
    },
  })
  const outcome = new Map<string, string | undefined>()
  await app.plugin({
    inject: [...inject],
    apply: (ctx: Context) => {
      for (const name of names) {
        try {
          void (ctx as unknown as Record<string, unknown>)[name]
          outcome.set(name, undefined)
        } catch (error) {
          outcome.set(name, (error as Error).message)
        }
      }
    },
  })
  return outcome
}

const files = sources(clientRoot)
const core = coreSurface()
const readNames = [...new Set(files.flatMap(file => ctxReads(file)))].sort()

describe('the core context surface', () => {
  it('covers the members cordis resolves without a declaration', () => {
    expect(core.has('effect')).toBe(true)
    expect(core.has('get')).toBe(true)
    expect(core.has('on')).toBe(true)
    expect(core.has('logger')).toBe(true)
    expect(core.has('extend')).toBe(true)
  })

  it('claims no injectable service, so a missing declaration cannot hide in it', () => {
    expect(core.has('uiConversation')).toBe(false)
    expect(core.has('slots')).toBe(false)
    expect(core.has('locale')).toBe(false)
    expect(core.has('sessions')).toBe(false)
  })
})

describe('the parsed ctx reads', () => {
  it('covers the whole browser half', () => {
    expect(files.map(file => relative(clientRoot, file)).sort()).toEqual([
      'QuoteCards.tsx',
      'QuoteDock.tsx',
      'QuotedUserNodeView.tsx',
      'identity.ts',
      'index.ts',
      'locales.ts',
      'quoted-node.ts',
      'reference.ts',
    ])
  })

  it('finds the reads this plugin is built on', () => {
    expect(readNames).toContain('slots')
    expect(readNames).toContain('uiConversation')
  })
})

describe('the declared inject', () => {
  it('names every service the browser half reads as a ctx property', () => {
    const undeclared = files.flatMap(file => [...new Set(ctxReads(file))]
      .filter(name => !core.has(name) && !declared.has(name))
      .map(name => `${relative(clientRoot, file)}: ctx.${name}`))
    expect(undeclared.sort()).toEqual([])
  })

  it('lets a plugin declaring it perform every one of those reads', async () => {
    const outcome = await readsUnderInject(readNames)
    const failed = [...outcome].filter(([, message]) => message !== undefined)
    expect(failed).toEqual([])
  })

  it('is what makes the read work: an undeclared name throws even when provided', async () => {
    const outcome = await readsUnderInject(
      ['undeclaredService'],
      [...declared, 'undeclaredService'],
    )
    expect(outcome.get('undeclaredService'))
      .toBe('cannot get property "undeclaredService" without inject')
  })
})
