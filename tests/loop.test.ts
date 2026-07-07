// tests/loop.test.ts
//
// SH-5 (ADR-0001 extraction) — the fixed-timestep game-loop accumulator lifted
// into @arcade/shared/loop.
//
// star-wars and asteroids shipped a near-identical createLoop; asteroids later
// fixed a `last === 0` sentinel bug that was never backported. The sentinel is
// ambiguous — it cannot tell "no prior frame yet" apart from "the previous
// frame's timestamp genuinely was 0" — so asteroids stands a `started` boolean
// in its place. The extraction settles on asteroids' CORRECTED form (AC-1).
//
// This suite is the behavioural spec of the shared primitive:
//   - the first frame only establishes a time baseline (no sub-steps),
//   - `step` is always fed a constant dt of 1/hz,
//   - the accumulator runs floor(elapsed / dt) sub-steps and carries the
//     remainder out as the render `alpha` in [0, 1),
//   - a long stall (backgrounded tab) is clamped to 0.25s so steps can't flood,
//   - and — the crown jewel — a regression test that FAILS against the old
//     `last === 0` sentinel and passes only with the `started` fix.
//
// The primitive reads wall-clock from requestAnimationFrame's timestamp argument
// (the ONLY place time enters), so these tests stub rAF to CAPTURE the frame
// callback and drive it with chosen timestamps — fully deterministic, no DOM.
//
// RED until GREEN adds arcade-shared/src/loop.ts + the "./loop" subpath export.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLoop } from '../src/loop'

const HZ = 60
const DT = 1 / HZ // 0.016666… — the constant timestep fed to step()
const CLAMP = 0.25 // long-stall ceiling (seconds); 0.25s / (1/60) = 15 sub-steps

// --- capture-based requestAnimationFrame harness -----------------------------
// requestAnimationFrame stores the callback instead of scheduling it, so a test
// can drive frames deterministically with chosen timestamps. Each real frame
// reschedules itself, so `pending` is refreshed after every tick.
let pending: ((t: number) => void) | null
let nextRafId: number
let cancelled: number[]

beforeEach(() => {
  pending = null
  nextRafId = 0
  cancelled = []
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void): number => {
    pending = cb
    return ++nextRafId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    cancelled.push(id)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Drive exactly one scheduled frame at wall-clock `t` milliseconds.
function tick(t: number): void {
  const cb = pending
  if (cb === null) throw new Error('no frame scheduled — did you call start()?')
  pending = null
  cb(t)
}

describe('createLoop — shape & scheduling contract', () => {
  it('returns a Loop with start() and stop() methods', () => {
    const loop = createLoop(
      () => {},
      () => {},
    )
    expect(typeof loop.start).toBe('function')
    expect(typeof loop.stop).toBe('function')
  })

  it('start() schedules a frame but never steps synchronously', () => {
    let steps = 0
    const loop = createLoop(
      () => {
        steps++
      },
      () => {},
    )
    loop.start()
    expect(pending).not.toBeNull() // a frame is queued via requestAnimationFrame
    expect(steps).toBe(0) // …but no sub-step runs until a frame ticks
  })

  it('stop() cancels the scheduled animation frame by its id', () => {
    const loop = createLoop(
      () => {},
      () => {},
    )
    loop.start() // schedules rAF id 1
    loop.stop()
    expect(cancelled).toContain(1)
  })
})

describe('createLoop — fixed-timestep accumulator (AC-1)', () => {
  it('the first frame only establishes the baseline and runs no sub-steps', () => {
    let steps = 0
    const loop = createLoop(
      () => {
        steps++
      },
      () => {},
    )
    loop.start()
    tick(1234.5) // an arbitrary non-zero first timestamp
    expect(steps).toBe(0)
  })

  it('feeds step a constant dt of 1/hz regardless of real elapsed time', () => {
    const dts: number[] = []
    const loop = createLoop(
      (dt) => dts.push(dt),
      () => {},
    )
    loop.start()
    tick(0) // baseline
    tick(25) // +25ms → 0.025 / DT = 1.5 → exactly one sub-step
    expect(dts).toEqual([DT])
  })

  it('runs floor(elapsed / dt) sub-steps and carries the remainder as alpha', () => {
    let steps = 0
    let alpha = -1
    const loop = createLoop(
      () => {
        steps++
      },
      (a) => {
        alpha = a
      },
    )
    loop.start()
    tick(0) // baseline
    tick(90) // +90ms = 0.09s → 5 full DT steps, 0.4-of-a-step remainder
    expect(steps).toBe(5)
    expect(alpha).toBeCloseTo(0.4, 5) // remainder / DT, i.e. render interpolation
  })

  it('accumulates fractional frames: sub-dt frames add up rather than being dropped', () => {
    let steps = 0
    const loop = createLoop(
      () => {
        steps++
      },
      () => {},
    )
    loop.start()
    tick(0) // baseline
    tick(5) // +5ms < DT (16.67ms) → not enough for a sub-step yet
    expect(steps).toBe(0)
    tick(20) // +15ms more → 20ms total accumulated → one sub-step now fires
    expect(steps).toBe(1)
  })

  it('clamps a long stall to 0.25s so a backgrounded tab cannot flood sub-steps', () => {
    let steps = 0
    const loop = createLoop(
      () => {
        steps++
      },
      () => {},
    )
    loop.start()
    tick(0) // baseline
    tick(5000) // 5s stalled → unclamped ≈300 steps; clamp caps elapsed at 0.25s
    expect(steps).toBe(Math.round(CLAMP / DT)) // 15, not 300
  })

  it('honours a custom hz: both dt and sub-step cadence scale to 1/hz', () => {
    const dts: number[] = []
    const loop = createLoop(
      (dt) => dts.push(dt),
      () => {},
      30,
    )
    loop.start()
    tick(0) // baseline
    tick(50) // +50ms at 30Hz → 0.05 / (1/30) = 1.5 → one sub-step of 1/30
    expect(dts).toEqual([1 / 30])
  })
})

describe('createLoop — the started-boolean fix (AC-1, carried from asteroids)', () => {
  // The regression the extraction exists to preserve. With the old `last === 0`
  // sentinel, a first frame whose timestamp is 0 leaves `last` at 0, so the NEXT
  // frame re-enters the "first frame" branch, resets last to its own timestamp
  // with a zero delta, and silently swallows the entire elapsed interval. The
  // `started` boolean records "a frame has happened" independently of the clock
  // value, so a genuine t=0 baseline is handled correctly.
  it('counts the full elapsed time after a t=0 baseline frame (FAILS on last===0)', () => {
    let steps = 0
    const loop = createLoop(
      () => {
        steps++
      },
      () => {},
    )
    loop.start()
    tick(0) // baseline at wall-clock 0 — `started` records it; `last===0` cannot
    tick(1000) // +1s → clamped to 0.25s → 15 sub-steps
    // Corrected (`started`): 15. Buggy (`last===0`): the frame at 1000 is mistaken
    // for the first frame again → 0 sub-steps, the whole second is lost.
    expect(steps).toBe(Math.round(CLAMP / DT))
  })

  it('a t=0 baseline followed by a normal frame steps once, not zero times', () => {
    let steps = 0
    const loop = createLoop(
      () => {
        steps++
      },
      () => {},
    )
    loop.start()
    tick(0) // baseline at 0
    tick(20) // +20ms → one DT sub-step; the buggy sentinel would drop it
    expect(steps).toBe(1)
  })
})
