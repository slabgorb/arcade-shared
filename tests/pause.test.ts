// tests/pause.test.ts
//
// Story SH2-12 (epic SH2) — RED phase (Han Solo / TEA). The PURE pause gate,
// promoted from battlezone/src/shell/pause.ts (bz2-5) into @arcade/shared/pause
// so every cabinet shares the identical MECHANISM (Escape toggles pause → the
// sim frame is frozen) while keeping its own NUMBERS (keybind card, colour).
//
// This is the behavioural spec of the shared module (imported from ../src, like
// font.test.ts / loop.test.ts). DOM-freeness of the DELIVERED artifact is policed
// separately by tests/purity.test.ts, which reads dist/pause.js as source text.
//
// ── THE CONTRACT Dev implements to turn this GREEN ──────────────────────────
//   INITIAL_PAUSED: boolean               — the cabinet boots into play (false)
//   isPauseKey(key: string): boolean      — true ONLY for the (lowercased)
//                                           'escape' key; the shell lowercases
//                                           before calling (KeyboardTreads conv.)
//   togglePaused(paused): boolean         — a fresh Escape flips pause ↔ resume
//   stepUnlessPaused<S>(step, prev, paused): S
//        — GAME-AGNOSTIC: takes the game's OWN step as a zero-arg THUNK, so this
//          module imports no game sim (the epic's core-purity non-negotiable).
//        — paused → returns `prev` (the SAME reference) and NEVER calls `step`.
//        — active → returns `step()`; calls it EXACTLY once.
//     battlezone's local 4-arg stepUnlessPaused(game,input,dt,paused) becomes a
//     thin delegate: stepUnlessPaused(() => stepGame(game,input,dt), game, paused).
import { describe, it, expect, vi } from 'vitest'
import { INITIAL_PAUSED, isPauseKey, togglePaused, stepUnlessPaused } from '../src/pause'

describe('SH2-12 — isPauseKey: only Escape pauses', () => {
  it('recognises the (lowercased) Escape key', () => {
    expect(isPauseKey('escape'), "'escape' must be the pause key").toBe(true)
  })

  it('ignores every other key — no prefix/substring slip freezes the game', () => {
    // 'e' is a movement key in several cabinets and 'esc' is NOT the DOM key name;
    // neither may be mistaken for 'escape'. '' and ' ' must never pause.
    const notPause = [
      'e', 'd', 'i', 'k', 'w', 'a', 's', 'z', 'x',
      'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
      ' ', 'f', 'enter', 'shift', '1', 'esc', 'escapee', 'escap', '',
    ]
    for (const key of notPause) {
      expect(isPauseKey(key), `"${key}" must NOT pause the game`).toBe(false)
    }
  })

  it('matches the DOM key name EXACTLY — case-sensitive on the lowercased input', () => {
    // The shell lowercases before dispatch; a capitalised 'Escape' would mean the
    // caller failed to lowercase, and the gate must not silently paper over it.
    expect(isPauseKey('Escape')).toBe(false)
    expect(isPauseKey('ESCAPE')).toBe(false)
  })
})

describe('SH2-12 — togglePaused: Escape flips pause ↔ resume', () => {
  it('boots unpaused', () => {
    expect(INITIAL_PAUSED, 'the cabinet must boot into play, not a frozen screen').toBe(false)
  })

  it('flips in BOTH directions (a toggle, not a one-way latch)', () => {
    const paused = togglePaused(INITIAL_PAUSED)
    expect(paused, 'first Escape pauses').toBe(true)
    const resumed = togglePaused(paused)
    expect(resumed, 'second Escape resumes').toBe(false)
  })
})

describe('SH2-12 — stepUnlessPaused: the game-agnostic frozen-frame gate', () => {
  it('while paused, returns the prior state and NEVER calls step', () => {
    const prev = { frame: 7 }
    const step = vi.fn(() => ({ frame: 8 }))
    const next = stepUnlessPaused(step, prev, true)
    expect(next, 'a paused frame must return the prior state, untouched').toBe(prev)
    expect(step, 'a paused frame must not advance the sim (step never runs)').not.toHaveBeenCalled()
  })

  it('while active, returns step() and calls it EXACTLY once', () => {
    const prev = { frame: 7 }
    const advanced = { frame: 8 }
    const step = vi.fn(() => advanced)
    const next = stepUnlessPaused(step, prev, false)
    expect(next, 'an active frame must return the stepped state').toBe(advanced)
    expect(next, 'an active frame must not return the prior state').not.toBe(prev)
    expect(step, 'step must run exactly once per active frame').toHaveBeenCalledTimes(1)
  })

  it('is generic over the state type — imports no game sim', () => {
    // The gate is parametric: it works on ANY state (a string, a number, an
    // object) because it only chooses between `prev` and `step()`. This is the
    // structural guarantee that @arcade/shared/pause depends on no game module.
    expect(stepUnlessPaused(() => 'B', 'A', true)).toBe('A')
    expect(stepUnlessPaused(() => 'B', 'A', false)).toBe('B')
    expect(stepUnlessPaused(() => 2, 1, false)).toBe(2)
  })

  it('holding pause across many frames never advances, then resume steps once', () => {
    const prev = { t: 0 }
    const step = vi.fn(() => ({ t: 1 }))
    let held: { t: number } = prev
    for (let i = 0; i < 5; i++) held = stepUnlessPaused(step, held, true)
    expect(held, 'no paused frame may advance the sim').toBe(prev)
    expect(step, 'no step may run while paused').not.toHaveBeenCalled()
    const resumed = stepUnlessPaused(step, held, false)
    expect(resumed, 'resume advances exactly one frame').toEqual({ t: 1 })
    expect(step, 'resume runs step exactly once').toHaveBeenCalledTimes(1)
  })
})
