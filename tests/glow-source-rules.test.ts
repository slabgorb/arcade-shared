// tests/glow-source-rules.test.ts
//
// SH2-8 — rule-enforcement tests (TS lang-review checklist) for the glow browser
// subpath, mirroring font-source-rules.test.ts. arcade-shared is untyped (esbuild
// strips types, no `?raw`), so these scan src/glow.ts as TEXT via node:fs:
//   • #1 Type-safety escapes — no `as any`, `as unknown as`, `@ts-ignore`.
//   • #5 Module resolution — every RELATIVE import must carry an explicit `.js`
//     extension. tsc `moduleResolution: bundler` compiles fine WITHOUT it, but the
//     shipped ESM artifact then fails native Node ESM (Vite hides the failure). This
//     bit SH2-12 (esc-overlay → './font.js'); the guard makes the rule non-optional
//     for glow the moment Dev adds a sibling import.
//   • #2 No `Function`-typed callback — withGlow's `draw` must be a specific
//     `() => void`, not the loose `Function` type.
//
// These FAIL until Dev creates src/glow.ts (RED), and stay green only if the source
// keeps the type discipline.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const glowSrcPath = fileURLToPath(new URL('../src/glow.ts', import.meta.url))

function readGlowSource(): string {
  // Missing file must FAIL (not skip) — this is the RED driver + Dev's obligation.
  expect(
    existsSync(glowSrcPath),
    'src/glow.ts must exist — Dev builds the glow primitive here (SH2-8 AC-1)',
  ).toBe(true)
  return readFileSync(glowSrcPath, 'utf8')
}

/** Relative import specifiers (`./x`, `../y`) from `import ... from '...'` statements. */
function relativeImportSpecifiers(src: string): string[] {
  const specs: string[] = []
  const re = /\bfrom\s+['"](\.[^'"]*)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) specs.push(m[1])
  return specs
}

describe('@arcade/shared/glow source — TS lang-review #1 (type-safety escapes)', () => {
  it('uses no `as any` / `as unknown as` / `@ts-ignore` escapes', () => {
    const src = readGlowSource()
    expect(src).not.toMatch(/\bas any\b/)
    expect(src).not.toMatch(/as\s+unknown\s+as/)
    expect(src).not.toMatch(/@ts-ignore/)
  })
})

describe('@arcade/shared/glow source — TS lang-review #5 (.js extension on ESM imports)', () => {
  it('every relative import carries an explicit `.js` extension (native ESM survival)', () => {
    const src = readGlowSource()
    const offenders = relativeImportSpecifiers(src).filter((s) => !s.endsWith('.js'))
    expect(
      offenders,
      `relative imports missing the required .js extension (breaks native Node ESM): ${offenders.join(', ')}`,
    ).toEqual([])
  })
})

describe('@arcade/shared/glow source — TS lang-review #2 (specific callback signature)', () => {
  it('withGlow takes a specific `() => void` draw callback, not the loose `Function` type', () => {
    const src = readGlowSource()
    // The draw parameter must be a real function signature. A bare `: Function` is the
    // anti-pattern the checklist forbids (loses arity/return typing).
    expect(src, 'withGlow must be exported').toMatch(/export\s+function\s+withGlow/)
    expect(src, 'no bare `Function`-typed parameter (use `() => void`)').not.toMatch(/:\s*Function\b/)
  })
})
