// tests/name-entry-source-rules.test.ts
//
// SH2-13 — rule-enforcement tests for the new pure name-entry subpath, the
// same shape as font-source-rules.test.ts (SH2-2): arcade-shared tests are
// UNTYPED (no root tsconfig; vitest strips types), so type contracts are
// pinned by scanning the SOURCE as text (node:fs) and the packaging contract
// by reading package.json. DOM-freeness of the BUILT module is enforced
// authoritatively by tests/purity.test.ts (name-entry joins PURE_SUBPATHS).
//
// These FAIL until Dev creates src/name-entry.ts and registers the subpath.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const srcPath = fileURLToPath(new URL('../src/name-entry.ts', import.meta.url))

function readSource(): string {
  // Missing file must FAIL (not skip) — this is the RED driver + Dev's obligation.
  expect(
    existsSync(srcPath),
    'src/name-entry.ts must exist — the shared keyboard initials-entry reducer (SH2-13 AC-3)',
  ).toBe(true)
  return readFileSync(srcPath, 'utf8')
}

describe('@arcade/shared/name-entry source — TS lang-review #1 (type-safety escapes)', () => {
  it('uses no `as any` / `as unknown as` / `@ts-ignore` escapes', () => {
    const src = readSource()
    expect(src).not.toMatch(/\bas any\b/)
    expect(src).not.toMatch(/as\s+unknown\s+as/)
    expect(src).not.toMatch(/@ts-ignore/)
  })
})

describe('@arcade/shared/name-entry source — pure-module discipline', () => {
  it('reads no wall clock and no randomness (Math.random / Date / performance.now)', () => {
    const src = readSource()
    expect(src).not.toMatch(/Math\.random/)
    expect(src).not.toMatch(/Date\.now|new Date\(/)
    expect(src).not.toMatch(/performance\.now/)
  })
})

describe('@arcade/shared/name-entry packaging — the subpath is a first-class export', () => {
  it('exports["./name-entry"] maps to the built ESM + types', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    )
    expect(pkg.exports, 'package.json exports map').toBeDefined()
    expect(pkg.exports['./name-entry'], 'exports["./name-entry"] entry').toBeDefined()
    expect(pkg.exports['./name-entry'].import).toBe('./dist/name-entry.js')
    expect(pkg.exports['./name-entry'].types).toBe('./dist/name-entry.d.ts')
  })
})
