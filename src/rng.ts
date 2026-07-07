// @arcade/shared/rng — the seeded, deterministic PRNG (mulberry32).
//
// SH-3 (ADR-0001) extraction. Four games shipped a logic-identical mulberry32
// under two contracts; the extraction settles on the MUTABLE one (AC-1):
// star-wars/battlezone/asteroids authored it verbatim, and battlezone's
// documented "local cursor" pattern keeps the DURABLE cross-frame state pure (a
// plain seed word carried in GameState) even though the generator mutates. This
// module is lifted BYTE-FOR-BYTE from those games' src/core/rng.ts; tempest's
// former immutable form (rngNext -> {value, rng}) is migrated onto this API,
// which produces the identical float sequence for any seed (proven in
// tests/rng.test.ts, tempest-parity block).
//
// Core-purity contract (every consuming game's most important rule): the ONLY
// source of randomness in a sim is a seeded Rng carried in state, so
// stepGame(state, input, dt) stays deterministic. `nextFloat` advances a local
// cursor; the durable state is the plain `seed` word, threaded by the reducer.

export interface Rng {
  seed: number
}

export function createRng(seed: number): Rng {
  return { seed: seed >>> 0 }
}

/** Advance the generator and return a float in [0, 1). Mutates `rng.seed`. */
export function nextFloat(rng: Rng): number {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0
  let t = rng.seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Integer in [0, n). */
export function nextInt(rng: Rng, n: number): number {
  return Math.floor(nextFloat(rng) * n)
}
