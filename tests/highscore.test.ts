// tests/highscore.test.ts
//
// SH-4 (ADR-0001 extraction) — the high-score TABLE logic + localStorage
// persistence seam lifted into @arcade/shared/highscore. Three games shipped
// algorithm-identical copies split across two files each
// (src/core/highscore.ts + src/shell/storage.ts), under TWO divergent contracts:
//
//   DOMAIN FIELD   tempest/star-wars record `level`; asteroids records `wave`.
//                  The shared entry is therefore GENERIC over the domain field:
//                  HighScoreEntry<'level'> and HighScoreEntry<'wave'> (AC-1).
//
//   ROW GUARD      tempest/star-wars validate `typeof x === 'number'` (which
//                  ADMITS Infinity/NaN); asteroids hardened to
//                  `Number.isFinite`, and the LOBBY's getTopScore likewise
//                  demands a finite `.score`. This extraction settles on the
//                  STRICTER, finite guard for everyone — a deliberate
//                  strengthening of tempest/star-wars (logged as a TEA deviation).
//                  A poisoned `1e999` -> Infinity row no longer survives.
//
// Contract decisions pinned here (logged in .session/SH-4-session.md):
//  - GENERIC DOMAIN (AC-1): HighScoreEntry<DomainKey extends string> carries a
//    numeric field named by the type parameter (`level` | `wave`). Because the
//    build tsconfig compiles only `src/`, genericity is proven at RUNTIME via the
//    domain-aware guard/storage factory below — not by a compile-only annotation.
//  - ROW GUARD SPLIT: `isHighScoreRow` is the domain-AGNOSTIC base guard
//    (name:string + FINITE score) — the guard the LOBBY imports (AC-3, it reads
//    only `.score`). `makeHighScoreRowGuard(domainKey)` layers the finite
//    domain-field check on top — the guard the GAMES use, so the residual
//    per-game `Number.isFinite(row[field])` line is extracted, not re-copied
//    (AC-2 "duplication removed").
//  - SINGLE MAX (AC-4): MAX_HIGH_SCORES = 10 lives here alone; no per-repo
//    redeclaration. `qualifiesForHighScore` reads it, so the board cap is pinned
//    to the export.
//  - FACTORY: makeHighScoreStorage(gameId, validator) -> { load, save }, bound to
//    the `${gameId}-high-scores` key, degrading gracefully on every storage
//    failure mode (missing / corrupt / not-an-array / unavailable / throwing /
//    quota) exactly as the games' storage.ts did.
//
// SCOPE: this suite covers the SHARED module only (AC-1, AC-4, and the contract
// AC-3 hangs on). The consumer migration — games writing via this module and the
// lobby importing highScoreKey + isHighScoreRow (AC-2, AC-3) — lands in GREEN
// across tempest/star-wars/asteroids/lobby and is verified by each repo's own
// suite, mirroring SH-3's multi-repo shape.
//
// src/highscore.ts does NOT exist pre-GREEN, so this file fails to LOAD (module
// not found) until Dev creates it + adds the "./highscore" subpath export — that
// import failure IS the RED signal. Tests run in vitest's default `node` env (no
// localStorage), so each storage test installs a fake on globalThis.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  MAX_HIGH_SCORES,
  highScoreKey,
  qualifiesForHighScore,
  insertHighScore,
  isHighScoreRow,
  makeHighScoreRowGuard,
  makeHighScoreStorage,
  type HighScoreEntry,
} from '../src/highscore'

// The two domain shapes the games record. Exercising BOTH proves the module is
// generic over the domain field name, not hardcoded to one game's counter.
type LevelEntry = HighScoreEntry<'level'>
type WaveEntry = HighScoreEntry<'wave'>

// Representative tables, descending by score, mixing rows WITH and WITHOUT the
// optional `date` so `date?` is exercised on both survivors and absentees.
const LEVEL_TABLE: LevelEntry[] = [
  { name: 'AAA', score: 50000, level: 9, date: '2026-07-07T00:00:00.000Z' },
  { name: 'BOB', score: 30000, level: 5 },
  { name: 'CDE', score: 10000, level: 2, date: '2026-07-06T12:00:00.000Z' },
]

const WAVE_TABLE: WaveEntry[] = [
  { name: 'ZZZ', score: 40000, wave: 4, date: '2026-07-07T00:00:00.000Z' },
  { name: 'YYY', score: 20000, wave: 2 },
]

// ---- Fake Storage (node test env has no localStorage) -----------------------
// Ported verbatim from the games' storage.test.ts so the shared seam is proven
// against the exact IO harness it replaces.

function makeFakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial))
  const storage = {
    get length(): number {
      return map.size
    },
    clear(): void {
      map.clear()
    },
    getItem(key: string): string | null {
      return map.has(key) ? (map.get(key) as string) : null
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null
    },
    removeItem(key: string): void {
      map.delete(key)
    },
    setItem(key: string, value: string): void {
      map.set(key, String(value))
    },
  }
  return storage as unknown as Storage
}

// setItem always throws — a full quota. A plain Error (not DOMException) on
// purpose: the impl must catch broadly.
function makeQuotaStorage(): Storage {
  const storage = makeFakeStorage()
  storage.setItem = () => {
    throw new Error('QuotaExceededError: storage is full')
  }
  return storage
}

function setLocalStorage(value: Storage | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value,
  })
}

// Private-browsing / sandboxed iframes where even *accessing* localStorage throws.
function setThrowingLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get(): never {
      throw new Error('SecurityError: localStorage access denied')
    },
  })
}

beforeEach(() => {
  // Graceful-degradation paths may log; keep test output clean. We do NOT assert
  // on logging (impl may use warn/error/none) — only on behaviour.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  vi.restoreAllMocks()
})

// =============================================================================
// AC-4 — single MAX_HIGH_SCORES source of truth
// =============================================================================

describe('MAX_HIGH_SCORES (AC-4: one shared source of truth)', () => {
  it('is the classic 10-deep arcade ladder', () => {
    expect(MAX_HIGH_SCORES).toBe(10)
  })

  it('is the cap qualifiesForHighScore enforces (board is full at exactly this length)', () => {
    // Tie the export to the behaviour: a board of length MAX is "full" and rejects
    // a non-beating score; one shorter still has room.
    const full = levelTableOf(MAX_HIGH_SCORES) // lowest = 100
    const nearlyFull = levelTableOf(MAX_HIGH_SCORES - 1)
    expect(qualifiesForHighScore(full, 100)).toBe(false) // equal to lowest, board full
    expect(qualifiesForHighScore(nearlyFull, 1)).toBe(true) // room remains
  })
})

// =============================================================================
// AC-1 / AC-3 — the {gameId}-high-scores key builder
// =============================================================================

describe('highScoreKey (AC-1 key-builder; AC-3 the literal the lobby + games share)', () => {
  it('builds `${gameId}-high-scores` — the exact key every game persists under', () => {
    expect(highScoreKey('tempest')).toBe('tempest-high-scores')
    expect(highScoreKey('star-wars')).toBe('star-wars-high-scores')
    expect(highScoreKey('asteroids')).toBe('asteroids-high-scores')
    expect(highScoreKey('battlezone')).toBe('battlezone-high-scores')
  })

  it('is a pure string function of the gameId (isolates one game from another)', () => {
    expect(highScoreKey('a')).not.toBe(highScoreKey('b'))
  })
})

// =============================================================================
// AC-1 — qualifiesForHighScore (ported from the games' identical table logic)
// =============================================================================

// A descending LEVEL table of `n` rows, scores n*100 .. 100 (lowest = 100).
const levelTableOf = (n: number): LevelEntry[] =>
  Array.from({ length: n }, (_, i) => ({ name: `E${i}`, score: (n - i) * 100, level: 1 }))

describe('qualifiesForHighScore — partial/empty board (fewer than MAX entries)', () => {
  it('qualifies any strictly-positive score when the table is empty', () => {
    expect(qualifiesForHighScore([], 1)).toBe(true)
    expect(qualifiesForHighScore([], 5000)).toBe(true)
  })

  it('does NOT qualify a score of 0, even on an empty board', () => {
    expect(qualifiesForHighScore([], 0)).toBe(false)
  })

  it('does NOT qualify a negative score', () => {
    expect(qualifiesForHighScore([], -1)).toBe(false)
  })

  it('qualifies a positive score below every existing entry while the table is not full', () => {
    expect(qualifiesForHighScore(levelTableOf(3), 50)).toBe(true) // 300/200/100, not full
  })

  it('still rejects a 0 score on a partial board', () => {
    expect(qualifiesForHighScore(levelTableOf(3), 0)).toBe(false)
  })
})

describe('qualifiesForHighScore — full board (exactly MAX entries)', () => {
  it('qualifies a score STRICTLY GREATER than the lowest entry', () => {
    expect(qualifiesForHighScore(levelTableOf(MAX_HIGH_SCORES), 101)).toBe(true) // lowest = 100
  })

  it('does NOT qualify a score EQUAL to the lowest entry (strict boundary)', () => {
    expect(qualifiesForHighScore(levelTableOf(MAX_HIGH_SCORES), 100)).toBe(false)
  })

  it('does NOT qualify a score below the lowest entry', () => {
    expect(qualifiesForHighScore(levelTableOf(MAX_HIGH_SCORES), 99)).toBe(false)
  })
})

describe('qualifiesForHighScore — generic over the domain field', () => {
  it('works on a WAVE board too (reads only .score, never the domain field)', () => {
    const waveBoard: WaveEntry[] = [
      { name: 'A', score: 300, wave: 3 },
      { name: 'B', score: 100, wave: 1 },
    ]
    expect(qualifiesForHighScore(waveBoard, 50)).toBe(true) // room remains
    expect(qualifiesForHighScore(waveBoard, 0)).toBe(false)
  })
})

// =============================================================================
// AC-1 — insertHighScore (ordering, ties, truncation, purity, generic)
// =============================================================================

describe('insertHighScore — ordering, ties, truncation, purity', () => {
  const entry = (name: string, score: number, level = 1): LevelEntry => ({ name, score, level })

  it('inserts into an empty table', () => {
    const out = insertHighScore([], entry('AAA', 500))
    expect(out.map((e) => e.name)).toEqual(['AAA'])
    expect(out).toHaveLength(1)
  })

  it('keeps the table sorted descending by score after insert', () => {
    const out = insertHighScore([entry('A', 300), entry('B', 100)], entry('X', 200))
    expect(out.map((e) => e.score)).toEqual([300, 200, 100])
    expect(out.map((e) => e.name)).toEqual(['A', 'X', 'B'])
  })

  it('places a tied new entry AFTER existing entries of equal score', () => {
    const out = insertHighScore(
      [entry('A', 300), entry('B', 200), entry('C', 100)],
      entry('X', 200), // ties with B
    )
    expect(out.map((e) => e.name)).toEqual(['A', 'B', 'X', 'C'])
  })

  it('truncates to MAX_HIGH_SCORES, dropping the overflow on a high insert', () => {
    const out = insertHighScore(levelTableOf(MAX_HIGH_SCORES), entry('TOP', 5000))
    expect(out).toHaveLength(MAX_HIGH_SCORES)
    expect(out[0].name).toBe('TOP')
    expect(out.map((e) => e.score)).not.toContain(100) // old lowest dropped
  })

  it('drops a new entry whose score is below a full board (no displacement)', () => {
    const t = levelTableOf(MAX_HIGH_SCORES) // lowest = 100
    const out = insertHighScore(t, entry('LOW', 50))
    expect(out).toHaveLength(MAX_HIGH_SCORES)
    expect(out.map((e) => e.name)).not.toContain('LOW')
    expect(out.map((e) => e.score)).toEqual(t.map((e) => e.score)) // top-MAX unchanged
  })

  it('is pure: does not mutate the input table', () => {
    const t = [entry('A', 300), entry('B', 100)]
    const snapshot = JSON.parse(JSON.stringify(t))
    insertHighScore(t, entry('X', 200))
    expect(t).toEqual(snapshot)
    expect(t).toHaveLength(2)
  })

  it('is generic over the domain field (inserts WAVE entries too)', () => {
    const waveBoard: WaveEntry[] = [{ name: 'A', score: 300, wave: 3 }]
    const out = insertHighScore(waveBoard, { name: 'X', score: 400, wave: 4 })
    expect(out.map((e) => e.name)).toEqual(['X', 'A'])
    expect(out[0].wave).toBe(4) // domain field carried through the sort
  })
})

// =============================================================================
// AC-1 / AC-3 — isHighScoreRow: the domain-AGNOSTIC base guard (the lobby's)
// =============================================================================
//
// The lobby reads only `.score` (finite), tolerating any extra/missing fields —
// so the shared guard the lobby imports checks name + FINITE score and nothing
// about the domain field. lang-review #10/#1: JSON.parse output is validated per
// row, never trusted via `as T`.

describe('isHighScoreRow — base guard (name + finite score), what the lobby imports', () => {
  it('accepts a well-formed base row (extra domain/date fields tolerated)', () => {
    expect(isHighScoreRow({ name: 'AAA', score: 100 })).toBe(true)
    expect(isHighScoreRow({ name: 'AAA', score: 100, level: 3, date: 'x' })).toBe(true)
    expect(isHighScoreRow({ name: 'AAA', score: 100, wave: 3 })).toBe(true)
  })

  it('rejects non-object members (null, number, string, boolean, array)', () => {
    for (const v of [null, 42, 'AAA', true, []]) {
      expect(isHighScoreRow(v)).toBe(false)
    }
    expect(isHighScoreRow(undefined)).toBe(false)
    expect(isHighScoreRow({})).toBe(false)
  })

  it('rejects a non-string name', () => {
    expect(isHighScoreRow({ name: 9, score: 100 })).toBe(false)
  })

  it('rejects a non-number score', () => {
    expect(isHighScoreRow({ name: 'AAA', score: '100' })).toBe(false)
  })

  it('rejects a missing score', () => {
    expect(isHighScoreRow({ name: 'AAA' })).toBe(false)
  })

  // The strengthening: tempest/star-wars used loose `typeof === number` (admits
  // Infinity). The shared guard requires FINITE — matching asteroids + the lobby's
  // scoreOf. A poisoned 1e999 -> Infinity row (the only non-finite value reachable
  // via JSON.parse; NaN has no JSON literal) must NOT pass.
  it('rejects a non-finite score (Infinity via 1e999)', () => {
    const poisoned: unknown = JSON.parse('{"name":"XXX","score":1e999}')
    expect(isHighScoreRow(poisoned)).toBe(false)
  })
})

// =============================================================================
// AC-1 — makeHighScoreRowGuard: domain-AWARE guard (what the games use)
// =============================================================================
//
// Layers the finite domain-field check onto the base guard, generic over the
// field NAME. This is the shared home for the per-game `Number.isFinite(row.wave)`
// line, so extracting the module removes that duplication (AC-2) rather than
// re-copying it four times. Runtime-observable proof that the module is generic
// over the domain field.

describe('makeHighScoreRowGuard — domain-aware guard, generic over the field name', () => {
  const guardLevel = () => makeHighScoreRowGuard('level')
  const guardWave = () => makeHighScoreRowGuard('wave')

  it("a 'level' guard accepts a well-formed level row", () => {
    expect(guardLevel()({ name: 'AAA', score: 100, level: 3 })).toBe(true)
    expect(guardLevel()({ name: 'AAA', score: 100, level: 3, date: 'x' })).toBe(true)
  })

  it("a 'level' guard rejects a row missing the level field", () => {
    expect(guardLevel()({ name: 'AAA', score: 100 })).toBe(false)
  })

  it("a 'level' guard rejects a row carrying only the OTHER domain field (wave, not level)", () => {
    // Proves the guard keys off the requested field name, not any numeric field.
    expect(guardLevel()({ name: 'AAA', score: 100, wave: 3 })).toBe(false)
  })

  it("a 'level' guard rejects a non-finite / non-number level", () => {
    const poisoned: unknown = JSON.parse('{"name":"AAA","score":100,"level":1e999}')
    expect(guardLevel()(poisoned)).toBe(false)
    expect(guardLevel()({ name: 'AAA', score: 100, level: '3' })).toBe(false)
  })

  it("a 'wave' guard is the mirror image (accepts wave, rejects level-only)", () => {
    expect(guardWave()({ name: 'AAA', score: 100, wave: 2 })).toBe(true)
    expect(guardWave()({ name: 'AAA', score: 100, level: 2 })).toBe(false)
    expect(guardWave()({ name: 'AAA', score: 100 })).toBe(false)
  })

  it('still enforces the base contract (finite score, string name)', () => {
    expect(guardWave()({ name: 9, score: 100, wave: 2 })).toBe(false)
    const poisonedScore: unknown = JSON.parse('{"name":"AAA","score":1e999,"wave":2}')
    expect(guardWave()(poisonedScore)).toBe(false)
  })
})

// =============================================================================
// makeHighScoreStorage(gameId, validator) — the persistence factory
// =============================================================================

describe('makeHighScoreStorage — load()', () => {
  const store = () => makeHighScoreStorage('asteroids', makeHighScoreRowGuard('wave'))
  const KEY = 'asteroids-high-scores'

  const loadFrom = (payload: unknown): WaveEntry[] => {
    setLocalStorage(makeFakeStorage({ [KEY]: JSON.stringify(payload) }))
    return store().load()
  }

  it('reads the table from the `${gameId}-high-scores` key', () => {
    setLocalStorage(makeFakeStorage({ [KEY]: JSON.stringify(WAVE_TABLE) }))
    expect(store().load()).toEqual(WAVE_TABLE)
  })

  it('returns [] when no key is present', () => {
    setLocalStorage(makeFakeStorage())
    expect(store().load()).toEqual([])
  })

  it('preserves entry shape including the optional date field', () => {
    setLocalStorage(makeFakeStorage({ [KEY]: JSON.stringify(WAVE_TABLE) }))
    const table = store().load()
    expect(table).toHaveLength(2)
    expect(table[0]).toMatchObject({ name: 'ZZZ', score: 40000, wave: 4 })
    expect(table[0].date).toBe('2026-07-07T00:00:00.000Z')
    expect(table[1].date).toBeUndefined()
    expect('date' in table[1]).toBe(false)
  })

  it('returns [] for corrupt JSON without throwing', () => {
    setLocalStorage(makeFakeStorage({ [KEY]: '{ not valid json' }))
    expect(() => store().load()).not.toThrow()
    expect(store().load()).toEqual([])
  })

  it('returns [] when stored JSON is valid but not a table array', () => {
    for (const malformed of ['{"foo":"bar"}', 'null', '42', '"a string"', 'true']) {
      setLocalStorage(makeFakeStorage({ [KEY]: malformed }))
      expect(store().load()).toEqual([])
    }
  })

  it('returns [] when localStorage is undefined without throwing', () => {
    setLocalStorage(undefined)
    expect(() => store().load()).not.toThrow()
    expect(store().load()).toEqual([])
  })

  it('returns [] when accessing localStorage throws without throwing', () => {
    setThrowingLocalStorage()
    expect(() => store().load()).not.toThrow()
    expect(store().load()).toEqual([])
  })

  // The validator is honoured: malformed and WRONG-DOMAIN rows are dropped.
  it('drops malformed rows via the injected validator, keeping well-formed ones in order', () => {
    const mixed: unknown[] = [
      { name: 'AAA', score: 50000, wave: 4, date: '2026-07-07T00:00:00.000Z' }, // keep
      {}, // drop
      { name: 'BOB', score: 30000, wave: 3 }, // keep
      { name: 9, score: 'x' }, // drop
      null, // drop
      { name: 'CDE', score: 10000, level: 2 }, // drop — wrong domain (level, not wave)
    ]
    expect(loadFrom(mixed)).toEqual([
      { name: 'AAA', score: 50000, wave: 4, date: '2026-07-07T00:00:00.000Z' },
      { name: 'BOB', score: 30000, wave: 3 },
    ])
  })

  it('drops a non-finite score row (1e999 -> Infinity)', () => {
    setLocalStorage(makeFakeStorage({ [KEY]: '[{"name":"XXX","score":1e999,"wave":1}]' }))
    expect(store().load()).toEqual([])
  })

  it('returns [] when every row is malformed', () => {
    expect(loadFrom([{}, { name: 9, score: 'x' }, null, 42, 'AAA', true, []])).toEqual([])
  })
})

describe('makeHighScoreStorage — save()', () => {
  const store = () => makeHighScoreStorage('asteroids', makeHighScoreRowGuard('wave'))
  const KEY = 'asteroids-high-scores'

  it('writes the table as JSON under the `${gameId}-high-scores` key', () => {
    const fake = makeFakeStorage()
    setLocalStorage(fake)
    store().save(WAVE_TABLE)
    const raw = fake.getItem(KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toEqual(WAVE_TABLE)
  })

  it('round-trips: a saved table loads back equal', () => {
    setLocalStorage(makeFakeStorage())
    const s = store()
    s.save(WAVE_TABLE)
    expect(s.load()).toEqual(WAVE_TABLE)
  })

  it('persists an empty table without throwing', () => {
    setLocalStorage(makeFakeStorage())
    const s = store()
    expect(() => s.save([])).not.toThrow()
    expect(s.load()).toEqual([])
  })

  it('does not throw when the storage quota is exceeded', () => {
    setLocalStorage(makeQuotaStorage())
    expect(() => store().save(WAVE_TABLE)).not.toThrow()
  })

  it('does not throw when localStorage is undefined', () => {
    setLocalStorage(undefined)
    expect(() => store().save(WAVE_TABLE)).not.toThrow()
  })

  it('does not throw when accessing localStorage throws', () => {
    setThrowingLocalStorage()
    expect(() => store().save(WAVE_TABLE)).not.toThrow()
  })

  it('accepts a readonly table (never mutates its input) and does not mutate a frozen table', () => {
    setLocalStorage(makeFakeStorage())
    const frozen: readonly WaveEntry[] = Object.freeze(WAVE_TABLE.map((e) => ({ ...e })))
    expect(() => store().save(frozen)).not.toThrow()
    expect(frozen).toEqual(WAVE_TABLE)
  })
})

describe('makeHighScoreStorage — per-game isolation + lobby cross-check', () => {
  it('two gameIds do not collide: each store reads/writes only its own key', () => {
    setLocalStorage(makeFakeStorage())
    const tempest = makeHighScoreStorage('tempest', makeHighScoreRowGuard('level'))
    const asteroids = makeHighScoreStorage('asteroids', makeHighScoreRowGuard('wave'))
    tempest.save(LEVEL_TABLE)
    asteroids.save(WAVE_TABLE)
    expect(tempest.load()).toEqual(LEVEL_TABLE)
    expect(asteroids.load()).toEqual(WAVE_TABLE)
  })

  // AC-3 end-to-end, without importing lobby code: what a game persists is exactly
  // what the lobby's contract (highScoreKey + isHighScoreRow-filtered max .score)
  // will read as the tile's top score.
  it('what the factory writes is what the lobby would read as the top score', () => {
    const fake = makeFakeStorage()
    setLocalStorage(fake)
    makeHighScoreStorage('tempest', makeHighScoreRowGuard('level')).save(LEVEL_TABLE)

    // Replay the lobby's read using ONLY shared exports.
    const raw = fake.getItem(highScoreKey('tempest'))
    const parsed: unknown = JSON.parse(raw as string)
    expect(Array.isArray(parsed)).toBe(true)
    const scores = (parsed as unknown[])
      .filter(isHighScoreRow)
      .map((row) => row.score)
    expect(scores.length).toBeGreaterThan(0)
    expect(Math.max(...scores)).toBe(50000) // LEVEL_TABLE's top score
  })
})

// =============================================================================
// Rule coverage (lang-review typescript.md) — type-stripped signals
// =============================================================================
//
// The build tsconfig compiles only `src/`, and vitest strips types via esbuild,
// so `readonly` parameter annotations get NO compile-time gate from either. A
// source-text assertion is the RED signal that the shared API declares the
// no-mutation contract (lang-review #2: readonly on array params not mutated).
// The behavioural purity tests above cover the runtime side.

describe('source signatures (lang-review #2: readonly array params)', () => {
  const src = (): string =>
    readFileSync(fileURLToPath(new URL('../src/highscore.ts', import.meta.url)), 'utf8')

  it('declares qualifiesForHighScore with a readonly table parameter', () => {
    expect(src()).toMatch(/export function qualifiesForHighScore\s*(<[^>]*>)?\s*\([^)]*\breadonly\b/)
  })

  it('declares insertHighScore with a readonly table parameter', () => {
    expect(src()).toMatch(/export function insertHighScore\s*(<[^>]*>)?\s*\([^)]*\breadonly\b/)
  })

  it('validates parsed rows at runtime (a type predicate backed by real checks, not `as T`)', () => {
    const text = src()
    // isHighScoreRow must be a genuine `value is` predicate — lang-review #1/#10.
    expect(text).toMatch(/isHighScoreRow\s*\([^)]*\)\s*:\s*value is\b/)
    expect(text).toMatch(/Number\.isFinite/) // the finite-score contract lives here
  })
})
