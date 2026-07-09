// tests/font-glyph-audit.test.ts
//
// SH2-3 (epic SH2, render-surface extraction) — the glyph audit that GATES the
// per-game font migrations SH2-4 (asteroids) / SH2-5 (star-wars) / SH2-6 (battlezone).
//
// SH2-2 promoted tempest's VGMSGA stroke alphabet into @arcade/shared/font; it
// covers what Tempest rendered (space, 0-9, A-Z, '-'). The three other canvas games
// render characters that alphabet LACKS. This suite pins the audit result and drives
// the missing glyphs into existence (RED until Dev adds them in src/font.ts).
//
// ---------------------------------------------------------------------------
// AUDIT PROVENANCE (every rendered character, enumerated from the game shells)
// ---------------------------------------------------------------------------
//   asteroids  — asteroids/src/shell/render.ts  (drawText → ctx.fillText, caps-only)
//     literals: 'ASTEROIDS' 'PUSH START' 'HIGH SCORES' 'GAME OVER'
//               'YOUR SCORE IS ONE OF THE TEN BEST' 'PLEASE ENTER YOUR INITIALS'
//     dynamic : formatScore → 0-9 (core/score.ts padStart(6,'0'));
//               rank String(i+1).padStart(2,' ') → 0-9 + space;
//               initials echo `${initials}${'_'.repeat(3-len)}` (render.ts:405-406)
//               → any A-Z (core/sim.ts filters /^[a-zA-Z]$/ then .toUpperCase()) + '_'
//     NEW glyph vs the shared table:  '_'  (underscore)
//
//   star-wars  — star-wars/src/shell/render.ts  (glowText → .toUpperCase() → fillText)
//     literals: 'SCORE' 'WAVE' 'SHIELD' 'EXHAUST PORT AHEAD' 'STAR WARS'
//               'PRESS START' 'GAME OVER' 'HIGH SCORES' 'NO SCORES YET'
//               `${FORCE_BONUS.toLocaleString('en-US')} FOR USING THE FORCE`
//               → "5,000 FOR USING THE FORCE"
//     dynamic : formatScore (shell/hud.ts → .toLocaleString('en-US')) → 0-9 + ','
//               board rows String(score).padStart(6,' ') + rank padStart(2,' ')
//               → 0-9 + space; seeded name 'ACE' (main.ts) → A C E
//     letters actually produced: A C D E F G H I L M N O P R S T U V W X Y (no B J K Q Z)
//     NEW glyph vs the shared table:  ','  (comma, from en-US grouping)
//
//   battlezone — battlezone/src/shell/render.ts  (hudFont → ctx.fillText)
//     literals: 'BATTLEZONE' 'HIGH SCORES' 'PRESS START' 'GAME OVER' 'PAUSED'
//               'SCORE ' 'DUAL-TREAD   ESC PAUSE' 'MOTION BLOCKED BY OBJECT'
//               'ENEMY IN RANGE'; pause card 'E / D      LEFT TREAD',
//               'I / K      RIGHT TREAD', 'ESC        RESUME', 'ARROWS     DRIVE',
//               'SPACE      FIRE', 'ENTER      START'
//     dynamic : String(score) → 0-9; seeded name 'AAA' (core/sim.ts) → A
//     letters actually produced: A-Z except Q and X (24 letters)
//     NEW glyph vs the shared table:  '/'  (slash, in the pause control card)
//
//     EXCLUDED — '▲' (U+25B2), battlezone's lives counter `'▲'.repeat(lives)`
//       (render.ts:218), is an iconographic HUD element, NOT a typographic glyph.
//       VGMSGA is an alphanumeric+punctuation STROKE alphabet; a filled up-triangle
//       does not belong in it (and outlining it would change filled→hollow). SH2-6
//       must render the lives indicator as a bespoke vector shape, not via layoutText.
//       See the SH2-3 Delivery Finding + TEA deviation. Deliberately not required below.
//
//   Copyright — no game renders '©' / '(c)' on the CANVAS; the only copyright/framing
//   text is the DOM <title> in each index.html. So no copyright glyph is required.
//
// ---------------------------------------------------------------------------
// FONT GAP (union of the three games, minus the pre-SH2-3 alphabet):  '_'  ','  '/'
// ---------------------------------------------------------------------------
//
// Untyped-package note: arcade-shared has no root tsconfig; vitest strips types, so
// these tests get ZERO compile-time checking. Every contract below is asserted at
// RUNTIME (stroke counts, advances, coordinate bounds) — never via type annotations.
// The audit is encoded as a reviewed FIXTURE (with the provenance above) rather than
// re-derived by reading the sibling game repos: arcade-shared is built and tested
// standalone (the games are gitignored siblings, absent in a clean checkout), so a
// cross-repo fs.read would fail for the wrong reason. See the TEA deviation log.
import { describe, it, expect } from 'vitest'
import { CELL_W, CELL_H, GLYPH_CHARS, hasGlyph, charGlyph, layoutText } from '../src/font'

// --- Audited per-game canvas character sets (SH2-3 AC-1) --------------------
// asteroids: any A-Z reachable via player initials; 0-9 via score; space; '_'.
const ASTEROIDS_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _'
// star-wars: the 21 letters its strings produce; 0-9; space; ',' from en-US grouping.
const STARWARS_CHARS = 'ACDEFGHILMNOPRSTUVWXY0123456789 ,'
// battlezone: A-Z minus Q,X; 0-9; space; '/' (pause card); '-' (DUAL-TREAD).  '▲' excluded (icon).
const BATTLEZONE_CHARS = 'ABCDEFGHIJKLMNOPRSTUVWYZ0123456789 /-'

const GAMES: ReadonlyArray<{ name: string; chars: string }> = [
  { name: 'asteroids', chars: ASTEROIDS_CHARS },
  { name: 'star-wars', chars: STARWARS_CHARS },
  { name: 'battlezone', chars: BATTLEZONE_CHARS },
]

// The union of every character the three canvas games render (AC-3 target set).
const UNION_CHARS = [...new Set([...ASTEROIDS_CHARS, ...STARWARS_CHARS, ...BATTLEZONE_CHARS])]

// The shared alphabet as SH2-2 shipped it — BEFORE this story adds anything.
// Hardcoded (not read from the live GLYPH_CHARS) so the "explicit gap" stays stable
// as Dev grows the table in GREEN.
const PRE_SH2_3_ALPHABET = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-'

// The characters this story must ADD to the shared font (AC-2), in code-point order.
const NEW_GLYPHS = [',', '/', '_'] as const

const nonSpace = (s: string): string[] => [...s].filter((c) => c !== ' ')

// ===========================================================================
// AC-1 — per-game glyph inventory documented & diffed; the gap list is explicit
// ===========================================================================
describe('SH2-3 AC-1 — per-game glyph audit & explicit gap list', () => {
  it('records a non-empty, de-duplicated character set for each of the three games', () => {
    for (const { name, chars } of GAMES) {
      expect(chars.length, `${name} charset non-empty`).toBeGreaterThan(0)
      expect(new Set(chars).size, `${name} charset has no duplicates`).toBe(chars.length)
    }
  })

  it('the explicit gap (union minus the pre-SH2-3 alphabet) is exactly ",", "/", "_"', () => {
    const gap = UNION_CHARS.filter((c) => !PRE_SH2_3_ALPHABET.includes(c)).sort()
    expect(gap).toEqual([...NEW_GLYPHS])
  })

  // Split per game so a failure names the offending game AND character.
  it('every character asteroids renders has a shared-font glyph (gap: "_")', () => {
    for (const ch of ASTEROIDS_CHARS) {
      expect(hasGlyph(ch), `asteroids needs a glyph for ${JSON.stringify(ch)}`).toBe(true)
    }
  })

  it('every character star-wars renders has a shared-font glyph (gap: ",")', () => {
    for (const ch of STARWARS_CHARS) {
      expect(hasGlyph(ch), `star-wars needs a glyph for ${JSON.stringify(ch)}`).toBe(true)
    }
  })

  it('every character battlezone renders has a shared-font glyph (gap: "/")', () => {
    for (const ch of BATTLEZONE_CHARS) {
      expect(hasGlyph(ch), `battlezone needs a glyph for ${JSON.stringify(ch)}`).toBe(true)
    }
  })
})

// ===========================================================================
// AC-2 — each newly added glyph is a well-formed VGMSGA monoline glyph
//        (strokes + advance width), and is a first-class member of the table
// ===========================================================================
describe('SH2-3 AC-2 — the newly added punctuation glyphs (",", "/", "_")', () => {
  for (const ch of NEW_GLYPHS) {
    const label = JSON.stringify(ch)

    it(`${label} is a supported glyph and is listed in GLYPH_CHARS`, () => {
      expect(hasGlyph(ch)).toBe(true)
      expect(GLYPH_CHARS).toContain(ch)
    })

    it(`${label} draws ink — at least one stroke, each a polyline of >=2 points`, () => {
      const g = charGlyph(ch)
      expect(g.strokes.length, `${label} stroke count`).toBeGreaterThanOrEqual(1)
      for (const s of g.strokes) {
        expect(s.points.length, `${label} stroke polyline length`).toBeGreaterThanOrEqual(2)
      }
    })

    it(`${label} advances ~one cell (monospace-ish, keeps HUD columns aligned)`, () => {
      const a = charGlyph(ch).advance
      expect(typeof a).toBe('number')
      expect(a).toBeGreaterThanOrEqual(CELL_W)
      expect(a).toBeLessThanOrEqual(CELL_W * 2)
    })

    it(`${label} keeps its ink within the glyph cell (finite coords, x in [0,CELL_W])`, () => {
      for (const s of charGlyph(ch).strokes) {
        for (const p of s.points) {
          expect(Number.isFinite(p.x), `${label} finite x`).toBe(true)
          expect(Number.isFinite(p.y), `${label} finite y`).toBe(true)
          expect(p.x).toBeGreaterThanOrEqual(0)
          expect(p.x).toBeLessThanOrEqual(CELL_W)
          // y may dip below the baseline (a comma tail) but must stay in a sane band.
          expect(p.y).toBeGreaterThanOrEqual(-CELL_H)
          expect(p.y).toBeLessThanOrEqual(CELL_H)
        }
      }
    })

    it(`${label} lays out consistently — layoutText width equals the glyph advance`, () => {
      const g = charGlyph(ch)
      const laid = layoutText(ch)
      expect(laid.width).toBe(g.advance)
      expect(laid.strokes.length).toBe(g.strokes.length)
    })
  }
})

// ===========================================================================
// AC-3 — layoutText represents the FULL text set of all three games with no
//        missing/placeholder characters. charGlyph() silently degrades unknown
//        chars to a blank (space-width, 0 strokes) — this pins that no required
//        character is silently dropped.
// ===========================================================================
describe('SH2-3 AC-3 — full text set renders with no blank/placeholder substitution', () => {
  it('no non-space character across the three games degrades to a blank glyph', () => {
    for (const ch of UNION_CHARS) {
      if (ch === ' ') continue
      expect(
        charGlyph(ch).strokes.length,
        `${JSON.stringify(ch)} must draw ink, not degrade to a blank`,
      ).toBeGreaterThanOrEqual(1)
    }
  })

  it('representative HUD strings from each game lay out ink for every non-space char', () => {
    // Real rendered strings that each exercise a gap character.
    const SAMPLES = [
      'AB_', // asteroids initials-entry echo (partial initials + underscore placeholder)
      '5,000 FOR USING THE FORCE', // star-wars force-bonus banner
      '12,066', // star-wars grouped score
      'E / D      LEFT TREAD', // battlezone pause control row
      'DUAL-TREAD   ESC PAUSE', // battlezone control indicator (hyphen + spaces)
    ]
    for (const sample of SAMPLES) {
      const { strokes, width } = layoutText(sample)
      expect(width, `width of ${JSON.stringify(sample)}`).toBeGreaterThan(0)
      // Every visible (non-space) character must contribute ink.
      for (const ch of nonSpace(sample)) {
        expect(
          charGlyph(ch).strokes.length,
          `${JSON.stringify(ch)} in ${JSON.stringify(sample)} must render ink`,
        ).toBeGreaterThanOrEqual(1)
      }
      expect(strokes.length, `${JSON.stringify(sample)} produced strokes`).toBeGreaterThan(0)
    }
  })
})

// ===========================================================================
// Invariants — GLYPH_CHARS stays in sync with the glyph table, and the new
// punctuation is a genuine glyph rather than an alias of the blank fallback.
// (Guards against Dev listing a char in GLYPH_CHARS without real geometry, or
//  vice-versa.)
// ===========================================================================
describe('SH2-3 — GLYPH_CHARS ↔ glyph-table sync invariants', () => {
  it('every character listed in GLYPH_CHARS resolves to a real glyph', () => {
    for (const ch of GLYPH_CHARS) {
      expect(hasGlyph(ch), `GLYPH_CHARS lists ${JSON.stringify(ch)} → hasGlyph`).toBe(true)
      const g = charGlyph(ch)
      // Space is the sole inkless member; everything else must draw something.
      if (ch === ' ') expect(g.strokes).toHaveLength(0)
      else expect(g.strokes.length, `${JSON.stringify(ch)} draws ink`).toBeGreaterThanOrEqual(1)
    }
  })

  it('the new punctuation is a distinct glyph, not the blank/space fallback', () => {
    const blank = charGlyph(' ')
    for (const ch of NEW_GLYPHS) {
      expect(charGlyph(ch), `${JSON.stringify(ch)} must not be the blank fallback`).not.toBe(blank)
    }
  })
})
