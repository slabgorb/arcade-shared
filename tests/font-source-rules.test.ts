// tests/font-source-rules.test.ts
//
// SH2-2 — rule-enforcement tests (TS lang-review checklist) carried forward from
// tempest's vecfont suite (section G) to the font's new home. These scan the shared
// font SOURCE as text (node:fs — arcade-shared is untyped, no `?raw`) and enforce:
//   • #1 Type-safety escapes — no `as any`, `@ts-ignore`, `as unknown as`.
//   • Pure-module discipline — glyph geometry is deterministic: no Math.random,
//     Date, performance.now (the "no wall clock / no randomness" contract vecfont
//     shipped and the extraction must preserve). DOM-freeness of the *built* module
//     is enforced authoritatively by tests/purity.test.ts over dist/.
//
// These FAIL until Dev creates src/font.ts (RED), and stay green only if the verbatim
// extraction keeps the source clean.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const fontSrcPath = fileURLToPath(new URL('../src/font.ts', import.meta.url))

function readFontSource(): string {
  // Missing file must FAIL (not skip) — this is the RED driver + Dev's obligation.
  expect(
    existsSync(fontSrcPath),
    'src/font.ts must exist — Dev extracts tempest vecfont.ts here (SH2-2 AC-1)',
  ).toBe(true)
  return readFileSync(fontSrcPath, 'utf8')
}

describe('@arcade/shared/font source — TS lang-review #1 (type-safety escapes)', () => {
  it('uses no `as any` / `as unknown as` / `@ts-ignore` escapes', () => {
    const src = readFontSource()
    expect(src).not.toMatch(/\bas any\b/)
    expect(src).not.toMatch(/as\s+unknown\s+as/)
    expect(src).not.toMatch(/@ts-ignore/)
  })
})

describe('@arcade/shared/font source — pure-module discipline (deterministic geometry)', () => {
  it('reads no wall clock and no randomness (Math.random / Date / performance.now)', () => {
    const src = readFontSource()
    expect(src).not.toMatch(/Math\.random/)
    expect(src).not.toMatch(/Date\.now|new Date\(/)
    expect(src).not.toMatch(/performance\.now/)
  })
})
