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

/**
 * Advance a fixed-timestep accumulator by `elapsed` seconds: clamp the span to
 * `maxFrame` (the spiral-of-death guard for a backgrounded tab), fold it into
 * `acc`, then run exactly one `step(dt)` per whole timestep. Returns the leftover
 * carry, always in [0, dt) — callers that interpolate derive `alpha = carry / dt`.
 *
 * Pure: it owns no wall clock and no requestAnimationFrame. The caller supplies
 * the elapsed span and holds `acc` across frames — which is what lets a consumer
 * with an INJECTED clock (tempest's testable now()) share this arithmetic rather
 * than duplicate it, while createLoop below drives it from the rAF timestamp.
 */
export function advanceFixedSteps(
  acc: number,
  elapsed: number,
  dt: number,
  step: StepFn,
  maxFrame = 0.25,
): number {
  acc += Math.min(maxFrame, elapsed)
  while (acc >= dt) {
    step(dt)
    acc -= dt
  }
  return acc
}

export function createLoop(step: StepFn, render: RenderFn, hz = 60): Loop {
  const dt = 1 / hz
  let acc = 0
  let last = 0
  let started = false
  let raf = 0

  function frame(now: number): void {
    if (!started) {
      // First frame only establishes the time baseline — no sub-steps. The
      // `started` flag (not a `last === 0` sentinel) is the carried fix: a
      // genuine t=0 baseline is recorded, so the next frame's full elapsed span
      // is counted rather than swallowed.
      started = true
      last = now
    } else {
      const elapsed = (now - last) / 1000
      last = now
      acc = advanceFixedSteps(acc, elapsed, dt, step)
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
