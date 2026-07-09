// @arcade/shared/font — the authentic VGMSGA stroke-vector font (PURE).
//
// SH2-2 (epic SH2, ADR-0002/ADR-0003): promoted VERBATIM from tempest's
// src/shell/vecfont.ts. A PURE, deterministic alphabet library: each character
// maps to vector path data (ink polylines in a fixed 16x24 cell). It returns
// stroke geometry only — RENDERING is the game's job (stroke through /glow). No
// DOM, no web-font loader, no async asset, no time, no randomness — so it lives
// among the pure core and is policed by tests/purity.test.ts (ADR-0003 Amendment 1).
//
// Glyph data is lifted VERBATIM from the original Atari Tempest source —
// ANVGAN.MAC ("ALPHA-NUMERIC VECTOR SUBROUTINES", Ed Logg, 6-JUNE-79) and the
// DASH routine in ALVROM.MAC — cross-checked against the "Tempest vs Tempest"
// book §4. Full provenance + the verbatim VCTR listings live in tempest:
//   tempest/docs/ux/2026-06-30-vector-font-rom-extract.md
//
// Coordinate convention (matches the ROM): cell-local units, origin at the
// glyph's lower-left, +x right, +y UP, baseline at y=0; a glyph occupies
// x in [0,CELL_W], y in [0,CELL_H]. Each ROM op is `VCTR dx,dy,intensity`: a
// LIT run (1) draws and extends the current stroke; a BLANK move (0) lifts the
// pen and STARTS A NEW STROKE. The trailing blank move is not ink — its net x is
// the glyph's `advance` (where the next glyph begins).

export const CELL_W = 16
export const CELL_H = 24

export interface VecStroke {
  readonly points: readonly { readonly x: number; readonly y: number }[]
}

export interface VecGlyph {
  /** Ink polylines in cell-local space (y-up, baseline y=0). */
  readonly strokes: readonly VecStroke[]
  /** Horizontal distance from this glyph's origin to the next glyph's origin. */
  readonly advance: number
}

/** Layout options. `letterSpacing` adds horizontal space after each glyph
 *  (design §4.1 — absorbs per-game spacing, e.g. asteroids' A2-2 concern).
 *  Omitted / 0 reproduces the original tempest layout exactly. */
export interface LayoutOptions {
  readonly letterSpacing?: number
}

// A single ROM vector: [dx, dy, lit]. `lit` 1 = drawn (.BRITE/.BRITE-1), 0 = blank
// move. `.BRITE-1` strokes (a hair dimmer in CHAR.B) are still ink → lit = 1.
type Vec = readonly [number, number, 0 | 1]

// --------------------------------------------------------------------------
// Verbatim ROM glyph data (ANVGAN.MAC). Keyed by the rendered character.
// `' '` is CHAR. (the blank advance); `'-'` is DASH (ALVROM.MAC). `'0'` aliases
// `'O'` (CHAR.0 = CHAR.O in the ROM) and is wired below.
// --------------------------------------------------------------------------
const ROM: Readonly<Record<string, readonly Vec[]>> = {
  ' ': [[24, 0, 0]],
  '-': [[0, 12, 0], [16, 0, 1], [8, -12, 0]],

  A: [[0, 16, 1], [8, 8, 1], [8, -8, 1], [0, -16, 1], [-16, 8, 0], [16, 0, 1], [8, -8, 0]],
  B: [[0, 24, 1], [12, 0, 1], [4, -4, 1], [0, -4, 1], [-4, -4, 1], [-12, 0, 1],
      [12, 0, 0], [4, -4, 1], [0, -4, 1], [-4, -4, 1], [-12, 0, 1], [24, 0, 0]],
  C: [[0, 24, 1], [16, 0, 1], [-16, -24, 0], [16, 0, 1], [8, 0, 0]],
  D: [[0, 24, 1], [8, 0, 1], [8, -8, 1], [0, -8, 1], [-8, -8, 1], [-8, 0, 1], [24, 0, 0]],
  E: [[0, 24, 1], [16, 0, 1], [-4, -12, 0], [-12, 0, 1], [0, -12, 0], [16, 0, 1], [8, 0, 0]],
  F: [[0, 24, 1], [16, 0, 1], [-4, -12, 0], [-12, 0, 1], [0, -12, 0], [24, 0, 0]],
  G: [[0, 24, 1], [16, 0, 1], [0, -8, 1], [-8, -8, 0], [8, 0, 1], [0, -8, 1], [-16, 0, 1], [24, 0, 0]],
  H: [[0, 24, 1], [0, -12, 0], [16, 0, 1], [0, 12, 0], [0, -24, 1], [8, 0, 0]],
  I: [[16, 0, 1], [-8, 0, 0], [0, 24, 1], [8, 0, 0], [-16, 0, 1], [24, -24, 0]],
  J: [[0, 8, 0], [8, -8, 1], [8, 0, 1], [0, 24, 1], [8, -24, 0]],
  K: [[0, 24, 1], [12, 0, 0], [-12, -12, 1], [12, -12, 1], [12, 0, 0]],
  L: [[0, 24, 0], [0, -24, 1], [16, 0, 1], [8, 0, 0]],
  M: [[0, 24, 1], [8, -8, 1], [8, 8, 1], [0, -24, 1], [8, 0, 0]],
  N: [[0, 24, 1], [16, -24, 1], [0, 24, 1], [8, -24, 0]],
  O: [[0, 24, 1], [16, 0, 1], [0, -24, 1], [-16, 0, 1], [24, 0, 0]],
  P: [[0, 24, 1], [16, 0, 1], [0, -12, 1], [-16, 0, 1], [12, -12, 0], [12, 0, 0]],
  Q: [[0, 24, 1], [16, 0, 1], [0, -16, 1], [-8, -8, 1], [-8, 0, 1], [8, 8, 0], [8, -8, 1], [8, 0, 0]],
  R: [[0, 24, 1], [16, 0, 1], [0, -12, 1], [-16, 0, 1], [4, 0, 0], [12, -12, 1], [8, 0, 0]],
  S: [[16, 0, 1], [0, 12, 1], [-16, 0, 1], [0, 12, 1], [16, 0, 1], [8, -24, 0]],
  T: [[8, 0, 0], [0, 24, 1], [-8, 0, 0], [16, 0, 1], [8, -24, 0]],
  U: [[0, 24, 0], [0, -24, 1], [16, 0, 1], [0, 24, 1], [8, -24, 0]],
  V: [[0, 24, 0], [8, -24, 1], [8, 24, 1], [8, -24, 0]],
  W: [[0, 24, 0], [0, -24, 1], [8, 8, 1], [8, -8, 1], [0, 24, 1], [8, -24, 0]],
  X: [[16, 24, 1], [-16, 0, 0], [16, -24, 1], [8, 0, 0]],
  Y: [[8, 0, 0], [0, 16, 1], [-8, 8, 1], [16, 0, 0], [-8, -8, 1], [16, -16, 0]],
  Z: [[0, 24, 0], [16, 0, 1], [-16, -24, 1], [16, 0, 1], [8, 0, 0]],

  '1': [[8, 0, 0], [0, 24, 1], [16, -24, 0]],
  '2': [[0, 24, 0], [16, 0, 1], [0, -12, 1], [-16, 0, 1], [0, -12, 1], [16, 0, 1], [8, 0, 0]],
  '3': [[16, 0, 1], [0, 24, 1], [-16, 0, 1], [0, -12, 0], [16, 0, 1], [8, -12, 0]],
  '4': [[0, 24, 0], [0, -12, 1], [16, 0, 1], [0, 12, 0], [0, -24, 1], [8, 0, 0]],
  '5': [[16, 0, 1], [0, 12, 1], [-16, 0, 1], [0, 12, 1], [16, 0, 1], [8, -24, 0]],
  '6': [[0, 12, 0], [16, 0, 1], [0, -12, 1], [-16, 0, 1], [0, 24, 1], [24, -24, 0]],
  '7': [[0, 24, 0], [16, 0, 1], [0, -24, 1], [8, 0, 0]],
  '8': [[16, 0, 1], [0, 24, 1], [-16, 0, 1], [0, -24, 1], [0, 12, 0], [16, 0, 1], [8, -12, 0]],
  '9': [[16, 0, 0], [0, 24, 1], [-16, 0, 1], [0, -12, 1], [16, 0, 1], [8, -12, 0]],
}

/** Accumulate a ROM VCTR chain into ink polylines + an advance. */
function build(vectors: readonly Vec[]): VecGlyph {
  let x = 0
  let y = 0
  const strokes: VecStroke[] = []
  let cur: { x: number; y: number }[] | null = null
  for (const [dx, dy, lit] of vectors) {
    const nx = x + dx
    const ny = y + dy
    if (lit) {
      if (cur === null) cur = [{ x, y }]
      cur.push({ x: nx, y: ny })
    } else if (cur !== null) {
      strokes.push({ points: cur })
      cur = null
    }
    x = nx
    y = ny
  }
  if (cur !== null) strokes.push({ points: cur })
  return { strokes, advance: x }
}

// Precompute every glyph once. `'0'` reuses the letter-O routine (CHAR.0 = CHAR.O).
const GLYPHS: Readonly<Record<string, VecGlyph>> = (() => {
  const out: Record<string, VecGlyph> = {}
  for (const ch of Object.keys(ROM)) out[ch] = build(ROM[ch])
  out['0'] = out.O
  return out
})()

/** Every character the font can draw, in a stable order (space, digits, A-Z, dash). */
export const GLYPH_CHARS = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-'

const BLANK: VecGlyph = GLYPHS[' ']

export function hasGlyph(ch: string): boolean {
  return Object.prototype.hasOwnProperty.call(GLYPHS, ch)
}

/** Total: an unsupported character degrades to a blank (space-width) glyph. */
export function charGlyph(ch: string): VecGlyph {
  return hasGlyph(ch) ? GLYPHS[ch] : BLANK
}

/**
 * Lay a string out left-to-right on the consistent cell. Returns the positioned
 * ink strokes (cell-local units, y-up) and the total advance width. Callers
 * scale/translate/flip-y to screen space.
 *
 * `opts.letterSpacing` (default 0) inserts extra horizontal space after each
 * glyph's advance; the first glyph is never shifted. With no opts (or 0) the
 * output is byte-identical to the original tempest layout.
 */
export function layoutText(
  text: string,
  opts?: LayoutOptions,
): { readonly strokes: readonly VecStroke[]; readonly width: number } {
  const letterSpacing = opts?.letterSpacing ?? 0
  const strokes: VecStroke[] = []
  let cursor = 0
  for (const ch of text) {
    const g = charGlyph(ch)
    for (const s of g.strokes) {
      strokes.push({ points: s.points.map((p) => ({ x: p.x + cursor, y: p.y })) })
    }
    cursor += g.advance + letterSpacing
  }
  return { strokes, width: cursor }
}
