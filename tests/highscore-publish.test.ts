// tests/highscore-publish.test.ts
//
// lb2-2 / ADR-0004 — the CHOKE POINT.
//
// Every game calls `makeHighScoreStorage(gameId, guard)` exactly once in its main.ts,
// and that factory owns the only `save()` in the cabinet. Install the publish there
// and tempest / star-wars / asteroids / battlezone are fixed by a VERSION BUMP with
// ZERO game-side code. That claim is an acceptance criterion, so it is tested here
// literally: the factory is called with the same TWO arguments the games pass today.
//
// The load-bearing invariants:
//
//   AUTHORITY   localStorage stays the source of truth. The cookie is a DERIVED cache —
//               republished on every load — so it heals itself and can NEVER lose a
//               player's scores. Delete the cookie and one game load brings it back;
//               delete the table and the scores are genuinely gone. Only one of those
//               two is allowed to be true.
//
//   SELF-HEAL   `load()` republishes. That is what reaches the four already-shipped
//               games with no code change, and what repairs a stale or ITP-purged
//               cookie on the player's next visit.
//
//   FAIL-SOFT   A cookie failure must never cost a score. If publishing throws, the
//               table is still written to localStorage and nothing propagates.
//
//   SWAPPABLE   ADR-0004 rejected the single-origin collapse on COST, not merit, and
//               requires it to stay one adapter swap away. The transport is therefore
//               injectable, and a test proves an injected one is actually used.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { makeCookieJar, locationStub, PROD_TEMPEST, type CookieJar } from './helpers/cookie-jar'
import { makeFakeStorage, makeQuotaStorage } from './helpers/storage-stub'
import { makeHighScoreStorage, makeHighScoreRowGuard, highScoreKey } from '../src/highscore'

const guard = makeHighScoreRowGuard('level')
const KEY = highScoreKey('tempest')
const COOKIE = 'arcade-hi-tempest'

/** A tempest-shaped table. Rows carry the game's own `level` domain field. */
const table = (...scores: number[]) => scores.map((score, i) => ({ name: 'AAA', score, level: i + 1 }))

/** Install a browser (cookie jar + location) and a per-origin localStorage. */
function installBrowser(jar: CookieJar, storage: Storage): void {
  const loc = locationStub(PROD_TEMPEST)
  vi.stubGlobal('document', jar.document)
  vi.stubGlobal('location', loc.location)
  vi.stubGlobal('window', loc.window)
  vi.stubGlobal('localStorage', storage)
}

/** A transport that records what it was asked to publish, and can be told to fail. */
function spyTransport(opts: { throws?: boolean } = {}) {
  const published: Array<{ gameId: string; score: number }> = []
  return {
    published,
    publish(gameId: string, score: number): void {
      published.push({ gameId, score })
      if (opts.throws) throw new Error('cookie jar is on fire')
    },
    read(): number | null {
      return null
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// The zero-game-code claim (AC): the games' existing call site is untouched
// ---------------------------------------------------------------------------

describe('the four shipped games are fixed by a version bump alone', () => {
  it('publishes from the SAME two-argument call the games already make', () => {
    // tempest/src/main.ts:18 — `makeHighScoreStorage('tempest', makeHighScoreRowGuard('level'))`.
    // If this needs a third argument at the call site, the publish was NOT installed at
    // the choke point and every game would need a code change. That is the AC.
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    const storage = makeHighScoreStorage('tempest', guard)
    storage.save(table(9000, 3000))

    expect(jar.values()[COOKIE]).toBe('9000')
  })
})

// ---------------------------------------------------------------------------
// save() publishes the TOP score
// ---------------------------------------------------------------------------

describe('save() — publishes the top score', () => {
  it('publishes the highest score on the board', () => {
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(table(124500, 90000, 100))

    expect(jar.values()[COOKIE]).toBe('124500')
  })

  it('publishes the MAX, not the first row — corrupt or unsorted data must not lie', () => {
    // The board is written sorted descending, but we do not trust that: the lobby's
    // existing read already takes Math.max rather than table[0], and the publish must
    // hold the same line or a scrambled table publishes a wrong, lower score.
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(table(100, 124500, 3000))

    expect(jar.values()[COOKIE]).toBe('124500')
  })

  it('publishes nothing for an empty board — NO SCORE, not a score of 0', () => {
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save([])

    expect(jar.values()[COOKIE]).toBeUndefined()
  })

  it('does not touch a sibling game’s cookie', () => {
    const jar = makeCookieJar({ 'arcade-hi-star-wars': '8000' })
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard).save(table(9000))

    expect(jar.values()['arcade-hi-star-wars']).toBe('8000')
  })
})

// ---------------------------------------------------------------------------
// localStorage stays authoritative — the cookie is derived, never a source of truth
// ---------------------------------------------------------------------------

describe('the table remains the source of truth', () => {
  it('still writes the FULL table to localStorage, byte-for-byte unmigrated', () => {
    // No migration is performed and none is needed. The stored JSON must remain
    // exactly what the games have always written — same key, same shape, same rows.
    const jar = makeCookieJar()
    const storage = makeFakeStorage()
    installBrowser(jar, storage)

    const rows = table(9000, 3000)
    makeHighScoreStorage('tempest', guard).save(rows)

    expect(JSON.parse(storage.getItem(KEY) as string)).toEqual(rows)
  })

  it('the cookie is a CACHE: losing it loses nothing, because load() rebuilds it', () => {
    // ITP purged the cookie, or the user cleared cookies but not site data. The table
    // is untouched, so the next game load must republish the real score from it.
    const jar = makeCookieJar()
    const storage = makeFakeStorage({ [KEY]: JSON.stringify(table(124500, 900)) })
    installBrowser(jar, storage)

    expect(jar.values()[COOKIE], 'precondition: the cookie is gone').toBeUndefined()

    const loaded = makeHighScoreStorage('tempest', guard).load()

    expect(loaded).toEqual(table(124500, 900))
    expect(jar.values()[COOKIE], 'load() must republish from the table').toBe('124500')
  })
})

// ---------------------------------------------------------------------------
// load() republishes — the self-heal that needs no game-side code
// ---------------------------------------------------------------------------

describe('load() — republishes on every game load (self-heal)', () => {
  it('heals a STALE cookie holding a wrong number', () => {
    // The "frozen wrong number" the lobby shows today. A cookie left over from an old
    // build, or forged by hand, must be corrected by the authoritative table on the
    // very next load — not trusted.
    const jar = makeCookieJar({ [COOKIE]: '17' })
    installBrowser(jar, makeFakeStorage({ [KEY]: JSON.stringify(table(124500)) }))

    makeHighScoreStorage('tempest', guard).load()

    expect(jar.values()[COOKIE]).toBe('124500')
  })

  it('publishes nothing when the game has no stored table yet (a fresh player)', () => {
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    expect(makeHighScoreStorage('tempest', guard).load()).toEqual([])
    expect(jar.values()[COOKIE]).toBeUndefined()
  })

  it('publishes only the valid rows’ maximum when the table is partly corrupt', () => {
    // load() already drops rows that fail the guard; the published score must come from
    // the survivors, never from a poisoned row (a `1e999` -> Infinity score would
    // otherwise be published as the top score).
    const poisoned = JSON.stringify([
      { name: 'AAA', score: 1e999, level: 1 },
      { name: 'BBB', score: 4200, level: 2 },
      { name: 'CCC' },
    ])
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage({ [KEY]: poisoned }))

    makeHighScoreStorage('tempest', guard).load()

    expect(jar.values()[COOKIE]).toBe('4200')
  })
})

// ---------------------------------------------------------------------------
// Fail-soft — a cookie failure must never cost a score or crash a game
// ---------------------------------------------------------------------------

describe('fail-soft — publishing never breaks persistence', () => {
  it('still writes the table to localStorage when publishing throws', () => {
    // The cookie is a nice-to-have; the player's scores are not. If the publish blows
    // up, the save must still land.
    const transport = spyTransport({ throws: true })
    const storage = makeFakeStorage()
    installBrowser(makeCookieJar(), storage)

    const rows = table(9000)
    const hs = makeHighScoreStorage('tempest', guard, transport)

    expect(() => hs.save(rows)).not.toThrow()
    expect(JSON.parse(storage.getItem(KEY) as string)).toEqual(rows)
  })

  it('still returns the loaded table when republishing throws', () => {
    const transport = spyTransport({ throws: true })
    installBrowser(makeCookieJar(), makeFakeStorage({ [KEY]: JSON.stringify(table(9000)) }))

    const hs = makeHighScoreStorage('tempest', guard, transport)

    expect(() => hs.load()).not.toThrow()
    expect(hs.load()).toEqual(table(9000))
  })

  it('does not throw when localStorage itself is full (the pre-existing quota path)', () => {
    installBrowser(makeCookieJar(), makeQuotaStorage())

    const hs = makeHighScoreStorage('tempest', guard)

    expect(() => hs.save(table(9000))).not.toThrow()
  })

  it('does not throw when there is no browser at all (node)', () => {
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('localStorage', undefined)

    const hs = makeHighScoreStorage('tempest', guard)

    expect(() => hs.save(table(9000))).not.toThrow()
    expect(() => hs.load()).not.toThrow()
    expect(hs.load()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The transport is a narrow, swappable seam (AC-3)
// ---------------------------------------------------------------------------

describe('the transport is injectable — single-origin stays one adapter swap away', () => {
  it('uses an injected transport instead of the cookie', () => {
    // ADR-0004 rejected collapsing the cabinet onto one origin on COST, not merit, and
    // requires that swapping the cookie for same-origin localStorage (or a fetch) touch
    // ONE adapter and nothing else. If this test cannot redirect the publish, the
    // transport is welded in and that promise is not real.
    const transport = spyTransport()
    const jar = makeCookieJar()
    installBrowser(jar, makeFakeStorage())

    makeHighScoreStorage('tempest', guard, transport).save(table(9000, 100))

    expect(transport.published).toEqual([{ gameId: 'tempest', score: 9000 }])
    expect(jar.values()[COOKIE], 'the cookie transport must NOT also have run').toBeUndefined()
  })

  it('routes the load()-time republish through the injected transport too', () => {
    const transport = spyTransport()
    installBrowser(makeCookieJar(), makeFakeStorage({ [KEY]: JSON.stringify(table(4200)) }))

    makeHighScoreStorage('tempest', guard, transport).load()

    expect(transport.published).toEqual([{ gameId: 'tempest', score: 4200 }])
  })
})
