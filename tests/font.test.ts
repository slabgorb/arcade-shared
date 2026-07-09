// tests/font.test.ts
//
// SH2-2 (render-surface extraction, epic SH2) — the PURE VGMSGA stroke-vector
// font promoted verbatim from tempest's src/shell/vecfont.ts into
// @arcade/shared/font. This suite is the behavioural spec of that module and the
// fidelity anchor for the "verbatim move" the story mandates: the glyph geometry,
// module shape, and layout arithmetic MUST be byte-identical to what tempest
// shipped (Story 10-13), so tempest sees no visual change after re-pointing.
//
// It is PORTED from tempest/tests/shell/vecfont.test.ts — tempest is the source
// of truth for the glyph data — minus the tempest-repo-only source-text rules
// (Hard Architectural Boundary against ../core, `?raw` scans). DOM-freeness of the
// built module is enforced separately and at the delivered artifact by
// tests/purity.test.ts (reads dist/ as source text), which is the honest place
// for it in an untyped, node-env package (see ADR-0003 + design §3/§8).
//
// SOURCE OF TRUTH for every coordinate below (authentic, verbatim ROM):
//   tempest/docs/ux/2026-06-30-vector-font-rom-extract.md
//   (← original Atari ANVGAN.MAC, Ed Logg 6-JUNE-79; cross-checked vs the
//    "Tempest vs Tempest" book §4.)
//
// AC-1 CONTRACT (this file drives it into existence):
//   export const CELL_W: number   // 16
//   export const CELL_H: number   // 24
//   export interface VecStroke { readonly points: readonly { readonly x: number; readonly y: number }[] }
//   export interface VecGlyph  { readonly strokes: readonly VecStroke[]; readonly advance: number }
//   export const GLYPH_CHARS: string
//   export function hasGlyph(ch: string): boolean
//   export function charGlyph(ch: string): VecGlyph
//   export interface LayoutOptions { letterSpacing?: number }        // design §4.1 (A2-2 spacing)
//   export function layoutText(text: string, opts?: LayoutOptions):
//     { readonly strokes: readonly VecStroke[]; readonly width: number }
import { describe, it, expect } from 'vitest'
import {
  CELL_W,
  CELL_H,
  GLYPH_CHARS,
  hasGlyph,
  charGlyph,
  layoutText,
  type VecGlyph,
} from '../src/font'

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

type XY = [number, number]

/** A glyph reduced to plain [x,y] polylines for structural comparison. */
function shape(g: VecGlyph): XY[][] {
  return g.strokes.map((s) => s.points.map((p) => [p.x, p.y] as XY))
}

function allPoints(g: VecGlyph): XY[] {
  return g.strokes.flatMap((s) => s.points.map((p) => [p.x, p.y] as XY))
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const DIGITS = '0123456789'.split('')
// Characters on-screen gameplay text actually uses: alphabet, digits, space, hyphen.
const REQUIRED = [...LETTERS, ...DIGITS, ' ', '-']

// Authentic ink strokes (y-up, baseline 0), accumulated from the ROM VCTR chains
// in the extract doc — the fidelity anchors, carried verbatim from tempest's suite.
const ROM = {
  A: [
    [[0, 0], [0, 16], [8, 24], [16, 16], [16, 0]],
    [[0, 8], [16, 8]],
  ] as XY[][],
  I: [
    [[0, 0], [16, 0]],
    [[8, 0], [8, 24]],
    [[16, 24], [0, 24]],
  ] as XY[][],
  O: [[[0, 0], [0, 24], [16, 24], [16, 0], [0, 0]]] as XY[][],
  R: [
    [[0, 0], [0, 24], [16, 24], [16, 12], [0, 12]],
    [[4, 12], [16, 0]],
  ] as XY[][],
  // CHAR.T: the `-8,0` move is BLANK — stem and top bar are two separate strokes.
  T: [
    [[8, 0], [8, 24]],
    [[0, 24], [16, 24]],
  ] as XY[][],
}

// ===========================================================================
// A. Module shape & the fixed cell (AC-1: exports CELL_W/CELL_H, glyph table, layoutText)
// ===========================================================================
describe('@arcade/shared/font — module shape', () => {
  it('exposes the authentic 16x24 glyph cell', () => {
    expect(CELL_W).toBe(16)
    expect(CELL_H).toBe(24)
  })

  it('exports layoutText and the glyph-table accessors as functions', () => {
    expect(typeof layoutText).toBe('function')
    expect(typeof hasGlyph).toBe('function')
    expect(typeof charGlyph).toBe('function')
  })

  it('declares its supported character set (the VGMSGA glyph table), incl. full alphabet + digits', () => {
    expect(typeof GLYPH_CHARS).toBe('string')
    expect(GLYPH_CHARS.length).toBeGreaterThan(0)
    for (const ch of [...LETTERS, ...DIGITS]) expect(GLYPH_CHARS).toContain(ch)
  })
})

// ===========================================================================
// B. Glyph-table completeness — every on-screen character renders
// ===========================================================================
describe('@arcade/shared/font — glyph-table completeness', () => {
  it('has a glyph for every required character (A-Z, 0-9, space, hyphen)', () => {
    for (const ch of REQUIRED) {
      expect(hasGlyph(ch), `hasGlyph(${JSON.stringify(ch)})`).toBe(true)
    }
  })

  it('returns a well-formed VecGlyph (strokes array + positive numeric advance) for each', () => {
    for (const ch of REQUIRED) {
      const g = charGlyph(ch)
      expect(Array.isArray(g.strokes), `strokes array for ${JSON.stringify(ch)}`).toBe(true)
      expect(typeof g.advance).toBe('number')
      expect(g.advance).toBeGreaterThan(0)
      // every point is a {x,y} numeric pair
      for (const s of g.strokes) {
        for (const p of s.points) {
          expect(typeof p.x).toBe('number')
          expect(typeof p.y).toBe('number')
        }
      }
    }
  })

  it('degrades gracefully: an unsupported char yields a blank glyph, never throws', () => {
    expect(() => charGlyph('~')).not.toThrow()
    expect(hasGlyph('~')).toBe(false)
    expect(charGlyph('~').strokes).toHaveLength(0) // blank: advances but draws nothing
  })
})

// ===========================================================================
// C. Authentic coordinates — the fidelity anchors (verbatim ANVGAN.MAC)
// ===========================================================================
describe('@arcade/shared/font — authentic glyph geometry (verbatim ANVGAN.MAC)', () => {
  it('A — diagonal apex + crossbar, exactly two strokes', () => {
    expect(shape(charGlyph('A'))).toEqual(ROM.A)
  })

  it('I — bottom serif, stem, top serif: three separate strokes', () => {
    expect(shape(charGlyph('I'))).toEqual(ROM.I)
  })

  it('O — a single closed rectangle (first point === last)', () => {
    expect(shape(charGlyph('O'))).toEqual(ROM.O)
  })

  it('R — bowl + diagonal leg', () => {
    expect(shape(charGlyph('R'))).toEqual(ROM.R)
  })

  it('T — stem and top bar are NOT joined (corrects the book typo)', () => {
    expect(shape(charGlyph('T'))).toEqual(ROM.T)
  })

  it('the digit 0 is drawn with the letter-O routine (CHAR.0 = CHAR.O)', () => {
    expect(shape(charGlyph('0'))).toEqual(shape(charGlyph('O')))
  })
})

// ===========================================================================
// D. Consistent cell — every glyph lives in the same 16x24 box
// ===========================================================================
describe('@arcade/shared/font — consistent cell & spacing', () => {
  it('keeps every glyph ink inside the [0,CELL_W] x [0,CELL_H] cell', () => {
    for (const ch of REQUIRED) {
      for (const [x, y] of allPoints(charGlyph(ch))) {
        expect(x, `x of ${JSON.stringify(ch)}`).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(CELL_W)
        expect(y, `y of ${JSON.stringify(ch)}`).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(CELL_H)
      }
    }
  })

  it('advances roughly one cell per glyph (monospace-ish, supports column alignment)', () => {
    for (const ch of REQUIRED) {
      const a = charGlyph(ch).advance
      expect(a).toBeGreaterThanOrEqual(CELL_W) // never overlaps the next glyph
      expect(a).toBeLessThanOrEqual(CELL_W * 2) // nor leaves a huge gap
    }
  })
})

// ===========================================================================
// E. Stroke-vector semantics — pen-up/pen-down, not a filled font
// ===========================================================================
describe('@arcade/shared/font — stroke-vector semantics', () => {
  it('space draws no ink but still advances', () => {
    const sp = charGlyph(' ')
    expect(sp.strokes).toHaveLength(0)
    expect(sp.advance).toBeGreaterThanOrEqual(CELL_W)
  })

  it('every ink stroke is a polyline of at least two points', () => {
    for (const ch of REQUIRED) {
      for (const s of charGlyph(ch).strokes) {
        expect(s.points.length).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('a blank move starts a NEW stroke (glyphs are multi-stroke where the ROM lifts the pen)', () => {
    expect(charGlyph('A').strokes.length).toBe(2)
    expect(charGlyph('I').strokes.length).toBe(3)
  })

  it('is deterministic — same char in, identical glyph out across repeated calls', () => {
    expect(shape(charGlyph('S'))).toEqual(shape(charGlyph('S')))
    expect(shape(charGlyph('5'))).toEqual(shape(charGlyph('5')))
  })
})

// ===========================================================================
// F. layoutText — advancing a string across the consistent cell (verbatim behaviour)
// ===========================================================================
describe('@arcade/shared/font — layoutText (behaviour-preserving)', () => {
  it('lays out the empty string as nothing', () => {
    const { strokes, width } = layoutText('')
    expect(strokes).toHaveLength(0)
    expect(width).toBe(0)
  })

  it('advances each glyph by its width — total width is the sum of advances', () => {
    const expected = [...'TEMPEST'].reduce((w, ch) => w + charGlyph(ch).advance, 0)
    expect(layoutText('TEMPEST').width).toBeCloseTo(expected, 6)
  })

  it('positions later glyphs to the right (second char shifted by the first advance)', () => {
    const adv = charGlyph('I').advance
    const { strokes } = layoutText('II')
    expect(strokes).toHaveLength(2 * charGlyph('I').strokes.length)
    const maxX = Math.max(...strokes.flatMap((s) => s.points.map((p) => p.x)))
    expect(maxX).toBeGreaterThanOrEqual(adv)
  })
})

// ===========================================================================
// G. layoutText letterSpacing option — design §4.1 LayoutOptions (absorbs A2-2)
//    Optional + backward-compatible: omitted/0 == the verbatim behaviour above,
//    so tempest (which calls layoutText(text)) is unaffected.
// ===========================================================================
describe('@arcade/shared/font — layoutText letterSpacing (design §4.1)', () => {
  const minX = (strokes: readonly { readonly points: readonly { readonly x: number }[] }[]) =>
    Math.min(...strokes.flatMap((s) => s.points.map((p) => p.x)))

  it('an omitted / empty opts is identical to the no-argument call', () => {
    expect(layoutText('AB', {})).toEqual(layoutText('AB'))
  })

  it('letterSpacing: 0 is identical to no spacing', () => {
    expect(layoutText('AB', { letterSpacing: 0 })).toEqual(layoutText('AB'))
  })

  it('a positive letterSpacing widens the run beyond the base width', () => {
    const base = layoutText('AB').width
    const spaced = layoutText('AB', { letterSpacing: 12 }).width
    expect(spaced).toBeGreaterThanOrEqual(base + 12) // at least one inter-glyph gap added
  })

  it('spacing does NOT move the first glyph, and shifts the second glyph right by exactly the spacing', () => {
    // 'A' then 'B'. The first glyph starts at x=0 either way; the second glyph's
    // leftmost ink must move right by exactly `letterSpacing` (true whether the
    // implementation adds spacing before or after each glyph).
    const aStrokes = charGlyph('A').strokes.length
    const s = 12

    const base = layoutText('AB')
    const spaced = layoutText('AB', { letterSpacing: s })

    // First glyph (A) unchanged.
    const baseA = base.strokes.slice(0, aStrokes)
    const spacedA = spaced.strokes.slice(0, aStrokes)
    expect(spacedA).toEqual(baseA)

    // Second glyph (B) shifted right by exactly the spacing.
    const baseB = base.strokes.slice(aStrokes)
    const spacedB = spaced.strokes.slice(aStrokes)
    expect(minX(spacedB) - minX(baseB)).toBe(s)
  })

  it('letterSpacing does not distort glyph shapes, only their x-offsets', () => {
    // Widths of each glyph's bounding box are invariant under spacing.
    const boxWidth = (g: { points: readonly { readonly x: number }[] }[]) => {
      const xs = g.flatMap((s) => s.points.map((p) => p.x))
      return Math.max(...xs) - Math.min(...xs)
    }
    const aStrokes = charGlyph('A').strokes.length
    const base = layoutText('AB', { letterSpacing: 0 }).strokes.map((s) => ({ points: s.points }))
    const spaced = layoutText('AB', { letterSpacing: 20 }).strokes.map((s) => ({ points: s.points }))
    expect(boxWidth(spaced.slice(0, aStrokes))).toBe(boxWidth(base.slice(0, aStrokes)))
    expect(boxWidth(spaced.slice(aStrokes))).toBe(boxWidth(base.slice(aStrokes)))
  })
})
