// tests/rng.test.ts
//
// SH-3 (ADR-0001 extraction) — the seeded PRNG (mulberry32) lifted into
// @arcade/shared/rng. Four games shipped logic-identical copies under two
// contracts:
//   MUTABLE  (star-wars/battlezone/asteroids): createRng/nextFloat->number
//            (mutates rng.seed)/nextInt.  { seed: number }
//   IMMUTABLE (tempest):                      makeRng/rngNext->{value,rng}/rngInt.
//            { s: number }
//
// AC-1 CONTRACT DECISION (Comrade, via TEA recommendation): the MUTABLE contract
// wins. Rationale: it is the incumbent for 3 of 4 games (only tempest migrates,
// ~16 call-sites/6 files vs 59/10 the other way), and battlezone's documented
// "local cursor" pattern already keeps the DURABLE cross-frame state pure (a
// plain seed word), so the mutable generator does not erode core purity. This
// suite is PORTED from asteroids/tests/rng.test.ts — asteroids is the source of
// truth for the mutable form — plus a cross-implementation determinism block
// that locks byte-identical output to EVERY game's pre-extraction RNG, including
// tempest's immutable form (the one game that changes contract).
//
// AC-3 is the crown jewel: the golden sequences below were captured from the
// ACTUAL pre-extraction implementations (verified mutable === immutable,
// byte-for-byte, across seeds incl. edge cases) so any drift is a determinism
// regression. RED until GREEN adds arcade-shared/src/rng.ts + the "./rng"
// subpath export.

import { describe, it, expect } from 'vitest'
import { createRng, nextFloat, nextInt, type Rng } from '../src/rng'

const GOLDEN_SEED = 12345

// createRng(12345); nextFloat x10 — the canonical mulberry32 sequence shared by
// asteroids/battlezone/star-wars (mutable) AND tempest (immutable). Verified
// identical to asteroids' historical GOLDEN_FLOATS.
const GOLDEN_FLOATS: readonly number[] = [
  0.9797282677609473,
  0.3067522644996643,
  0.484205421525985,
  0.817934412509203,
  0.5094283693470061,
  0.34747186047025025,
  0.07375754183158278,
  0.7663964673411101,
  0.9968264393974096,
  0.8250224851071835,
]

// createRng(12345); nextInt(rng, 6) x10 — matches asteroids' GOLDEN_INTS_N6.
const GOLDEN_INTS_N6: readonly number[] = [5, 1, 2, 4, 3, 2, 0, 4, 5, 4]

// tempest parity — the seeds tempest's own pre-extraction suite exercised. These
// were generated from tempest's IMMUTABLE rngNext() (makeRng -> rngNext ->
// {value, rng}); the shared MUTABLE nextFloat() must reproduce them exactly, or
// migrating tempest would silently change already-shipped replays.
const TEMPEST_IMMUTABLE_GOLDEN: ReadonlyArray<readonly [number, readonly number[]]> = [
  [42, [
    0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
    0.17481389874592423, 0.5265925421845168, 0.2732279943302274, 0.6247446539346129,
  ]],
  [1, [
    0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
    0.9683778982143849, 0.281103502959013, 0.6128388606011868, 0.7207431411370635,
  ]],
  [5, [
    0.6897749109193683, 0.7727432732935995, 0.21976301027461886, 0.6231788222212344,
    0.08513720124028623, 0.5921649402007461, 0.7201022456865758, 0.45810421253554523,
  ]],
  [7, [
    0.011704753153026104, 0.06195825757458806, 0.97690763277933, 0.6990287057124078,
    0.5214452685322613, 0.4055216880515218, 0.4662326325196773, 0.23992518591694534,
  ]],
]

function take<T>(n: number, fn: () => T): T[] {
  return Array.from({ length: n }, () => fn())
}

describe('createRng — the mutable seed word (AC-1 contract)', () => {
  it('stores the seed normalised to an unsigned 32-bit integer', () => {
    expect(createRng(GOLDEN_SEED).seed).toBe(12345)
    expect(createRng(0).seed).toBe(0)
  })

  it('masks negative and >32-bit seeds with >>> 0', () => {
    // -1 >>> 0 === 0xFFFFFFFF
    expect(createRng(-1).seed).toBe(4294967295)
    // (2^32 + 1) >>> 0 === 1
    expect(createRng(4294967297).seed).toBe(1)
  })

  it('truncates fractional seeds (>>> 0 floors toward zero), not rounds', () => {
    expect(createRng(1.9).seed).toBe(1)
  })

  it('is a plain serialisable value type ({ seed }), not a class instance', () => {
    const rng: Rng = createRng(GOLDEN_SEED)
    expect(Object.keys(rng)).toEqual(['seed'])
    expect(rng).toEqual({ seed: 12345 })
  })
})

describe('nextFloat — deterministic [0, 1) stream', () => {
  it('reproduces the golden sequence for a fixed seed', () => {
    const rng = createRng(GOLDEN_SEED)
    expect(GOLDEN_FLOATS).toHaveLength(10)
    expect(take(GOLDEN_FLOATS.length, () => nextFloat(rng))).toEqual([...GOLDEN_FLOATS])
  })

  it('returns values in [0, 1) across many iterations', () => {
    const rng = createRng(1)
    for (let i = 0; i < 5000; i++) {
      const f = nextFloat(rng)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
    }
  })

  it('is deterministic: two Rngs seeded identically yield identical sequences', () => {
    const a = createRng(GOLDEN_SEED)
    const b = createRng(GOLDEN_SEED)
    expect(take(20, () => nextFloat(a))).toEqual(take(20, () => nextFloat(b)))
  })

  it('produces different sequences for different seeds', () => {
    const a = take(10, () => nextFloat(createRng(1)))
    const b = take(10, () => nextFloat(createRng(2)))
    expect(a).not.toEqual(b)
  })

  it('advances (MUTATES) the Rng seed on each call — the chosen contract', () => {
    const rng = createRng(GOLDEN_SEED)
    const before = rng.seed
    nextFloat(rng)
    expect(rng.seed).not.toBe(before)
  })

  it('keeps distinct Rng values independent (no shared state)', () => {
    const a = createRng(1)
    const b = createRng(1)
    // Drain `a`; `b` must be untouched and still start the seed-1 sequence.
    take(5, () => nextFloat(a))
    expect(b.seed).toBe(1)
    expect(nextFloat(b)).toBe(nextFloat(createRng(1)))
  })
})

describe('nextInt — deterministic [0, n) integers', () => {
  it('reproduces the golden integer sequence for a fixed seed', () => {
    const rng = createRng(GOLDEN_SEED)
    expect(GOLDEN_INTS_N6).toHaveLength(10)
    expect(take(GOLDEN_INTS_N6.length, () => nextInt(rng, 6))).toEqual([...GOLDEN_INTS_N6])
  })

  it('returns values in [0, n) and exercises more than one bucket', () => {
    const rng = createRng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 5000; i++) {
      const v = nextInt(rng, 6)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(6)
      seen.add(v)
    }
    // A stuck generator (always 0) would be deterministic but useless.
    expect(seen.size).toBeGreaterThan(1)
  })

  it('always returns 0 for n === 1', () => {
    const rng = createRng(99)
    for (let i = 0; i < 100; i++) {
      expect(nextInt(rng, 1)).toBe(0)
    }
  })

  it('nextInt === floor(nextFloat * n) on a shared stream (definition lock)', () => {
    // Two independent Rngs seeded alike: draw floats from one, ints from the
    // other, and prove nextInt is exactly floor(nextFloat * n) draw-for-draw.
    const rf = createRng(2024)
    const ri = createRng(2024)
    for (let i = 0; i < 200; i++) {
      expect(nextInt(ri, 13)).toBe(Math.floor(nextFloat(rf) * 13))
    }
  })

  it('consumes the stream: nextInt advances the Rng seed', () => {
    const rng = createRng(GOLDEN_SEED)
    const before = rng.seed
    nextInt(rng, 6)
    expect(rng.seed).not.toBe(before)
  })
})

describe("determinism — byte-identical to every game's pre-extraction RNG (AC-3)", () => {
  it('reproduces tempest immutable-form golden sequences exactly (the contract-flip case)', () => {
    for (const [seed, golden] of TEMPEST_IMMUTABLE_GOLDEN) {
      const rng = createRng(seed)
      const got = take(golden.length, () => nextFloat(rng))
      expect(got, `seed ${seed}: shared mutable stream must match tempest's immutable rngNext`).toEqual([
        ...golden,
      ])
    }
  })

  it('matches the mutable games canonical sequence (star-wars/battlezone/asteroids)', () => {
    // The three mutable games ran this exact code; seed 12345 is the shared
    // golden. Identity, not approximation — one shared source for all three.
    const rng = createRng(GOLDEN_SEED)
    expect(take(GOLDEN_FLOATS.length, () => nextFloat(rng))).toEqual([...GOLDEN_FLOATS])
  })
})
