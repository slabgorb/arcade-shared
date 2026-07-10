// @arcade/shared/esc-overlay — the BROWSER pause overlay (SH2-12, epic SH2).
//
// Generalised from battlezone's drawPauseOverlay (bz2-5): dim the frozen scene,
// then stroke a centred keybind card whose glyphs come from @arcade/shared/font
// (layoutText). Per the epic's verb/numbers rule the MECHANISM is shared; the
// NUMBERS — the card LINES, glow COLOUR, and dim OPACITY — arrive as per-cabinet
// parameters, so no battlezone constant is baked in here.
//
// This is an explicitly-flagged BROWSER subpath (ADR-0003): it draws to a canvas
// ctx, so it is EXEMPT from the pure-core purity guard (which keeps /pause and the
// rest of the pure core DOM-free). It references no DOM global directly — it only
// calls methods on the ctx the game hands in.
import { layoutText, CELL_H } from './font'

/** Per-cabinet parameters. Everything that differs between games is here; the
 *  mechanism (dim + centred card) is not. */
export interface EscOverlayOptions {
  /** The keybind card, top to bottom. '' (blank) entries are vertical spacing. */
  readonly lines: readonly string[]
  /** Glow colour for the card strokes — the cabinet's signature colour. */
  readonly color: string
  /** Dim-panel alpha over the frozen scene, 0..1. */
  readonly opacity: number
}

// ~0.1em inter-glyph tracking — the thin ROM caps read cramped at 0 (matches the
// tracking battlezone's HUD uses). Constant glyph-cell units → 0.1em at any size.
const GLYPH_TRACKING = 0.1 * CELL_H

/** Stroke one centred card line from the shared vector font, in `color`. */
function strokeCardLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  baseY: number,
  sizePx: number,
  color: string,
): void {
  const scale = sizePx / CELL_H
  const { strokes, width } = layoutText(text, { letterSpacing: GLYPH_TRACKING })
  const ox = cx - (width * scale) / 2
  ctx.strokeStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 8
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (const s of strokes) {
    // Glyph space is y-up with the baseline at 0; map to screen (y grows down).
    s.points.forEach((p, i) => {
      const sx = ox + p.x * scale
      const sy = baseY - p.y * scale
      if (i === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    })
  }
  ctx.stroke()
}

/**
 * Draw the pause overlay: a full-viewport dim panel (so the frozen world reads as
 * "paused", not as text floating over live vectors), then the centred keybind
 * card. The loop calls this only while paused; the sim behind it is held frozen
 * by @arcade/shared/pause. Placement/size follow the same layout battlezone used;
 * copy/colour/opacity are the caller's per-cabinet parameters.
 */
export function drawEscOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: EscOverlayOptions,
): void {
  // The dim panel — shadowBlur 0 first so the black box never glows.
  ctx.shadowBlur = 0
  ctx.fillStyle = `rgba(0, 0, 0, ${opts.opacity})`
  ctx.fillRect(0, 0, w, h)

  // The centred card. Blank lines are spacing — they hold a row but stroke no
  // text (they are NOT routed through the font).
  const size = Math.max(16, Math.round(Math.min(w, h) * 0.05))
  const lineHeight = size * 1.6
  const top = h / 2 - (opts.lines.length - 1) * lineHeight * 0.5
  opts.lines.forEach((line, i) => {
    if (line.trim().length === 0) return
    const baseY = top + i * lineHeight + size / 2
    strokeCardLine(ctx, line, w / 2, baseY, size, opts.color)
  })
}
