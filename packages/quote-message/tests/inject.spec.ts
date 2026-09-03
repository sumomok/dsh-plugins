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
 *
 * The reverse direction is checked too. An array `inject` is hard: a plugin
 * that declares a service nobody provides never becomes active, so `apply`
 * never runs and every seat this package registers is simply absent — the same
 * "nothing happens" the missing declaration produced, from the opposite cause.
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
 * Entries this package declares without reading as a property.
 *
 * A name here buys the plugin its ordering guarantee — the fiber waits for the
 * service and reloads when it changes — and is then reached through
 * `ctx.get(name)`, which resolves without any declaration. Every entry is
 * checked below to actually occur in a `ctx.get(...)` call, so the list cannot
 * become a blanket excuse for a declaration nothing uses.
 */
const declaredForOrdering = new Set(['inputTriggers'])

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
 * Parse one source the way the scanners below expect it.
 * @param fileName - name the parser reports; its extension picks the dialect.
 * @param text - the source text.
 * @returns the parsed file, with parent pointers set.
 */
function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

/**
 * Identifiers that hold the context in one file: `ctx` plus every `const c =
 * ctx` alias, and aliases of those, to a fixed point.
 *
 * An alias is collected for the whole file rather than for the scope it was
 * declared in. That over-collects rather than under-collects, which is the
 * safe direction for a gate: the cost of a wrong extra name is one spurious
 * `inject` entry, and the cost of a missed one is the bug this suite exists
 * for.
 *
 * @param source - the parsed file.
 * @returns every identifier that names the context in it.
 */
function contextAliases(source: ts.SourceFile): ReadonlySet<string> {
  const names = new Set(['ctx'])
  for (let grew = true; grew;) {
    grew = false
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && node.initializer !== undefined && ts.isIdentifier(node.initializer)
        && names.has(node.initializer.text) && !names.has(node.name.text)) {
        names.add(node.name.text)
        grew = true
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return names
}

/**
 * Service names one source reaches on the context, in every syntactic form
 * that ends in a proxy `get` trap: `ctx.name`, `ctx['name']`, the alias forms
 * of both, and `const { name } = ctx` (destructuring reads each property, and
 * a rename reads the source name, so `{ uiConversation: uc }` counts as
 * `uiConversation`).
 *
 * Parsed rather than matched with a regular expression, because both text
 * alternatives are wrong here: a scan counts `ctx.uiConversation` where it
 * appears in this package's own module JSDoc, and `\bctx\.` still matches
 * inside `actx.bail` (`reference.ts` has one).
 *
 * A rest element (`const { ...rest } = ctx`) is not counted: it enumerates own
 * keys instead of reading a service by name, and no source here does it.
 *
 * @param fileName - name the parser reports; its extension picks the dialect.
 * @param text - the source text.
 * @returns the service names the source reads, with duplicates.
 */
function ctxReadsIn(fileName: string, text: string): string[] {
  const source = parse(fileName, text)
  const held = contextAliases(source)
  const onCtx = (node: ts.Node): boolean => ts.isIdentifier(node) && held.has(node.text)
  const names: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && onCtx(node.expression)) {
      names.push(node.name.text)
    } else if (ts.isElementAccessExpression(node) && onCtx(node.expression)
      && ts.isStringLiteralLike(node.argumentExpression)) {
      names.push(node.argumentExpression.text)
    } else if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
      && node.initializer !== undefined && onCtx(node.initializer)) {
      for (const element of node.name.elements) {
        if (element.dotDotDotToken !== undefined) continue
        const key = element.propertyName ?? element.name
        if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) names.push(key.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return names
}

/**
 * Service names one source resolves through `ctx.get(name)`, which needs no
 * declaration.
 * @param fileName - name the parser reports; its extension picks the dialect.
 * @param text - the source text.
 * @returns the string-literal names passed to `get` on the context.
 */
function ctxGetsIn(fileName: string, text: string): string[] {
  const source = parse(fileName, text)
  const held = contextAliases(source)
  const names: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'get'
      && ts.isIdentifier(node.expression.expression)
      && held.has(node.expression.expression.text)) {
      const [first] = node.arguments
      if (first !== undefined && ts.isStringLiteralLike(first)) names.push(first.text)
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
 * the read succeeded. Empty when the reader never became active, which is why
 * every caller asserts the keys rather than only the failures.
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
const readOf = (file: string): string[] => ctxReadsIn(file, readFileSync(file, 'utf8'))
const readNames = [...new Set(files.flatMap(readOf))].sort()
const getNames = new Set(files.flatMap(file => ctxGetsIn(file, readFileSync(file, 'utf8'))))

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

describe('the ctx read scanner', () => {
  const probe = (text: string): string[] => ctxReadsIn('probe.ts', text)

  it('sees a plain property read', () => {
    expect(probe('apply(ctx) { ctx.uiConversation.binding(id) }')).toEqual(['uiConversation'])
  })

  it('sees a string-keyed read', () => {
    expect(probe('apply(ctx) { ctx["uiConversation"] }')).toEqual(['uiConversation'])
  })

  it('sees a destructured read', () => {
    expect(probe('apply(ctx) { const { uiConversation } = ctx }')).toEqual(['uiConversation'])
  })

  it('reports the source name of a renamed destructure, not the local one', () => {
    expect(probe('apply(ctx) { const { uiConversation: uc } = ctx; uc.binding(id) }'))
      .toEqual(['uiConversation'])
  })

  it('follows a plain alias of the context', () => {
    expect(probe('apply(ctx) { const c = ctx; c.uiConversation.binding(id) }'))
      .toEqual(['uiConversation'])
  })

  it('follows an alias of an alias, and destructures off it', () => {
    expect(probe('apply(ctx) { const c = ctx; const d = c; const { slots } = d; d.locale }').sort())
      .toEqual(['locale', 'slots'])
  })

  it('ignores an identifier that merely ends in ctx', () => {
    expect(probe('const actx = other; actx.bail(actx, "e")')).toEqual([])
  })

  it('ignores names that occur only in a comment or a string', () => {
    expect(probe('// ctx.uiConversation is read in identity.ts\nconst s = "ctx.slots"'))
      .toEqual([])
  })

  it('ignores a rest element, which enumerates rather than reads a name', () => {
    expect(probe('apply(ctx) { const { ...rest } = ctx }')).toEqual([])
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
    const undeclared = files.flatMap(file => [...new Set(readOf(file))]
      .filter(name => !core.has(name) && !declared.has(name))
      .map(name => `${relative(clientRoot, file)}: ctx.${name}`))
    expect(undeclared.sort()).toEqual([])
  })

  it('declares nothing the browser half never reaches', () => {
    const unread = [...declared]
      .filter(name => !readNames.includes(name) && !declaredForOrdering.has(name))
    expect(unread.sort()).toEqual([])
  })

  it('reaches through ctx.get every entry the ordering list excuses', () => {
    expect([...declaredForOrdering].filter(name => !getNames.has(name)).sort()).toEqual([])
  })

  it('lets a plugin declaring it perform every one of those reads', async () => {
    const outcome = await readsUnderInject(readNames)
    expect([...outcome.keys()].sort()).toEqual([...readNames].sort())
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
