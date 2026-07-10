// tests/purity.test.ts
//
// SH2-2 (epic SH2) — the PURITY GUARD. ADR-0003 widened the @arcade/shared charter
// to "pure core + explicitly-flagged browser helpers" and made THIS test the fence:
// any *pure* subpath that leaks a DOM global fails the guard; browser subpaths are
// exempt by name.
//
// WHY source-text over dist/ (not a type/static check): arcade-shared has no root
// tsconfig/vitest config and its tests run in a node env with types stripped by
// esbuild (design §8; memory: arcade-shared-tests-untyped). A compile-only guard
// would be silently erased. The only honest guarantee that the *delivered artifact*
// is DOM-free is to read the built dist/*.js as text and grep. So this guard runs
// against `dist/`, which means `npm run build` (or `prepare`) must run first.
//
// ── DELIBERATE DEVIATION (flagged to Architect — see session Design Deviations) ──
// ADR-0003 / design §3 list the fail-set as
//   document | window | canvas | FontFace | requestAnimationFrame
// but the *already-shipped* pure subpath `loop` (dist/loop.js, lifted byte-for-byte
// from asteroids in SH-5) calls requestAnimationFrame/cancelAnimationFrame inside
// createLoop. Including rAF would make the guard FAIL on the current pure core —
// which directly contradicts AC-2 ("it passes for the current pure core"). Per the
// spec-authority hierarchy (story scope AC > design > ADR), AC-2's "passes for the
// current core" wins, so this guard's fail-set is:
//   document | window | canvas | FontFace
// These are the DOM/render/async-load globals a pure *font* (glyph geometry + layout)
// must never touch — the guard keeps its teeth for `font` while staying green on the
// core as it exists today. The rAF/loop classification is raised for the Architect to
// ratify (amend the ADR, or split createLoop into a browser subpath in a later story).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Pure subpaths per ADR-0003 Amendment 1 — must remain DOM-free.
// SH2-12: `pause` (the game-agnostic frozen-frame gate) joins the pure core — it
// is a boolean toggle + a thunk-selector with no DOM, so the guard polices it.
const PURE_SUBPATHS = ['math3d', 'rng', 'highscore', 'loop', 'font', 'pause'] as const

// Browser subpaths (ADR-0003) — explicitly flagged as canvas/DOM-touching and so
// EXEMPT from the purity guard. SH2-12 adds `esc-overlay` (draws the pause panel
// + keybind card); SH2-8 adds `glow` (the neon-vector primitive: withGlow +
// glowPolyline). These must never be added to PURE_SUBPATHS.
const BROWSER_SUBPATHS = ['esc-overlay', 'glow'] as const

// DOM/render/async-load globals a pure subpath must never reference. (rAF excluded —
// see the deviation note above; loop legitimately owns frame scheduling.)
const DOM_GLOBALS = ['document', 'window', 'canvas', 'FontFace'] as const

const distPath = (name: string) =>
  fileURLToPath(new URL(`../dist/${name}.js`, import.meta.url))

/** Whole-word scan: returns the DOM globals a source text references (empty = clean). */
function domGlobalsIn(source: string, globals: readonly string[] = DOM_GLOBALS): string[] {
  return globals.filter((g) => new RegExp(`\\b${g}\\b`).test(source))
}

describe('purity guard — detector is honest (not vacuous)', () => {
  it('flags a source that touches a DOM global', () => {
    const dirty = 'export function make(){ const c = document.createElement("canvas"); return c }'
    // catches BOTH `document` and `canvas`
    expect(domGlobalsIn(dirty).sort()).toEqual(['canvas', 'document'])
  })

  it('clears a source that is pure arithmetic', () => {
    const clean = 'export const add = (a, b) => a + b\nexport const PI = 3.14159'
    expect(domGlobalsIn(clean)).toEqual([])
  })

  it('does not false-positive on a substring (e.g. `windowStart`)', () => {
    const src = 'const windowStart = 0; const documentId = 7; const myCanvasThing = 1'
    expect(domGlobalsIn(src)).toEqual([])
  })
})

describe('purity guard — every pure subpath is built and DOM-free (AC-2)', () => {
  it('the pure core (incl. font) is built into dist/ — prepare/build ran', () => {
    // AC-1: `font` is added to the prepare build → dist/font.js must exist.
    const missing = PURE_SUBPATHS.filter((s) => !existsSync(distPath(s)))
    expect(
      missing,
      `missing built pure subpaths in dist/ (run \`npm run build\` first): ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('no pure subpath references a DOM global', () => {
    const violations: string[] = []
    for (const sub of PURE_SUBPATHS) {
      const file = distPath(sub)
      if (!existsSync(file)) {
        violations.push(`${sub}.js is not built (cannot verify purity)`)
        continue
      }
      const source = readFileSync(file, 'utf8')
      for (const g of domGlobalsIn(source)) {
        violations.push(`dist/${sub}.js references DOM global \`${g}\``)
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })
})

describe('purity guard — package exports declare font (AC-1)', () => {
  it('exports["./font"] maps to the built ESM + types', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    )
    expect(pkg.exports, 'package.json exports map').toBeDefined()
    expect(pkg.exports['./font'], 'exports["./font"] entry').toBeDefined()
    expect(pkg.exports['./font'].import).toBe('./dist/font.js')
    expect(pkg.exports['./font'].types).toBe('./dist/font.d.ts')
  })
})

describe('SH2-12 — pause (pure) + esc-overlay (browser) subpaths', () => {
  const pkg = () =>
    JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

  it('pause is policed as PURE and esc-overlay is NOT (browser-exempt)', () => {
    // The classification itself is the invariant: esc-overlay must never be added
    // to the pure set (it legitimately draws to a canvas), and pause must never be
    // dropped from it (it must stay DOM-free forever).
    expect(PURE_SUBPATHS as readonly string[]).toContain('pause')
    expect(PURE_SUBPATHS as readonly string[]).not.toContain('esc-overlay')
    expect(BROWSER_SUBPATHS as readonly string[]).toContain('esc-overlay')
  })

  it('exports["./pause"] maps to the built pure ESM + types', () => {
    const p = pkg()
    expect(p.exports['./pause'], 'exports["./pause"] entry').toBeDefined()
    expect(p.exports['./pause'].import).toBe('./dist/pause.js')
    expect(p.exports['./pause'].types).toBe('./dist/pause.d.ts')
  })

  it('exports["./esc-overlay"] maps to the built browser ESM + types', () => {
    const p = pkg()
    expect(p.exports['./esc-overlay'], 'exports["./esc-overlay"] entry').toBeDefined()
    expect(p.exports['./esc-overlay'].import).toBe('./dist/esc-overlay.js')
    expect(p.exports['./esc-overlay'].types).toBe('./dist/esc-overlay.d.ts')
  })

  it('every browser subpath is actually built into dist/', () => {
    const missing = BROWSER_SUBPATHS.filter((s) => !existsSync(distPath(s)))
    expect(missing, `missing built browser subpaths in dist/: ${missing.join(', ')}`).toEqual([])
  })
})

describe('SH2-8 — glow (browser subpath)', () => {
  const pkg = () =>
    JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

  it('glow is classified BROWSER (canvas-exempt) and NEVER policed as pure', () => {
    // glow legitimately touches a canvas ctx (strokeStyle/shadowBlur), so it must be
    // browser-exempt — and must never be smuggled into the DOM-free pure set.
    expect(BROWSER_SUBPATHS as readonly string[]).toContain('glow')
    expect(PURE_SUBPATHS as readonly string[]).not.toContain('glow')
  })

  it('exports["./glow"] maps to the built browser ESM + types', () => {
    const p = pkg()
    expect(p.exports['./glow'], 'exports["./glow"] entry').toBeDefined()
    expect(p.exports['./glow'].import).toBe('./dist/glow.js')
    expect(p.exports['./glow'].types).toBe('./dist/glow.d.ts')
  })

  it('glow is built into dist/ (prepare/build ran)', () => {
    expect(existsSync(distPath('glow')), 'dist/glow.js must exist — run `npm run build`').toBe(true)
  })
})
