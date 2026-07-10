// @arcade/shared/glow — the neon-vector primitive (BROWSER subpath, SH2-8, epic SH2).
//
// Every cabinet hand-writes the same three lines before it strokes a glowing vector:
// set strokeStyle + shadowColor + shadowBlur + lineWidth, draw, and then RESET
// shadowBlur to 0 — because a lingering blur bleeds into the next, non-glow draw.
// That last step is the footgun asteroids/star-wars/battlezone each re-hand-write
// (and forget); withGlow owns it once, for all of them.
//
// This is an explicitly-flagged BROWSER subpath (ADR-0003): it drives a canvas ctx,
// so it is EXEMPT from the pure-core purity guard (which keeps math3d/rng/highscore/
// loop/font/pause DOM-free). It references no DOM global directly — it only calls
// methods on the ctx the game hands in.
//
// Deliberately NO ctx.save()/restore(): it mirrors the per-frame code it replaces
// (games set the two or three ctx fields inline every frame, not via a state stack),
// and save/restore around every polyline would be a per-frame cost the originals
// never paid. Only shadowBlur — the field that leaks — is restored.

/** The stroke treatment for one glowing vector draw. Per-cabinet NUMBERS (blur radius,
 *  line width, colour) live in the game and arrive here as a value; the shared VERB is
 *  the set-draw-reset envelope. */
export interface GlowStyle {
  /** strokeStyle — a solid colour, or a CanvasGradient for richer looks (tempest's
   *  tube gradient / multi-pass depth). */
  readonly stroke: string | CanvasGradient
  /** lineWidth for the stroke. */
  readonly width: number
  /** shadowBlur — the glow radius. */
  readonly blur: number
  /** shadowColor. Optional: defaults to `stroke` when it is a plain colour string. A
   *  CanvasGradient can't be a shadowColor, so pass an explicit `color` alongside a
   *  gradient stroke. */
  readonly color?: string
}

/**
 * Run `draw` with the glow ctx state applied, then reset shadowBlur to 0.
 *
 * Sets strokeStyle / lineWidth / shadowColor / shadowBlur from `style`, invokes
 * `draw` (which issues the actual path + stroke calls while the glow is active), and
 * finally clears shadowBlur so the NEXT draw does not inherit the blur. strokeStyle /
 * lineWidth / shadowColor are intentionally left as-set — the next draw overwrites
 * them; only the leaky shadowBlur is restored.
 */
export function withGlow(
  ctx: CanvasRenderingContext2D,
  style: GlowStyle,
  draw: () => void,
): void {
  ctx.strokeStyle = style.stroke
  ctx.lineWidth = style.width
  // A gradient stroke can't be a shadowColor; fall back to the stroke only when it is
  // a plain string. `??` (not `||`) so an explicit empty-string color is honoured.
  ctx.shadowColor = style.color ?? (typeof style.stroke === 'string' ? style.stroke : '')
  ctx.shadowBlur = style.blur
  draw()
  ctx.shadowBlur = 0
}

/**
 * Stroke a glowing polyline through `pts` (screen-space [x, y] pairs — the game does
 * its own world→screen transform first). moveTo the first point, lineTo the rest, and
 * optionally closePath into a ring. The whole path is stroked inside a withGlow
 * envelope, so shadowBlur is reset to 0 afterwards. An empty point list is a no-op.
 */
export function glowPolyline(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<readonly [number, number]>,
  style: GlowStyle,
  close = false,
): void {
  if (pts.length === 0) return
  withGlow(ctx, style, () => {
    ctx.beginPath()
    const [x0, y0] = pts[0]
    ctx.moveTo(x0, y0)
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = pts[i]
      ctx.lineTo(x, y)
    }
    if (close) ctx.closePath()
    ctx.stroke()
  })
}
