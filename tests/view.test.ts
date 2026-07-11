// tests/view.test.ts
//
// Story SH2-10 (epic SH2) — RED phase (Imperator Furiosa / TEA). The shared
// render-surface primitive every canvas game hand-rolls in main.ts: the
// DPR-resize + letterbox concern. This is a BROWSER subpath (@arcade/shared/view):
// resizeToDisplay touches a canvas element, so purity.test.ts must classify `view`
// as browser-exempt (see the SH2-10 block there). `letterbox` is nonetheless PURE
// arithmetic (no DOM) and gets exhaustive node unit tests here (AC-1).
//
// ── CONTRACT Dev implements to turn this GREEN ──────────────────────────────
//
//   // Pure aspect-fit math: the largest `aspect`-ratio box that fits inside a
//   // canvasW × canvasH container, centered. `aspect` is WIDTH / HEIGHT.
//   //   container wider than aspect → height-constrained, bars left/right (x > 0)
//   //   container taller than aspect → width-constrained,  bars top/bottom (y > 0)
//   // `scale` is the uniform fit ratio for a world normalized to UNIT HEIGHT
//   // (so width === scale * aspect, height === scale). See the scale block +
//   // the TEA delivery finding: the height-vs-width normalization is a
//   // reconciliation decision for Dev/Reviewer to ratify + document.
//   interface LetterboxRect { x: number; y: number; width: number; height: number; scale: number }
//   function letterbox(canvasW: number, canvasH: number, aspect: number): LetterboxRect
//
//   // The DOM seam: size the backing store to the resolved DPR, set the CSS box,
//   // return the applied ViewportSize. Folds the `Math.min(2, devicePixelRatio||1)`
//   // cap+guard that tempest/star-wars/asteroids main.ts AND battlezone's
//   // computeLetterbox each hand-write today, so the cabinet stops duplicating it.
//   //   resolvedDpr = Math.min(MAX_DPR, rawDpr || 1)   // MAX_DPR === 2
//   //   canvas.width  = Math.floor(cssW * resolvedDpr) // whole device pixels
//   //   canvas.height = Math.floor(cssH * resolvedDpr)
//   //   canvas.style.width  = `${cssW}px`              // CSS box = the css size given
//   //   canvas.style.height = `${cssH}px`
//   const MAX_DPR = 2
//   interface ViewportSize { cssWidth: number; cssHeight: number; deviceWidth: number; deviceHeight: number; dpr: number }
//   function resizeToDisplay(canvas: CanvasLike, cssW: number, cssH: number, rawDpr: number): ViewportSize
//
// The two primitives compose to reproduce all four games:
//   - tempest / star-wars: resizeToDisplay(canvas, innerW, innerH, dpr)  (fill; no letterbox)
//   - asteroids:           resizeToDisplay(canvas, innerW, innerH, dpr), then letterbox()
//                          gives the drawn margin bars (bars = container − rect)
//   - battlezone:          box = letterbox(innerW, innerH, 4/3); the canvas ELEMENT
//                          is sized to that box via resizeToDisplay(canvas, box.width, box.height, dpr)
//
// RED until src/view.ts exists and exports letterbox / resizeToDisplay / MAX_DPR.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const load = () => import('../src/view')

const EPS = 1e-9

// ── Independent oracle: the centered, maximal aspect-fit box in a container ──────
// Re-derived straight from the spec (NOT from the impl) so these tests specify the
// geometry rather than echo it — the same discipline asteroids' margin.test `fit()`
// and battlezone's viewport.test use. This single box IS the "one letterbox
// contract" the story reconciles asteroids + battlezone onto.
function fitBox(cw: number, ch: number, aspect: number) {
  const containerAspect = cw / ch
  let width: number
  let height: number
  if (containerAspect > aspect) {
    // container wider than the box ratio → height is the constraint (bars L/R)
    height = ch
    width = ch * aspect
  } else {
    // container taller/narrower → width is the constraint (bars T/B)
    width = cw
    height = cw / aspect
  }
  return { x: (cw - width) / 2, y: (ch - height) / 2, width, height }
}

// ── AC-1: letterbox() aspect math ───────────────────────────────────────────────

describe('SH2-10 letterbox — pure aspect-fit geometry (AC-1)', () => {
  it('pillarboxes a wide container — full height, bars left/right', async () => {
    const { letterbox } = await load()
    // 1600×900 (16:9) is wider than 4:3 → height-constrained.
    const box = letterbox(1600, 900, 4 / 3)
    expect(box.height).toBeCloseTo(900, 6) // full height used
    expect(box.width).toBeCloseTo(1200, 6) // 900 × 4/3, NOT the full 1600
    expect(box.x).toBeCloseTo(200, 6) // (1600 − 1200) / 2 — centered side bars
    expect(box.y).toBeCloseTo(0, 6)
  })

  it('letterboxes a tall container — full width, bars top/bottom', async () => {
    const { letterbox } = await load()
    // 1000×1000 (square) is taller than 4:3 → width-constrained.
    const box = letterbox(1000, 1000, 4 / 3)
    expect(box.width).toBeCloseTo(1000, 6) // full width used
    expect(box.height).toBeCloseTo(750, 6) // 1000 ÷ 4/3
    expect(box.x).toBeCloseTo(0, 6)
    expect(box.y).toBeCloseTo(125, 6) // (1000 − 750) / 2 — centered top/bottom bars
  })

  it('fills an exact-aspect container with no bars', async () => {
    const { letterbox } = await load()
    const box = letterbox(1200, 900, 4 / 3) // already 4:3
    expect(box.width).toBeCloseTo(1200, 6)
    expect(box.height).toBeCloseTo(900, 6)
    expect(box.x).toBeCloseTo(0, 6)
    expect(box.y).toBeCloseTo(0, 6)
  })

  it('matches the independent fit oracle across a sweep of sizes and aspects', async () => {
    const { letterbox } = await load()
    const cases: Array<[number, number, number]> = [
      [1920, 1080, 4 / 3],
      [1024, 768, 4 / 3],
      [500, 1200, 4 / 3],
      [1600, 500, 4 / 3],
      [333, 777, 4 / 3],
      [2560, 1440, 16 / 9],
      [800, 800, 21 / 9],
      [640, 640, 1],
    ]
    for (const [w, h, aspect] of cases) {
      const box = letterbox(w, h, aspect)
      const want = fitBox(w, h, aspect)
      expect(box.x, `x @ ${w}×${h}#${aspect}`).toBeCloseTo(want.x, 6)
      expect(box.y, `y @ ${w}×${h}#${aspect}`).toBeCloseTo(want.y, 6)
      expect(box.width, `width @ ${w}×${h}#${aspect}`).toBeCloseTo(want.width, 6)
      expect(box.height, `height @ ${w}×${h}#${aspect}`).toBeCloseTo(want.height, 6)
    }
  })

  it('the fitted box preserves the requested aspect ratio', async () => {
    const { letterbox } = await load()
    for (const [w, h] of [
      [1920, 1080],
      [500, 1200],
      [1600, 500],
    ] as Array<[number, number]>) {
      const box = letterbox(w, h, 4 / 3)
      expect(box.width / box.height).toBeCloseTo(4 / 3, 6)
    }
  })

  it('the box never exceeds the container and always touches a constraining edge (maximal fit)', async () => {
    const { letterbox } = await load()
    const sizes: Array<[number, number]> = [
      [1920, 1080],
      [1024, 768],
      [500, 1200],
      [1600, 500],
      [333, 777],
    ]
    for (const [w, h] of sizes) {
      const box = letterbox(w, h, 4 / 3)
      expect(box.width).toBeLessThanOrEqual(w + EPS)
      expect(box.height).toBeLessThanOrEqual(h + EPS)
      const touchesW = Math.abs(box.width - w) < 1e-6
      const touchesH = Math.abs(box.height - h) < 1e-6
      expect(touchesW || touchesH, `neither edge touched @ ${w}×${h}`).toBe(true)
      // centered: the two opposing bars are equal, so the box origin is half the leftover
      expect(box.x).toBeCloseTo((w - box.width) / 2, 6)
      expect(box.y).toBeCloseTo((h - box.height) / 2, 6)
    }
  })

  it('is pure — deterministic and returns a fresh object each call', async () => {
    const { letterbox } = await load()
    const a = letterbox(1600, 900, 4 / 3)
    const b = letterbox(1600, 900, 4 / 3)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})

// ── AC-1: the `scale` field ─────────────────────────────────────────────────────
// The exact normalization (unit-HEIGHT vs unit-WIDTH) is a reconciliation decision
// flagged to Dev/Reviewer (see session Delivery Findings). These tests pin the
// contract-independent invariants + the PROPOSED height-normalized relation.

describe('SH2-10 letterbox — scale (uniform fit ratio)', () => {
  it('returns a positive, finite scale', async () => {
    const { letterbox } = await load()
    const box = letterbox(1600, 900, 4 / 3)
    expect(Number.isFinite(box.scale)).toBe(true)
    expect(box.scale).toBeGreaterThan(0)
  })

  it('scales linearly with the container (doubling the container doubles the scale)', async () => {
    const { letterbox } = await load()
    const small = letterbox(1200, 900, 4 / 3)
    const big = letterbox(2400, 1800, 4 / 3)
    expect(big.scale).toBeCloseTo(2 * small.scale, 6)
  })

  it('height-normalized fit: width === scale × aspect, height === scale (PROPOSED — see finding)', async () => {
    const { letterbox } = await load()
    for (const [w, h] of [
      [1600, 900],
      [1000, 1000],
      [1200, 900],
    ] as Array<[number, number]>) {
      const box = letterbox(w, h, 4 / 3)
      expect(box.width).toBeCloseTo(box.scale * (4 / 3), 6)
      expect(box.height).toBeCloseTo(box.scale, 6)
    }
  })
})

// ── resizeToDisplay(): the DOM seam (backing store + CSS box) ────────────────────

/** Structural stand-in for the HTMLCanvasElement surface resizeToDisplay mutates —
 *  duck-typed so the seam is testable with a plain object under Vitest's node env
 *  (mirrors battlezone's viewport.test FakeCanvas). */
interface FakeCanvas {
  width: number
  height: number
  style: { width: string; height: string }
}
function fakeCanvas(): FakeCanvas {
  return { width: 0, height: 0, style: { width: '', height: '' } }
}

describe('SH2-10 resizeToDisplay — sizes the backing store to DPR and sets the CSS box', () => {
  it('writes the DPR-scaled backing store to canvas.width / canvas.height', async () => {
    const { resizeToDisplay } = await load()
    const c = fakeCanvas()
    resizeToDisplay(c, 1200, 900, 2)
    expect(c.width).toBe(2400)
    expect(c.height).toBe(1800)
  })

  it('sets the CSS box to the css size given (never × dpr)', async () => {
    const { resizeToDisplay } = await load()
    const c = fakeCanvas()
    resizeToDisplay(c, 1200, 900, 2)
    expect(c.style.width).toBe('1200px')
    expect(c.style.height).toBe('900px')
  })

  it('caps the device pixel ratio at MAX_DPR (2) — a 3× display does not blow up the buffer', async () => {
    const { resizeToDisplay, MAX_DPR } = await load()
    expect(MAX_DPR).toBe(2)
    const c = fakeCanvas()
    resizeToDisplay(c, 1200, 900, 3)
    expect(c.width).toBe(2400) // floor(1200 × 2), NOT 3600
    expect(c.height).toBe(1800)
  })

  it('falls back to dpr 1 when rawDpr is 0 or falsy (TS lang-review #4: `rawDpr || 1`)', async () => {
    const { resizeToDisplay } = await load()
    const c = fakeCanvas()
    resizeToDisplay(c, 1200, 900, 0) // 0 is an invalid dpr, not a real 0× display
    expect(c.width).toBe(1200)
    expect(c.height).toBe(900)
  })

  it('respects a fractional dpr below the cap', async () => {
    const { resizeToDisplay } = await load()
    const c = fakeCanvas()
    resizeToDisplay(c, 1200, 900, 1.5)
    expect(c.width).toBe(1800) // floor(1200 × 1.5)
    expect(c.height).toBe(1350)
  })

  it('floors a fractional backing store to whole device pixels while keeping the CSS box exact', async () => {
    const { resizeToDisplay } = await load()
    const c = fakeCanvas()
    resizeToDisplay(c, 850, 637.5, 1)
    expect(c.width).toBe(850)
    expect(c.height).toBe(637) // floor(637.5) — a backing store must be whole pixels
    expect(Number.isInteger(c.width)).toBe(true)
    expect(Number.isInteger(c.height)).toBe(true)
    expect(c.style.height).toBe('637.5px') // CSS box keeps the exact fractional size
  })

  it('returns a ViewportSize consistent with what it wrote to the canvas', async () => {
    const { resizeToDisplay } = await load()
    const c = fakeCanvas()
    const vp = resizeToDisplay(c, 1200, 900, 3)
    expect(vp.deviceWidth).toBe(c.width)
    expect(vp.deviceHeight).toBe(c.height)
    expect(vp.cssWidth).toBe(1200)
    expect(vp.cssHeight).toBe(900)
    expect(vp.dpr).toBe(2) // the RESOLVED (capped) dpr, not the raw 3
  })

  it('does not leak NaN when the container collapses to zero (minimized window)', async () => {
    const { resizeToDisplay } = await load()
    const c = fakeCanvas()
    resizeToDisplay(c, 0, 800, 1)
    expect(Number.isNaN(c.width)).toBe(false)
    expect(Number.isNaN(c.height)).toBe(false)
    expect(c.width).toBe(0)
  })
})

// ── AC-2 / AC-3: reconciliation — the shared primitives reproduce EACH game's ────
// current, tested numbers. This is the automated guarantee that folding
// margin.ts + viewport.ts changes NO game's behaviour. The oracles below re-derive
// each game's existing contract from first principles (asteroids A2-1 margin.test,
// battlezone bz2-1 viewport.test) so the reconciliation is not circular.

describe('SH2-10 reconciliation — reproduces asteroids margin.ts (world 8192×6144, aspect 4:3)', () => {
  const WORLD_W = 8192
  const WORLD_H = 6144
  const ASPECT = WORLD_W / WORLD_H // === 4/3 exactly

  it('the world aspect is 4:3', () => {
    expect(ASPECT).toBeCloseTo(4 / 3, 12)
  })

  it('letterbox reproduces asteroids fitScale (px-per-world-unit) via box.width / WORLD_W', async () => {
    const { letterbox } = await load()
    // asteroids' fit scale is Math.min(w/WORLD_W, h/WORLD_H); the shared letterbox
    // must let asteroids recover it exactly from the fitted box width.
    const canvases: Array<[number, number]> = [
      [3840, 2160], // 1920×1080 window @ dpr 2
      [1600, 600], // pillarbox (margin.test case)
      [600, 1600], // letterbox (margin.test case)
      [810, 600], // a hair too wide
      [800, 610], // a hair too tall
    ]
    for (const [w, h] of canvases) {
      const box = letterbox(w, h, ASPECT)
      const asteroidsFitScale = Math.min(w / WORLD_W, h / WORLD_H)
      expect(box.width / WORLD_W, `fitScale @ ${w}×${h}`).toBeCloseTo(asteroidsFitScale, 9)
      expect(box.height / WORLD_H, `fitScale (h) @ ${w}×${h}`).toBeCloseTo(asteroidsFitScale, 9)
    }
  })

  it("letterbox.x equals asteroids' side-bar (marginX) so the drawn bars are unchanged", async () => {
    const { letterbox } = await load()
    // At 3840×2160 the asteroids playfield is 2880×2160 centered → 480px side bars.
    const box = letterbox(3840, 2160, ASPECT)
    const asteroidsMarginX = (3840 - WORLD_W * Math.min(3840 / WORLD_W, 2160 / WORLD_H)) / 2
    expect(box.x).toBeCloseTo(asteroidsMarginX, 6)
    expect(box.x).toBeCloseTo(480, 6)
    expect(box.y).toBeCloseTo(0, 6)
    expect(box.width).toBeCloseTo(2880, 6)
    expect(box.height).toBeCloseTo(2160, 6)
  })
})

describe('SH2-10 reconciliation — reproduces battlezone viewport.ts (TARGET_ASPECT 4:3, MAX_DPR 2)', () => {
  const ASPECT = 4 / 3

  it('letterbox reproduces computeLetterbox cssWidth/cssHeight (the pure geometry)', async () => {
    const { letterbox } = await load()
    // Exact goldens lifted from battlezone's bz2-1 viewport.test.
    const cases: Array<[number, number, number, number]> = [
      [1920, 1080, 1440, 1080], // wide → bars L/R
      [600, 1000, 600, 450], // tall → bars T/B
      [800, 800, 800, 600], // square → width-constrained
      [800, 600, 800, 600], // exact 4:3 → no bars
      [850, 1000, 850, 637.5], // fractional height
    ]
    for (const [w, h, cssW, cssH] of cases) {
      const box = letterbox(w, h, ASPECT)
      expect(box.width, `cssWidth @ ${w}×${h}`).toBeCloseTo(cssW, 6)
      expect(box.height, `cssHeight @ ${w}×${h}`).toBeCloseTo(cssH, 6)
    }
  })

  it('resizeToDisplay reproduces computeLetterbox bufferWidth/bufferHeight for the fitted box', async () => {
    const { resizeToDisplay, letterbox } = await load()
    // battlezone sizes the canvas ELEMENT to the box, then the backing store by dpr.
    // computeLetterbox(1200,900,2) → buffer 2400×1800 (box already 4:3).
    const box = letterbox(1200, 900, ASPECT)
    const c = fakeCanvas()
    const vp = resizeToDisplay(c, box.width, box.height, 2)
    expect(c.width).toBe(2400)
    expect(c.height).toBe(1800)
    expect(vp.deviceWidth).toBe(2400)
    expect(vp.deviceHeight).toBe(1800)
  })

  it('resizeToDisplay preserves battlezone MAX_DPR cap and rawDpr||1 guard', async () => {
    const { resizeToDisplay } = await load()
    const capped = fakeCanvas()
    resizeToDisplay(capped, 1200, 900, 3) // computeLetterbox(1200,900,3) → 2400×1800 (capped)
    expect(capped.width).toBe(2400)
    expect(capped.height).toBe(1800)

    const guarded = fakeCanvas()
    resizeToDisplay(guarded, 1200, 900, 0) // computeLetterbox(1200,900,0) → 1200×900 (dpr→1)
    expect(guarded.width).toBe(1200)
    expect(guarded.height).toBe(900)
  })
})

// ── TS lang-review #1: no type-safety escapes in the extracted source ────────────

describe('SH2-10 src/view.ts — introduces no type-safety escapes (TS lang-review #1)', () => {
  const SRC = fileURLToPath(new URL('../src/view.ts', import.meta.url))

  it('src/view.ts exists', () => {
    // RED until Dev creates the module.
    expect(existsSync(SRC), 'arcade-shared/src/view.ts must exist').toBe(true)
  })

  it('uses no `as any` and no @ts-ignore', () => {
    expect(existsSync(SRC), 'src/view.ts must exist before this check is meaningful').toBe(true)
    const src = readFileSync(SRC, 'utf8')
    expect(/\bas any\b/.test(src), 'view.ts must not use `as any`').toBe(false)
    expect(/@ts-ignore/.test(src), 'view.ts must not use @ts-ignore').toBe(false)
  })
})
