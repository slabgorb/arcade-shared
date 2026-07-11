// @arcade/shared/view — the render-surface primitive (BROWSER subpath, SH2-10, epic SH2).
//
// Every canvas cabinet hand-writes the same DPR-resize dance in main.ts:
//   dpr = Math.min(2, window.devicePixelRatio || 1)
//   canvas.width  = Math.floor(cssW * dpr); canvas.height = Math.floor(cssH * dpr)
//   canvas.style.width = `${cssW}px`;        canvas.style.height = `${cssH}px`
// tempest/star-wars/asteroids run it byte-identically (fill the window); battlezone's
// viewport.ts wraps the same math to letterbox the canvas ELEMENT to a fixed aspect,
// and asteroids' margin.ts derives its drawn margin bars from the same aspect fit.
// This module owns both halves once, for all of them:
//
//   resizeToDisplay(canvas, cssW, cssH, rawDpr)  — the DOM seam. Resolves the DPR
//     (cap + guard), sizes the backing store to whole device pixels, sets the CSS
//     box, and returns the resolved ViewportSize.
//   letterbox(canvasW, canvasH, aspect)          — PURE aspect-fit math. The largest
//     `aspect`-ratio rectangle that fits inside canvasW×canvasH, centered. battlezone
//     sizes its canvas element to this box; asteroids draws its margin bars as the
//     container minus this box.
//
// BROWSER subpath (ADR-0003): resizeToDisplay mutates a canvas element, so `view` is
// EXEMPT from the pure-core purity guard. It references no DOM *global* — it only
// touches the CanvasLike the caller hands in — but a subpath is classified by its
// dirtiest export, and this one writes to a canvas. `letterbox` is nonetheless pure
// arithmetic and is unit-tested in node.

/** HiDPI backing-store cap. A 3×/4× display would otherwise blow the backing store
 *  up 9×/16×; 2× is the crispness/cost sweet spot every cabinet already used. */
export const MAX_DPR = 2

/** A screen-space rectangle plus its uniform fit scale (device or CSS px — the caller
 *  decides which space it passed in). Origin top-left. */
export interface LetterboxRect {
  /** Left offset of the fitted box inside the container (the left/pillar bar width). */
  readonly x: number
  /** Top offset of the fitted box inside the container (the top/letter bar height). */
  readonly y: number
  /** Width of the fitted, aspect-preserving box. */
  readonly width: number
  /** Height of the fitted, aspect-preserving box. */
  readonly height: number
  /** Uniform fit scale for a world normalised to UNIT HEIGHT: `width === scale * aspect`
   *  and `height === scale`. A game with a concrete world recovers its px-per-world-unit
   *  as `width / WORLD_W` (=== `height / WORLD_H`). */
  readonly scale: number
}

/**
 * The largest `aspect`-ratio (WIDTH / HEIGHT) box that fits inside a canvasW × canvasH
 * container, centered. Pure — no DOM, no state, no time.
 *
 *   container wider than aspect  → height-constrained, bars left/right (x > 0)
 *   container taller than aspect → width-constrained,  bars top/bottom (y > 0)
 *   container exactly aspect     → fills it, no bars (x === y === 0)
 */
export function letterbox(canvasW: number, canvasH: number, aspect: number): LetterboxRect {
  const containerAspect = canvasW / canvasH
  let width: number
  let height: number
  if (containerAspect > aspect) {
    // Container wider than the box ratio → height is the constraint (bars left/right).
    height = canvasH
    width = canvasH * aspect
  } else {
    // Container taller/narrower than the ratio → width is the constraint (bars T/B).
    width = canvasW
    height = canvasW / aspect
  }
  return {
    x: (canvasW - width) / 2,
    y: (canvasH - height) / 2,
    width,
    height,
    scale: height,
  }
}

/** The minimal HTMLCanvasElement surface resizeToDisplay mutates — duck-typed so the
 *  seam is testable with a plain object outside a DOM (Vitest's `node` env). */
export interface CanvasLike {
  width: number
  height: number
  style: { width: string; height: string }
}

/** The resolved display sizing resizeToDisplay applied and returned. */
export interface ViewportSize {
  /** CSS-pixel width of the visible canvas box (the css size passed in). */
  readonly cssWidth: number
  /** CSS-pixel height of the visible canvas box. */
  readonly cssHeight: number
  /** Backing-store width in whole device pixels (`floor(cssWidth * dpr)`). */
  readonly deviceWidth: number
  /** Backing-store height in whole device pixels. */
  readonly deviceHeight: number
  /** The resolved (capped + guarded) device pixel ratio actually applied. */
  readonly dpr: number
}

/**
 * Size a canvas for the display: resolve the DPR, write the whole-pixel backing store
 * to canvas.width/height, write the CSS box (in px) to canvas.style, and return the
 * ViewportSize applied.
 *
 * The DPR is resolved as `Math.min(MAX_DPR, rawDpr || 1)` — folding the cap + falsy
 * guard every cabinet hand-wrote. A 0 / NaN / undefined `rawDpr` is an invalid ratio,
 * not a real "0× display", so it degrades to 1× rather than collapsing the backing
 * store. The backing store is floored to whole pixels (`canvas.width` truncates
 * otherwise); the CSS box keeps the exact (possibly fractional) css size.
 */
export function resizeToDisplay(
  canvas: CanvasLike,
  cssW: number,
  cssH: number,
  rawDpr: number,
): ViewportSize {
  const dpr = Math.min(MAX_DPR, rawDpr || 1)
  const deviceWidth = Math.floor(cssW * dpr)
  const deviceHeight = Math.floor(cssH * dpr)
  canvas.width = deviceWidth
  canvas.height = deviceHeight
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  return { cssWidth: cssW, cssHeight: cssH, deviceWidth, deviceHeight, dpr }
}
