// @arcade/shared/loop — the fixed-timestep game-loop accumulator.
//
// SH-5 (ADR-0001) extraction. star-wars and asteroids shipped a near-identical
// createLoop; asteroids later fixed a `last === 0` sentinel bug that was never
// backported to star-wars. This module is lifted BYTE-FOR-BYTE from asteroids'
// src/shell/loop.ts — the CORRECTED form — so the extraction settles the epic on
// the fix rather than the bug (proven in tests/loop.test.ts).
//
// The fix: the star-wars source detects "no prior frame yet" with `last === 0`.
// That sentinel is ambiguous — it cannot tell "not started" apart from "the
// previous frame's timestamp genuinely was 0" — so a `started` flag stands in
// for it here. A first frame whose rAF timestamp is 0 is then handled correctly
// as a baseline, and the next frame's full elapsed interval is counted instead
// of being silently swallowed.
//
// This is the ONLY place wall-clock time is read (via requestAnimationFrame's
// timestamp argument); it feeds the core a constant `dt` so the simulation stays
// deterministic and frame-rate independent. Rendering interpolates with the
// leftover accumulator `alpha` (acc / dt) in [0, 1).

export type StepFn = (dt: number) => void
export type RenderFn = (alpha: number) => void

export interface Loop {
  start(): void
  stop(): void
}

export function createLoop(step: StepFn, render: RenderFn, hz = 60): Loop {
  const dt = 1 / hz
  let acc = 0
  let last = 0
  let started = false
  let raf = 0

  function frame(now: number): void {
    if (!started) {
      started = true
      last = now
    } else {
      acc += Math.min(0.25, (now - last) / 1000) // clamp huge tab-switch gaps
      last = now
    }
    while (acc >= dt) {
      step(dt)
      acc -= dt
    }
    render(acc / dt)
    raf = requestAnimationFrame(frame)
  }

  return {
    start(): void {
      acc = 0
      last = 0
      started = false
      raf = requestAnimationFrame(frame)
    },
    stop(): void {
      cancelAnimationFrame(raf)
    },
  }
}
