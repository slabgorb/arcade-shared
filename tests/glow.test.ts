// tests/glow.test.ts
//
// Story SH2-8 (epic SH2) — RED phase (Han Solo / TEA). The FIRST browser subpath's
// core: @arcade/shared/glow, the neon-vector primitive every cabinet hand-writes.
// Two exports, both drawing to a canvas ctx (browser-exempt from the purity guard):
//
//   withGlow(ctx, style, draw)      — set strokeStyle/lineWidth/shadowColor/shadowBlur,
//                                     run `draw`, then RESET shadowBlur to 0. That reset
//                                     is the footgun (a lingering blur makes the NEXT,
//                                     non-glow draw bleed) — asteroids/star-wars/
//                                     battlezone each re-hand-write it today.
//   glowPolyline(ctx, pts, style, close?) — the one-liner built on withGlow: beginPath,
//                                     moveTo the first screen point, lineTo the rest,
//                                     optionally closePath, stroke — all inside the glow
//                                     envelope so shadowBlur is reset afterwards.
//
// GlowStyle.stroke is `string | CanvasGradient` (AC-1) so richer looks — tempest's tube
// gradient — are expressible; a gradient can't be a shadowColor, so GlowStyle carries a
// separate `color` for shadowColor (defaulting to `stroke` when it is a plain string).
// Deliberately NO ctx.save/ctx.restore (mirrors the per-frame code it replaces).
//
// ── CONTRACT Dev implements to turn this GREEN ──────────────────────────────
//   interface GlowStyle {
//     readonly stroke: string | CanvasGradient   // → ctx.strokeStyle
//     readonly width: number                      // → ctx.lineWidth
//     readonly blur: number                       // → ctx.shadowBlur (the glow radius)
//     readonly color?: string                     // → ctx.shadowColor; default = stroke (string only)
//   }
//   function withGlow(ctx, style: GlowStyle, draw: () => void): void
//   function glowPolyline(ctx, pts: ReadonlyArray<readonly [number, number]>,
//                         style: GlowStyle, close?: boolean): void
//
// Behaviour is observed with a RECORDING ctx (a Proxy) — the canonical arcade-shared
// pattern (esc-overlay.test.ts, bz2-5 pause-overlay.test.ts). It logs every property
// SET and method CALL in order, so the suite can assert BOTH the state values AND the
// sequence (glow active while draw runs → shadowBlur 0 after).
import { describe, it, expect } from 'vitest'

type Op = { op: string; args: readonly unknown[] }

/** Recording ctx: an ordered op-log of every method call and property assignment, plus
 *  live read-back of the last value written (so a `draw` callback can observe the glow
 *  state that is active at the moment it runs). A Proxy no-ops all other members so the
 *  real routine runs end-to-end without throwing. */
function recordingCtx() {
  const ops: Op[] = []
  const target = { canvas: { width: 800, height: 600 } } as Record<string | symbol, unknown>
  const methods = new Set([
    'beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fill', 'fillRect', 'save', 'restore',
  ])
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (typeof prop === 'string' && methods.has(prop)) {
        return (...args: unknown[]) => { ops.push({ op: prop, args }) }
      }
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (prop in t) return t[prop]
      return () => {}
    },
    set(t, prop, value) {
      if (typeof prop === 'string') ops.push({ op: `set:${prop}`, args: [value] })
      t[prop] = value
      return true
    },
  })
  // Live read of the last value written to a state property.
  const read = (prop: string): unknown => target[prop]
  const sets = (prop: string): unknown[] =>
    ops.filter((o) => o.op === `set:${prop}`).map((o) => o.args[0])
  const calls = (op: string): Op[] => ops.filter((o) => o.op === op)
  const firstIndex = (pred: (o: Op) => boolean): number => ops.findIndex(pred)
  const lastIndex = (pred: (o: Op) => boolean): number =>
    ops.reduce((acc, o, i) => (pred(o) ? i : acc), -1)
  return {
    ctx: proxy as unknown as CanvasRenderingContext2D,
    ops, read, sets, calls, firstIndex, lastIndex,
  }
}

const style = (over: Partial<{ stroke: string | CanvasGradient; width: number; blur: number; color: string }> = {}) => ({
  stroke: '#33ff66',
  width: 1.5,
  blur: 8,
  ...over,
})

describe('SH2-8 — withGlow: sets the glow state, runs the draw, resets shadowBlur', () => {
  it('sets strokeStyle, lineWidth, shadowColor and shadowBlur from the style', async () => {
    const { withGlow } = await import('../src/glow')
    const { ctx, read } = recordingCtx()
    withGlow(ctx, style({ stroke: '#ff3355', width: 2, blur: 12, color: '#ff3355' }), () => {})
    expect(read('strokeStyle'), 'strokeStyle ← style.stroke').toBe('#ff3355')
    expect(read('lineWidth'), 'lineWidth ← style.width').toBe(2)
    expect(read('shadowColor'), 'shadowColor ← style.color').toBe('#ff3355')
    // final shadowBlur is 0 (reset); that it was 12 DURING the draw is asserted below.
  })

  it('runs the draw callback exactly once', async () => {
    const { withGlow } = await import('../src/glow')
    const { ctx } = recordingCtx()
    let calls = 0
    withGlow(ctx, style(), () => { calls++ })
    expect(calls, 'the draw callback must run exactly once').toBe(1)
  })

  it('the glow is ACTIVE while the draw runs (shadowBlur === style.blur at draw time)', async () => {
    const { withGlow } = await import('../src/glow')
    const { ctx, read } = recordingCtx()
    let blurDuringDraw: unknown = 'draw-never-ran'
    withGlow(ctx, style({ blur: 9 }), () => { blurDuringDraw = read('shadowBlur') })
    expect(blurDuringDraw, 'shadowBlur must be the glow radius WHILE the draw runs').toBe(9)
  })

  it('RESETS shadowBlur to 0 after the draw — the footgun fix', async () => {
    const { withGlow } = await import('../src/glow')
    const { ctx, read } = recordingCtx()
    withGlow(ctx, style({ blur: 8 }), () => {})
    expect(read('shadowBlur'), 'a lingering blur bleeds into the next non-glow draw — must reset to 0').toBe(0)
  })

  it('orders the writes: shadowBlur=blur BEFORE the draw, shadowBlur=0 AFTER it', async () => {
    const { withGlow } = await import('../src/glow')
    const { ctx, ops, firstIndex, lastIndex } = recordingCtx()
    withGlow(ctx, style({ blur: 8 }), () => { ops.push({ op: 'DRAW', args: [] }) })
    const drawAt = firstIndex((o) => o.op === 'DRAW')
    const blurOnAt = firstIndex((o) => o.op === 'set:shadowBlur' && o.args[0] === 8)
    const blurOffAt = lastIndex((o) => o.op === 'set:shadowBlur' && o.args[0] === 0)
    expect(drawAt, 'draw must actually run').toBeGreaterThan(-1)
    expect(blurOnAt, 'shadowBlur set to the glow radius before the draw').toBeGreaterThan(-1)
    expect(blurOnAt, 'glow must be set BEFORE the draw').toBeLessThan(drawAt)
    expect(blurOffAt, 'shadowBlur reset to 0 AFTER the draw').toBeGreaterThan(drawAt)
  })

  it('defaults shadowColor to `stroke` when `color` is omitted (solid-colour case)', async () => {
    const { withGlow } = await import('../src/glow')
    const { ctx, read } = recordingCtx()
    withGlow(ctx, style({ stroke: '#00ffff' }), () => {}) // no color → shadowColor tracks stroke
    expect(read('shadowColor'), 'shadowColor defaults to the stroke colour').toBe('#00ffff')
  })

  it('accepts a CanvasGradient stroke and keeps shadowColor a plain colour (tempest tube)', async () => {
    const { withGlow } = await import('../src/glow')
    const { ctx, read } = recordingCtx()
    const grad = ctx.createLinearGradient(0, 0, 0, 100) // proxy → a gradient-like object
    withGlow(ctx, style({ stroke: grad, color: '#88ddff' }), () => {})
    expect(read('strokeStyle'), 'a gradient stroke passes straight to strokeStyle').toBe(grad)
    expect(read('shadowColor'), 'a gradient cannot be a shadowColor — the explicit `color` is used').toBe('#88ddff')
  })

  it('does NOT use ctx.save/ctx.restore (mirrors the per-frame code it replaces)', async () => {
    const { withGlow } = await import('../src/glow')
    const { ctx, calls } = recordingCtx()
    withGlow(ctx, style(), () => {})
    expect(calls('save'), 'withGlow must not push/pop ctx state — no save()').toHaveLength(0)
    expect(calls('restore'), 'withGlow must not push/pop ctx state — no restore()').toHaveLength(0)
  })
})

describe('SH2-8 — glowPolyline: a glowing polyline built on withGlow', () => {
  const TRI = [[10, 20], [30, 40], [50, 10]] as ReadonlyArray<readonly [number, number]>

  it('moves to the first point and lines to the rest, in order', async () => {
    const { glowPolyline } = await import('../src/glow')
    const { ctx, calls } = recordingCtx()
    glowPolyline(ctx, TRI, style())
    expect(calls('beginPath'), 'must open a fresh path').toHaveLength(1)
    expect(calls('moveTo').map((o) => o.args), 'moveTo the FIRST point only').toEqual([[10, 20]])
    expect(calls('lineTo').map((o) => o.args), 'lineTo every subsequent point, in order').toEqual([[30, 40], [50, 10]])
    expect(calls('stroke'), 'must stroke the path').toHaveLength(1)
  })

  it('applies the glow style (strokeStyle / lineWidth / shadowColor / shadowBlur-then-0)', async () => {
    const { glowPolyline } = await import('../src/glow')
    const { ctx, read } = recordingCtx()
    glowPolyline(ctx, TRI, style({ stroke: '#ffcc00', width: 3, blur: 6 }))
    expect(read('strokeStyle')).toBe('#ffcc00')
    expect(read('lineWidth')).toBe(3)
    expect(read('shadowColor'), 'shadowColor defaults to the stroke colour').toBe('#ffcc00')
    expect(read('shadowBlur'), 'shadowBlur is reset to 0 after the stroke (footgun fix)').toBe(0)
  })

  it('the shadowBlur that stroked the path was the glow radius (not 0)', async () => {
    const { glowPolyline } = await import('../src/glow')
    const { ctx, ops } = recordingCtx()
    glowPolyline(ctx, TRI, style({ blur: 7 }))
    const strokeAt = ops.findIndex((o) => o.op === 'stroke')
    const blurBeforeStroke = ops
      .slice(0, strokeAt)
      .filter((o) => o.op === 'set:shadowBlur')
      .map((o) => o.args[0])
      .at(-1)
    expect(blurBeforeStroke, 'the stroke must be drawn WITH the glow, then reset').toBe(7)
  })

  it('does NOT closePath by default (an open polyline)', async () => {
    const { glowPolyline } = await import('../src/glow')
    const { ctx, calls } = recordingCtx()
    glowPolyline(ctx, TRI, style())
    expect(calls('closePath'), 'no close arg → the polyline stays open').toHaveLength(0)
  })

  it('closePath()s before stroke when close=true (a closed polygon)', async () => {
    const { glowPolyline } = await import('../src/glow')
    const { ctx, ops, calls } = recordingCtx()
    glowPolyline(ctx, TRI, style(), true)
    expect(calls('closePath'), 'close=true → the ring is closed').toHaveLength(1)
    const closeAt = ops.findIndex((o) => o.op === 'closePath')
    const strokeAt = ops.findIndex((o) => o.op === 'stroke')
    expect(closeAt, 'closePath must precede stroke').toBeLessThan(strokeAt)
  })

  it('strokes a single-point polyline without a lineTo and without throwing', async () => {
    const { glowPolyline } = await import('../src/glow')
    const { ctx, calls } = recordingCtx()
    expect(() => glowPolyline(ctx, [[5, 5]], style())).not.toThrow()
    expect(calls('moveTo').map((o) => o.args), 'the lone point is a moveTo').toEqual([[5, 5]])
    expect(calls('lineTo'), 'a single point has nothing to line to').toHaveLength(0)
  })

  it('is a no-op on an empty point list (draws nothing, never throws)', async () => {
    const { glowPolyline } = await import('../src/glow')
    const { ctx, calls } = recordingCtx()
    expect(() => glowPolyline(ctx, [], style())).not.toThrow()
    expect(calls('moveTo'), 'empty polyline moves nowhere').toHaveLength(0)
    expect(calls('stroke'), 'empty polyline strokes nothing').toHaveLength(0)
  })
})
