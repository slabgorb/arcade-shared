// @arcade/shared/pause — the PURE pause gate (SH2-12, epic SH2).
//
// Promoted from battlezone/src/shell/pause.ts (bz2-5) so every cabinet shares the
// identical MECHANISM — Escape toggles pause, and a paused frame is FROZEN — while
// keeping its own NUMBERS (keybind card, colour) in the game. Per the epic's
// verb/numbers rule this is the VERB.
//
// PURE and DOM-free (policed by tests/purity.test.ts): a boolean toggle plus a
// thunk-selector. The frozen-frame gate takes the game's OWN step as a zero-arg
// THUNK, so this module imports no game sim — the epic's core-purity
// non-negotiable. A game keeps its local wrapper if it has a richer step
// signature (battlezone's stepUnlessPaused(game,input,dt,paused) becomes a thin
// delegate: stepUnlessPaused(() => stepGame(game,input,dt), game, paused)).

/** The cabinet boots into play, never into a frozen screen. */
export const INITIAL_PAUSED = false

/**
 * The one key that pauses: Escape. Keys arrive already lowercased (the shells
 * lowercase every key before it reaches game logic), so we match the lowercased
 * DOM key name EXACTLY — never a prefix — so a movement key like 'e' can never be
 * mistaken for 'escape'.
 */
export function isPauseKey(key: string): boolean {
  return key === 'escape'
}

/** A fresh Escape press flips pause ↔ resume (a toggle, not a one-way latch). */
export function togglePaused(paused: boolean): boolean {
  return !paused
}

/**
 * The frame gate, generic over the game's state type. When paused, `step` is
 * never called and the prior state is returned untouched (the SAME reference: no
 * advance, no mutation), so resume continues deterministically. When active, this
 * is exactly `step()` — the pure core step the game supplies as a thunk.
 */
export function stepUnlessPaused<S>(step: () => S, prev: S, paused: boolean): S {
  return paused ? prev : step()
}
