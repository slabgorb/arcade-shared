// tests/highscore-summary.test.ts
//
// lb2-8 — WIDEN the cross-origin summary from a single bare number to a TOP-N list of
// name+score rows, so the lobby can draw the design's HIGH SCORES board (a five-row
// ladder with player initials), not just one number on a tile.
//
// ADR-0004 shipped `arcade-hi-<gameId> = <top score>` — one integer, no name. That is
// enough for a tile but not for a ladder: the board needs five ROWS, each with a NAME.
// This story widens the ONE published summary cookie to carry rows; the top score the
// tile already reads stays derivable from row 0, so the tile never regresses.
//
// These tests pin the CONTRACT, not the encoding:
//   - `makeHighScoreStorage(id, guard).save(table)` publishes a rows summary.
//   - `readTopScores(id)` reads the board's ladder back (up to PUBLISHED_SUMMARY_DEPTH).
//   - `readTopScore(id)` still yields the single top score for the tile.
// The exact cookie byte-encoding is Dev's call; every assertion here is about observable
// behaviour through the public API + the real cookie jar.
//
// AC-1's WRITTEN half — amending ADR-0004 in docs/adr/ — is NOT tested here: that ADR
// lives in the ORCHESTRATOR repo, outside this library's CI checkout, so a file-read
// guard would pass locally and fail on GitHub. The behavioural half (rows, not a number)
// is what this file enforces; the Reviewer reads the amended ADR's prose.
//
// NOTE (RED, for Dev): widening the published summary to rows changes the cookie VALUE
// from `124500` to a rows encoding. `tests/highscore-publish.test.ts` asserts the old
// bare-number value in ~10 places and its `spyTransport` implements the old
// `publish(gameId, number)` signature — those are EXPECTED to need migration to the rows
// shape during GREEN. They are not a regression; they are the cost of the format change.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { makeCookieJar, locationStub, PROD_TEMPEST, type CookieJar } from './helpers/cookie-jar'
import { makeFakeStorage } from './helpers/storage-stub'
import {
  makeHighScoreStorage,
  makeHighScoreRowGuard,
  readTopScore,
  readTopScores,
  PUBLISHED_SUMMARY_DEPTH,
  type TopScoreRow,
} from '../src/highscore'

const guard = makeHighScoreRowGuard('level')
const COOKIE = 'arcade-hi-tempest'

/** A tempest-shaped table. Each row carries the arcade initials + score the board needs,
 *  plus the game's own `level` domain field (which must NOT ride across into the summary). */
type Row = [name: string, score: number]
const table = (...rows: Row[]) =>
  rows.map(([name, score], i) => ({ name, score, level: i + 1 }))

/** Install a browser (cookie jar + location) and a per-origin localStorage, exactly as
 *  the real publish path sees them. */
function installBrowser(jar: CookieJar, storage: Storage): void {
  const loc = locationStub(PROD_TEMPEST)
  vi.stubGlobal('document', jar.document)
  vi.stubGlobal('location', loc.location)
  vi.stubGlobal('window', loc.window)
  vi.stubGlobal('localStorage', storage)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// AC (data half): the published summary is a TOP-N list of name+score rows
// ---------------------------------------------------------------------------

describe('save() publishes a rows summary the board can read back', () => {
  it('round-trips every row as {name, score}, highest first', () => {
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(
      table(['JPX', 149830], ['AAA', 98000], ['CDE', 4200]),
    )

    expect(readTopScores('tempest')).toEqual<TopScoreRow[]>([
      { name: 'JPX', score: 149830 },
      { name: 'AAA', score: 98000 },
      { name: 'CDE', score: 4200 },
    ])
  })

  it('publishes the true top-N by score, not the table order — a scrambled table must not lie', () => {
    // Mirrors the existing "publishes the MAX, not the first row" guard: the board is
    // written sorted, but corrupt/unsorted data must still yield the real ranking.
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(
      table(['LOW', 100], ['TOP', 124500], ['MID', 3000]),
    )

    expect(readTopScores('tempest')).toEqual<TopScoreRow[]>([
      { name: 'TOP', score: 124500 },
      { name: 'MID', score: 3000 },
      { name: 'LOW', score: 100 },
    ])
  })

  it('re-sorts an out-of-order (hand-edited/hostile) cookie highest-first on READ', () => {
    // Our own writes are always sorted, but the cookie is UNTRUSTED — any subdomain can write it
    // and a player can hand-edit it. The read path must still honour the documented "highest
    // first" contract, or the board renders a lower score above a higher one and readTopScore
    // reports the wrong "top". Seed the cookie directly, out of order, and read it back.
    installBrowser(makeCookieJar({ [COOKIE]: 'LOW:100,TOP:99999,MID:5000' }), makeFakeStorage())

    expect(readTopScores('tempest')).toEqual<TopScoreRow[]>([
      { name: 'TOP', score: 99999 },
      { name: 'MID', score: 5000 },
      { name: 'LOW', score: 100 },
    ])
    expect(readTopScore('tempest'), 'row 0 is the true max, not the first listed').toBe(99999)
  })

  it('carries a NAME, not a bare number — this is the whole point of the widening', () => {
    // The regression this story removes: a summary that is still just digits cannot feed a
    // ladder. Assert the published value is NOT parseable as a plain integer.
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(table(['JPX', 149830]))

    const raw = jar.values()[COOKIE]
    expect(raw, 'the game published something').toBeDefined()
    expect(/^\d+$/.test(raw), `a rows summary must not be a bare number, got "${raw}"`).toBe(false)
    expect(raw).toContain('JPX')
  })

  it('caps the published summary at PUBLISHED_SUMMARY_DEPTH (the design shows a TOP FIVE)', () => {
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(
      table(
        ['R1', 100], ['R2', 200], ['R3', 300], ['R4', 400],
        ['R5', 500], ['R6', 600], ['R7', 700],
      ),
    )

    // Pin the constant AND the behaviour independently, so neither can go vacuous.
    expect(PUBLISHED_SUMMARY_DEPTH).toBe(5)
    const rows = readTopScores('tempest')
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r.score)).toEqual([700, 600, 500, 400, 300])
  })

  it('the tile still works: readTopScore returns the top row’s score', () => {
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(table(['JPX', 149830], ['AAA', 98000]))

    expect(readTopScore('tempest')).toBe(149830)
  })

  it('does not touch a sibling game’s summary', () => {
    const jar = makeCookieJar({ 'arcade-hi-star-wars': 'ZZZ:8000' })
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(table(['AAA', 9000]))

    expect(jar.values()['arcade-hi-star-wars']).toBe('ZZZ:8000')
  })

  it('leaves NO game-domain field in the summary — the ladder carries name+score only', () => {
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(table(['AAA', 9000]))

    // A row that leaked `level` would let the board accidentally depend on a game-private
    // field. The summary contract is exactly {name, score}.
    expect(Object.keys(readTopScores('tempest')[0]).sort()).toEqual(['name', 'score'])
  })
})

// ---------------------------------------------------------------------------
// AC-4 (data half): fail-soft — nothing readable degrades to [], never invented rows
// ---------------------------------------------------------------------------

describe('a summary that cannot be trusted reads as [] — never a fabricated ladder', () => {
  it('an empty board publishes nothing and reads back as []', () => {
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save([])

    expect(jar.values()[COOKIE], 'no zombie summary').toBeUndefined()
    expect(readTopScores('tempest')).toEqual([])
  })

  it('an absent summary reads as [] (a never-played game), not an invented row', () => {
    installBrowser(makeCookieJar(), makeFakeStorage())
    expect(readTopScores('tempest')).toEqual([])
  })

  it('a corrupt/garbage summary reads as [] — junk never becomes a confident row', () => {
    // The cookie is UNTRUSTED (any subdomain can write it, a player can edit it, ITP can
    // shred it). Garbage must degrade to the honest empty state, not a made-up ladder.
    for (const junk of ['', 'not-a-ladder', ':::', ',,,', 'AAA:', ':500', 'AAA:notanumber']) {
      installBrowser(makeCookieJar({ [COOKIE]: junk }), makeFakeStorage())
      expect(readTopScores('tempest'), `junk summary "${junk}"`).toEqual([])
      vi.unstubAllGlobals()
    }
  })

  it('drops poisoned rows at the publish boundary — no Infinity score, no non-string name', () => {
    // Runtime validation at the trust boundary (the same finite-score line isHighScoreRow
    // already holds). A `1e999` -> Infinity score or a numeric name must never reach the board.
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save([
      { name: 'AAA', score: 1e999, level: 1 }, // Infinity — must be dropped
      { name: 42 as unknown as string, score: 5000, level: 2 }, // non-string name — dropped
      { name: 'BBB', score: 4200, level: 3 }, // the only clean row
    ])

    const rows = readTopScores('tempest')
    expect(rows).toEqual<TopScoreRow[]>([{ name: 'BBB', score: 4200 }])
    for (const r of rows) {
      expect(Number.isFinite(r.score)).toBe(true)
      expect(typeof r.name).toBe('string')
    }
  })

  it('clears a zombie summary when the table is gone — the board must match the game', () => {
    // The table was evicted (quota / ITP / cleared storage) but the shared-domain cookie
    // survived. load() re-derives from an empty table => the summary must clear, or the
    // board advertises a ladder the game itself no longer has.
    const jar = makeCookieJar({ [COOKIE]: 'AAA:50000,BBB:9000' })
    installBrowser(jar, makeFakeStorage()) // table GONE

    expect(makeHighScoreStorage('tempest', guard).load()).toEqual([])
    expect(jar.values()[COOKIE], 'the zombie ladder is cleared').toBeUndefined()
    expect(readTopScores('tempest')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Security + size: names are untrusted; the ladder fits well under the cookie cap
// ---------------------------------------------------------------------------

describe('the summary is injection-safe and small', () => {
  it('a hostile name cannot inject a cookie attribute or corrupt the jar', () => {
    // `gameId` is already slug-guarded (isValidGameId); NAMES are the new untrusted input,
    // and they land in a cookie string where ; = , : are structural. A name carrying them
    // must not spawn a second cookie, forge an attribute, or survive into the ladder.
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(table(['X;Y=Z,Q:R', 9000]))

    // No injected cookie: only tempest's own summary exists.
    expect(Object.keys(jar.values())).toEqual([COOKIE])
    // The delimiters do not survive into the parsed name.
    const name = readTopScores('tempest')[0]?.name ?? ''
    expect(name).not.toMatch(/[;=,:]/)
    // The score is unharmed by the hostile name.
    expect(readTopScore('tempest')).toBe(9000)
  })

  it('strips control/newline characters from a name, not just the ; = , : delimiters', () => {
    // A newline or NUL in a name is unsafe cookie content and never a real arcade initial; it
    // must be stripped like the structural delimiters. Built with fromCharCode so no raw control
    // byte lives in this test's source.
    const hostile = 'A' + String.fromCharCode(10) + 'B' + String.fromCharCode(0) + 'C'
    installBrowser(makeCookieJar(), makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(table([hostile, 9000]))

    // The control chars are gone; the real letters survive; the score is unharmed.
    expect(readTopScores('tempest')[0]?.name).toBe('ABC')
    expect(readTopScore('tempest')).toBe(9000)
  })

  it('a clean 3-char name round-trips intact', () => {
    installBrowser(makeCookieJar(), makeFakeStorage())
    makeHighScoreStorage('tempest', guard).save(table(['JPX', 9000]))
    expect(readTopScores('tempest')[0]).toEqual({ name: 'JPX', score: 9000 })
  })

  it('five 3-char names + five scores stay far under the 4096 B cookie cap (< 200 B)', () => {
    // The story's own sizing claim: widening is safe because a full ladder is tiny.
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(
      table(
        ['ABC', 9999999], ['DEF', 8888888], ['GHI', 7777777],
        ['JKL', 6666666], ['MNO', 5555555],
      ),
    )

    const value = jar.values()[COOKIE]
    expect(value.length).toBeLessThan(200)
    expect(value.length).toBeLessThan(4096)
  })
})

// ---------------------------------------------------------------------------
// Migration: a LEGACY bare-number cookie must not blank the tile (protect lb2-3)
// ---------------------------------------------------------------------------

describe('legacy bare-number summaries (published before this story) degrade honestly', () => {
  it('readTopScore still reads a legacy number — the tile does not regress mid-rollout', () => {
    // Until each game is redeployed on the new shared version and reopened, its published
    // cookie is still the old `124500`. The tile (readTopScore) must keep working, or every
    // tile blanks the moment the lobby repins. lb2-3's refresh.test.ts publishes exactly
    // this shape, so this is also what keeps that suite green.
    installBrowser(makeCookieJar({ [COOKIE]: '124500' }), makeFakeStorage())
    expect(readTopScore('tempest')).toBe(124500)
  })

  it('readTopScores returns [] for a legacy number — the board shows NO SCORES until republish', () => {
    // A bare number carries no NAMES, so there is no honest ladder to show. Empty state,
    // never an invented initials row. The board heals on the game's next open.
    installBrowser(makeCookieJar({ [COOKIE]: '124500' }), makeFakeStorage())
    expect(readTopScores('tempest')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Fail-soft: no browser at all (node / SSR) never throws
// ---------------------------------------------------------------------------

describe('fail-soft with no browser', () => {
  it('readTopScores returns [] and save/load never throw when there is no DOM', () => {
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('localStorage', undefined)

    const hs = makeHighScoreStorage('tempest', guard)
    expect(() => hs.save(table(['AAA', 9000]))).not.toThrow()
    expect(() => hs.load()).not.toThrow()
    expect(readTopScores('tempest')).toEqual([])
  })
})
