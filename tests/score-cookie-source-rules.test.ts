// tests/score-cookie-source-rules.test.ts
//
// lb2-2 — rule-enforcement tests (TS lang-review checklist) for the cross-origin score
// surface, mirroring font-source-rules / glow-source-rules. arcade-shared's tests run
// untyped (esbuild strips types), so these scan the SOURCE as text via node:fs.
//
// The rules policed here:
//   #1  Type-safety escapes — no `as any`, `as unknown as`, `@ts-ignore`. The cookie
//       value is untrusted input; casting it into shape instead of validating it is
//       exactly how a forged score would reach a tile.
//   #2  No `Function`-typed callback — the transport's publish/read must carry real
//       signatures, or "swappable adapter" means nothing to the compiler.
//   #5  Module resolution — every RELATIVE import must carry an explicit `.js`
//       extension. `moduleResolution: bundler` compiles fine without it and the shipped
//       ESM artifact then dies under native Node ESM, with Vite hiding the failure. This
//       has already bitten SH2-12 (esc-overlay → './font.js'); if Dev splits the cookie
//       adapter into its own module, the rule binds the moment that import is written.
//   #11 Error handling — `catch (e: unknown)`, never `catch (e: any)`.
//
// The file set is discovered, not hardcoded: whichever module Dev puts the cookie code
// in (src/highscore.ts itself, or a sibling adapter) gets policed, so the guard does not
// prescribe a file layout it has no business prescribing.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('../src/', import.meta.url))
const highscorePath = `${srcDir}highscore.ts`

/** Source files that make up this story's cookie surface: highscore + any adapter. */
function cookieSourceFiles(): Array<{ name: string; text: string }> {
  expect(existsSync(highscorePath), 'src/highscore.ts must exist').toBe(true)

  const files = readdirSync(srcDir)
    .filter((f) => f.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(`${srcDir}${name}`, 'utf8') }))

  // highscore.ts always, plus any module that touches the cookie surface.
  return files.filter(
    ({ name, text }) =>
      name === 'highscore.ts' || /arcade-hi-|document\s*\.\s*cookie/.test(text),
  )
}

/** Relative import specifiers (`./x`, `../y`) from `import ... from '...'` statements. */
function relativeImportSpecifiers(src: string): string[] {
  const specs: string[] = []
  const re = /\bfrom\s+['"](\.[^'"]*)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) specs.push(m[1])
  return specs
}

describe('lb2-2 source — the cookie surface is discovered', () => {
  it('finds the source that publishes/reads the score cookie', () => {
    // Guards the guard: if this returned nothing, every rule below would pass vacuously.
    const files = cookieSourceFiles()
    expect(files.length).toBeGreaterThan(0)

    const surface = files.map((f) => f.text).join('\n')
    expect(
      surface,
      'no source references the `arcade-hi-<gameId>` cookie — the publish is not implemented',
    ).toMatch(/arcade-hi-/)
  })
})

describe('lb2-2 source — TS lang-review #1 (type-safety escapes)', () => {
  it('uses no `as any` / `as unknown as` / `@ts-ignore` on the untrusted cookie value', () => {
    for (const { name, text } of cookieSourceFiles()) {
      expect(text, `${name}: \`as any\``).not.toMatch(/\bas any\b/)
      expect(text, `${name}: \`as unknown as\``).not.toMatch(/as\s+unknown\s+as/)
      expect(text, `${name}: \`@ts-ignore\``).not.toMatch(/@ts-ignore/)
    }
  })
})

describe('lb2-2 source — TS lang-review #2 (no loose `Function` type)', () => {
  it('types the transport’s publish/read with real signatures', () => {
    for (const { name, text } of cookieSourceFiles()) {
      expect(text, `${name}: bare \`Function\` type`).not.toMatch(/:\s*Function\b/)
    }
  })
})

describe('lb2-2 source — TS lang-review #5 (ESM relative imports carry `.js`)', () => {
  it('every relative import ends in `.js`', () => {
    // tsc's bundler resolution compiles an extensionless './cookie' happily; the shipped
    // dist/ ESM then fails to resolve under native Node. Vite hides it in dev, so only
    // this guard catches it before a consumer does.
    for (const { name, text } of cookieSourceFiles()) {
      for (const spec of relativeImportSpecifiers(text)) {
        expect(spec.endsWith('.js'), `${name}: relative import '${spec}' must end in '.js'`).toBe(
          true,
        )
      }
    }
  })
})

describe('lb2-2 source — TS lang-review #11 (error handling)', () => {
  it('never writes `catch (e: any)`', () => {
    for (const { name, text } of cookieSourceFiles()) {
      expect(text, `${name}: \`catch (e: any)\``).not.toMatch(/catch\s*\(\s*\w+\s*:\s*any\s*\)/)
    }
  })
})
