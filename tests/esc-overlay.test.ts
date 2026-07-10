// tests/esc-overlay.test.ts
//
// Story SH2-12 (epic SH2) — RED phase (Han Solo / TEA). The BROWSER half of the
// extraction: @arcade/shared/esc-overlay draws the dimmed pause panel + a centred
// keybind card, generalised from battlezone's drawPauseOverlay (bz2-5). Per the
// epic's verb/numbers rule the MECHANISM is shared (dim the frozen scene, then
// stroke a centred card of lines via @arcade/shared/font layoutText) while the
// NUMBERS — the card LINES, glow COLOUR, and dim OPACITY — arrive as per-cabinet
// parameters. No battlezone constant may be baked into this module.
//
// It is a BROWSER subpath (draws to a canvas ctx): purity.test.ts must recognise
// it as browser-exempt, NOT policed as pure. Behaviour is observed here with a
// recording ctx + a font mock (the post-stroke geometry is anonymous, so the
// only place the LINE STRINGS are still identifiable is the layoutText boundary —
// same seam battlezone's pause-overlay.test.ts reads).
//
// ── CONTRACT Dev implements to turn this GREEN ──────────────────────────────
//   drawEscOverlay(ctx, w, h, opts): void
//     opts.lines:   readonly string[]  — the keybind card; '' entries are spacing
//     opts.color:   string             — glow colour for the card strokes
//     opts.opacity: number             — dim-panel alpha (0..1)
//   Draws a full-viewport dim rect (shadowBlur 0 so the black panel never glows),
//   then routes each NON-BLANK line through layoutText and strokes it in `color`.
//   esc-overlay.ts must import layoutText from './font' (the shared font).
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Record the strings handed to layoutText — the text seam. Returns a trivial
// one-stroke glyph run so the caller's stroking loop runs end-to-end.
const font = vi.hoisted(() => {
  const calls: { text: string }[] = []
  return {
    calls,
    layoutText(text: string) {
      calls.push({ text })
      return { strokes: [{ points: [{ x: 0, y: 0 }, { x: 16, y: 0 }] }], width: 16 }
    },
  }
})

vi.mock('../src/font', () => ({
  layoutText: font.layoutText,
  CELL_W: 16,
  CELL_H: 24,
}))

const W = 800
const H = 600

/** Recording ctx: captures filled rects (the dim panel), and every fillStyle /
 *  strokeStyle / shadowBlur assignment. A Proxy no-ops all other members so the
 *  real draw routine runs to completion without throwing — that "does not break
 *  rendering" is itself part of the AC. */
function recordingCtx() {
  const fillRects: Array<{ x: number; y: number; w: number; h: number }> = []
  const sets: Record<string, unknown[]> = { fillStyle: [], strokeStyle: [], shadowBlur: [] }
  const rec = { canvas: { width: W, height: H } }
  const target = rec as unknown as Record<string | symbol, unknown>
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop === 'fillRect') {
        return (x: number, y: number, w: number, h: number) => { fillRects.push({ x, y, w, h }) }
      }
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (prop === 'measureText') return () => ({ width: 0 })
      if (prop in t) return t[prop]
      return () => {}
    },
    set(t, prop, value) {
      if (typeof prop === 'string' && prop in sets) sets[prop].push(value)
      t[prop] = value
      return true
    },
  })
  return { ctx: proxy as unknown as CanvasRenderingContext2D, fillRects, sets }
}

const routed = () => font.calls.map((c) => c.text)

const BZ_LINES = ['PAUSED', '', 'ESC        RESUME', 'E / D      LEFT TREAD', 'SPACE      FIRE']
const opts = (over: Partial<{ lines: readonly string[]; color: string; opacity: number }> = {}) => ({
  lines: BZ_LINES,
  color: '#33ff66',
  opacity: 0.72,
  ...over,
})

beforeEach(() => {
  font.calls.length = 0
})

describe('SH2-12 — drawEscOverlay: dims the frozen scene', () => {
  it('fills a dim panel across the WHOLE viewport', async () => {
    const { drawEscOverlay } = await import('../src/esc-overlay')
    const { ctx, fillRects } = recordingCtx()
    drawEscOverlay(ctx, W, H, opts())
    const full = fillRects.some((r) => r.x === 0 && r.y === 0 && r.w === W && r.h === H)
    expect(full, 'the overlay must dim the entire viewport with a full-screen fillRect').toBe(true)
  })

  it('the dim panel does not glow — shadowBlur is reset to 0 before the fill', async () => {
    const { drawEscOverlay } = await import('../src/esc-overlay')
    const { ctx, sets } = recordingCtx()
    drawEscOverlay(ctx, W, H, opts())
    expect(sets.shadowBlur, 'the black dim panel must set shadowBlur to 0 (a glowing black box is a bug)').toContain(0)
  })

  it('honours the per-cabinet dim OPACITY (not a hard-coded battlezone 0.72)', async () => {
    const { drawEscOverlay } = await import('../src/esc-overlay')
    const { ctx, sets } = recordingCtx()
    drawEscOverlay(ctx, W, H, opts({ opacity: 0.4 }))
    const usedOpacity = sets.fillStyle.some((s) => typeof s === 'string' && (s as string).includes('0.4'))
    expect(usedOpacity, `dim fillStyle must reflect opacity 0.4; saw ${JSON.stringify(sets.fillStyle)}`).toBe(true)
  })
})

describe('SH2-12 — drawEscOverlay: the keybind card', () => {
  it('routes every NON-BLANK line through the shared font, verbatim', async () => {
    const { drawEscOverlay } = await import('../src/esc-overlay')
    const { ctx } = recordingCtx()
    drawEscOverlay(ctx, W, H, opts())
    const nonBlank = BZ_LINES.filter((l) => l.trim().length > 0)
    for (const line of nonBlank) {
      expect(routed(), `card line "${line}" must be routed through layoutText`).toContain(line)
    }
  })

  it('does NOT route blank spacer lines through the font', async () => {
    const { drawEscOverlay } = await import('../src/esc-overlay')
    const { ctx } = recordingCtx()
    drawEscOverlay(ctx, W, H, opts({ lines: ['PAUSED', '', '', 'ESC  RESUME'] }))
    expect(routed(), 'blank lines are spacing, not text — they must not be stroked').not.toContain('')
    expect(routed()).toEqual(['PAUSED', 'ESC  RESUME'])
  })

  it('strokes the card in the per-cabinet COLOUR (not a hard-coded green)', async () => {
    const { drawEscOverlay } = await import('../src/esc-overlay')
    const { ctx, sets } = recordingCtx()
    drawEscOverlay(ctx, W, H, opts({ color: '#ff3355' }))
    expect(sets.strokeStyle, 'the card must be stroked in opts.color').toContain('#ff3355')
    expect(sets.strokeStyle, 'no battlezone green may leak in for a red cabinet').not.toContain('#33ff66')
  })

  it('carries NO battlezone default lines — an empty card routes no text', async () => {
    // Proves the lines are truly a parameter, not a baked-in default: given zero
    // lines the overlay still dims but strokes no card text.
    const { drawEscOverlay } = await import('../src/esc-overlay')
    const { ctx, fillRects } = recordingCtx()
    drawEscOverlay(ctx, W, H, opts({ lines: [] }))
    expect(routed(), 'an empty card must route no text (no baked-in battlezone lines)').toEqual([])
    expect(fillRects.length, 'the dim panel still draws even with an empty card').toBeGreaterThan(0)
  })

  it('runs end-to-end on a bare ctx without throwing (does not break rendering)', async () => {
    const { drawEscOverlay } = await import('../src/esc-overlay')
    const { ctx } = recordingCtx()
    expect(() => drawEscOverlay(ctx, W, H, opts())).not.toThrow()
  })
})
