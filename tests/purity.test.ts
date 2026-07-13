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
// SH2-13 adds 'name-entry' (the shared keyboard initials-entry reducer): a
// pure string reducer with no DOM surface at all, so it joins the fence.
// SH2-12: `pause` (the game-agnostic frozen-frame gate) joins the pure core — it
// is a boolean toggle + a thunk-selector with no DOM, so the guard polices it.
//
// ── lb2-2 / ADR-0004: `highscore` LEAVES the pure set ────────────────────────
// ADR-0004 installs the cross-origin score publish inside `save()`/`load()` in
// makeHighScoreStorage — and that publish writes `document.cookie`. `highscore`
// therefore touches a DOM global and can no longer be policed as pure.
//
// This is FORCED, not chosen. The AC requires the four shipped games to be fixed by a
// version bump with zero code changes, which means the default cookie transport must be
// wired inside the factory the games already call. There is no arrangement in which
// `highscore`'s import closure stays DOM-free AND the games need no code.
//
// It follows the rule this guard already states for `view` (SH2-10): **a subpath is
// classified by its dirtiest export.** The pure table logic (qualifiesForHighScore /
// insertHighScore / highScoreKey / isHighScoreRow) is unchanged and still exported —
// but the subpath as a whole now reaches the DOM, and saying otherwise would make the
// fence a lie. Reclassifying is the honest move; the alternative (hiding `document`
// behind an internal import to keep the PURE label) is exactly the smuggling the
// transitive guard below now forbids.
//
// Raised to the Architect as a blocking Delivery Finding: ADR-0004 never mentions the
// ADR-0003 purity fence, and this is a real consequence of it that wants ratifying.
const PURE_SUBPATHS = ['math3d', 'rng', 'loop', 'font', 'name-entry', 'pause'] as const

// Browser subpaths (ADR-0003) — explicitly flagged as canvas/DOM-touching and so
// EXEMPT from the purity guard. SH2-12 adds `esc-overlay` (draws the pause panel
// + keybind card); SH2-8 adds `glow` (the neon-vector primitive: withGlow +
// glowPolyline). SH2-10 adds `view` (resizeToDisplay mutates a canvas element's
// backing store + CSS box). SH2-16 adds `audio` (the WebAudio SFX engine — touches
// AudioContext, a browser global). lb2-2 adds `highscore` (save()/load() publish the
// top score to document.cookie — ADR-0004). These must never be added to PURE_SUBPATHS.
// SH2-18 adds `synth` (the WebAudio SYNTHESIS skeleton — touches AudioContext too).
// It is the SIBLING of `audio`, not a replacement: `audio` plays SAMPLES (.wav buffers)
// and cannot host oscillator synthesis, which is why battlezone and red-baron could
// never adopt it. Both are browser subpaths; neither may enter the pure set.
const BROWSER_SUBPATHS = ['esc-overlay', 'glow', 'view', 'audio', 'highscore', 'synth'] as const

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

// ---------------------------------------------------------------------------
// lb2-2 — the fence must be TRANSITIVE, or it can be walked around
// ---------------------------------------------------------------------------
//
// The guard above greps ONE file. That is a loophole: move `document.cookie` into
// `src/cookie.ts`, import it from a "pure" subpath, and dist/<pure>.js contains no
// `document` token at all — the guard passes while the subpath drags the DOM in behind
// it. Nothing caught that before, because no pure subpath had any relative imports.
// lb2-2 is the first story with a reason to want one, so the fence gets closed now:
// a pure subpath must be DOM-free through its WHOLE import closure, not just its own
// top-level text.

/** Follow relative imports from a built dist file and return every .js in its closure. */
function importClosure(entry: string): string[] {
  const seen = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)

    const source = readFileSync(file, 'utf8')
    const re = /\bfrom\s+['"](\.[^'"]*)['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(source)) !== null) {
      queue.push(fileURLToPath(new URL(m[1], `file://${file}`)))
    }
  }
  return [...seen]
}

describe('purity guard — the fence is transitive (lb2-2)', () => {
  it('the closure walker is honest — it follows a relative import', () => {
    // Prove the walker actually traverses, so the guard below cannot pass vacuously by
    // silently finding nothing. esc-overlay imports './font.js' (SH2-12).
    const closure = importClosure(distPath('esc-overlay'))
    expect(closure.length, 'esc-overlay must pull font.js into its closure').toBeGreaterThan(1)
    expect(closure.some((f) => f.endsWith('font.js'))).toBe(true)
  })

  it('no pure subpath reaches a DOM global THROUGH an import either', () => {
    const violations: string[] = []
    for (const sub of PURE_SUBPATHS) {
      for (const file of importClosure(distPath(sub))) {
        for (const g of domGlobalsIn(readFileSync(file, 'utf8'))) {
          const via = file.endsWith(`${sub}.js`) ? 'directly' : `via ${file.split('/').pop()}`
          violations.push(`pure subpath \`${sub}\` references DOM global \`${g}\` ${via}`)
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })
})

describe('lb2-2 / ADR-0004 — highscore is reclassified as a BROWSER subpath', () => {
  it('highscore is browser-exempt and NEVER policed as pure', () => {
    // save()/load() publish the top score to document.cookie so the lobby can read it
    // across the origin split. A subpath is classified by its dirtiest export, so
    // highscore belongs with view/glow/audio — and must never be smuggled back into the
    // DOM-free pure set to make a red guard go green.
    expect(BROWSER_SUBPATHS as readonly string[]).toContain('highscore')
    expect(PURE_SUBPATHS as readonly string[]).not.toContain('highscore')
  })

  it('still exports ./highscore as built ESM + types — the games’ import is unchanged', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    )
    expect(pkg.exports['./highscore'].import).toBe('./dist/highscore.js')
    expect(pkg.exports['./highscore'].types).toBe('./dist/highscore.d.ts')
  })

  it('the package version is bumped past the 0.12.1 baseline this story starts from', () => {
    // The lobby cannot consume the new read until a tag ships: games and the lobby pin
    // @arcade/shared as a git-URL TAG, so unreleased source is invisible to them.
    const parse = (v: string): [number, number, number] => {
      const [maj, min, pat] = v.split('.').map((n) => Number.parseInt(n, 10))
      return [maj, min, pat]
    }
    const gt = (a: [number, number, number], b: [number, number, number]): boolean => {
      for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
      return false
    }
    const version = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ).version as string
    expect(/^\d+\.\d+\.\d+$/.test(version), `version "${version}" must be plain semver`).toBe(true)
    expect(gt(parse(version), [0, 12, 1]), `version "${version}" must be bumped past 0.12.1`).toBe(
      true,
    )
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

describe('SH2-10 — view (browser subpath)', () => {
  const pkg = () =>
    JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

  it('view is classified BROWSER (canvas-exempt) and NEVER policed as pure', () => {
    // resizeToDisplay writes canvas.width/height + canvas.style — it legitimately
    // touches a canvas element, so `view` must be browser-exempt and must never be
    // smuggled into the DOM-free pure set (its `letterbox` half is pure math, but a
    // subpath is classified by its dirtiest export).
    expect(BROWSER_SUBPATHS as readonly string[]).toContain('view')
    expect(PURE_SUBPATHS as readonly string[]).not.toContain('view')
  })

  it('exports["./view"] maps to the built browser ESM + types', () => {
    const p = pkg()
    expect(p.exports['./view'], 'exports["./view"] entry').toBeDefined()
    expect(p.exports['./view'].import).toBe('./dist/view.js')
    expect(p.exports['./view'].types).toBe('./dist/view.d.ts')
  })

  it('view is built into dist/ (prepare/build ran)', () => {
    expect(existsSync(distPath('view')), 'dist/view.js must exist — run `npm run build`').toBe(true)
  })
})

describe('SH2-16 — audio (browser subpath)', () => {
  const pkg = () =>
    JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

  it('audio is classified BROWSER (AudioContext-exempt) and NEVER policed as pure', () => {
    // The engine touches AudioContext (a browser global) — like glow/view it must be
    // browser-exempt and must never be smuggled into the DOM-free pure set. The pure
    // core (math3d/rng/highscore/loop/font/…) still fails the guard on any DOM ref;
    // that the detector has teeth is proven by the "detector is honest" block above.
    expect(BROWSER_SUBPATHS as readonly string[]).toContain('audio')
    expect(PURE_SUBPATHS as readonly string[]).not.toContain('audio')
  })

  it('exports["./audio"] maps to the built browser ESM + types (AC-1)', () => {
    const p = pkg()
    expect(p.exports['./audio'], 'exports["./audio"] entry').toBeDefined()
    expect(p.exports['./audio'].import).toBe('./dist/audio.js')
    expect(p.exports['./audio'].types).toBe('./dist/audio.d.ts')
  })

  it('audio is built into dist/ (prepare/build ran)', () => {
    expect(existsSync(distPath('audio')), 'dist/audio.js must exist — run `npm run build`').toBe(
      true,
    )
  })

  it('the package version is bumped past the 0.11.0 baseline this story starts from (AC-1)', () => {
    // AC-1 requires a version bump (design/practice: 0.11.0 → 0.12.0). Compared as a
    // semver triple so any bump ≥ 0.12.0 satisfies it — not pinned to an exact number.
    const parse = (v: string): [number, number, number] => {
      const [maj, min, pat] = v.split('.').map((n) => Number.parseInt(n, 10))
      return [maj, min, pat]
    }
    const gt = (a: [number, number, number], b: [number, number, number]): boolean => {
      for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
      return false
    }
    const version = pkg().version as string
    expect(/^\d+\.\d+\.\d+$/.test(version), `version "${version}" must be plain semver`).toBe(true)
    expect(gt(parse(version), [0, 11, 0]), `version "${version}" must be bumped past 0.11.0`).toBe(
      true,
    )
  })
})

describe('SH2-18 — synth (browser subpath)', () => {
  const pkg = () =>
    JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

  it('synth is classified BROWSER (AudioContext-exempt) and NEVER policed as pure (AC-2)', () => {
    // The synthesis skeleton builds an AudioContext, oscillators and gain nodes — like
    // audio/glow/view it must be browser-exempt, and must never be smuggled into the
    // DOM-free pure set to make a red guard go green.
    expect(BROWSER_SUBPATHS as readonly string[]).toContain('synth')
    expect(PURE_SUBPATHS as readonly string[]).not.toContain('synth')
  })

  it('synth and audio are SIBLINGS — both shipped, neither replacing the other (AC-1)', () => {
    // The whole premise of the story: /audio is a SAMPLE player and cannot host
    // oscillator synthesis, so extracting /synth does not obsolete it. If a later
    // change ever deletes ./audio in favour of ./synth, this fails — deliberately.
    const p = pkg()
    expect(p.exports['./audio'], './audio must survive — /synth does not replace it').toBeDefined()
    expect(p.exports['./synth'], './synth ships alongside it').toBeDefined()
  })

  it('exports["./synth"] maps to the built browser ESM + types (AC-1)', () => {
    const p = pkg()
    expect(p.exports['./synth'], 'exports["./synth"] entry').toBeDefined()
    expect(p.exports['./synth'].import).toBe('./dist/synth.js')
    expect(p.exports['./synth'].types).toBe('./dist/synth.d.ts')
  })

  it('synth is built into dist/ (prepare/build ran)', () => {
    expect(existsSync(distPath('synth')), 'dist/synth.js must exist — run `npm run build`').toBe(
      true,
    )
  })

  it('the package version is bumped past the 0.13.2 baseline this story starts from (AC-1)', () => {
    // battlezone and red-baron pin @arcade/shared as a git-URL ref, so unreleased
    // source is invisible to them: without a bump there is nothing for them to adopt.
    const parse = (v: string): [number, number, number] => {
      const [maj, min, pat] = v.split('.').map((n) => Number.parseInt(n, 10))
      return [maj, min, pat]
    }
    const gt = (a: [number, number, number], b: [number, number, number]): boolean => {
      for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
      return false
    }
    const version = pkg().version as string
    expect(/^\d+\.\d+\.\d+$/.test(version), `version "${version}" must be plain semver`).toBe(true)
    expect(gt(parse(version), [0, 13, 2]), `version "${version}" must be bumped past 0.13.2`).toBe(
      true,
    )
  })
})
