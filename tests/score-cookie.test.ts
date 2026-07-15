// tests/score-cookie.test.ts
//
// lb2-2 / ADR-0004 — the COOKIE TRANSPORT: the only bridge across the origin split.
//
// Each game persists its table on its own origin (tempest.slabgorb.com); the lobby
// renders on another (arcade.slabgorb.com). localStorage is origin-scoped, so the
// lobby reads a store no game has ever written. ADR-0004's fix: on save/load a game
// publishes its TOP SCORE to a cookie scoped to the registrable domain, which every
// subdomain can read.
//
//   arcade-hi-<gameId>=<top score>   Domain=slabgorb.com  Path=/  SameSite=Lax
//                                    Max-Age=<=400d       [Secure when https]
//
// This file pins the transport itself. Two things it must get exactly right:
//
//   SCOPE   The cookie has to be set with `Domain=slabgorb.com` or a sibling subdomain
//           cannot read it — and a browser never hands attributes back through
//           `document.cookie`, so the ONLY way to verify scoping short of a real
//           browser is to assert what was SET. The jar records that (helpers/cookie-jar).
//
//   PARSING The cookie value is UNTRUSTED input: any of our own subdomains can write
//           it, the user can edit it, and ITP can shred it. JS number parsing is full
//           of traps that silently produce a confident wrong number —
//           `Number('') === 0`, `parseInt('9000abc') === 9000`, `Number('0x1F') === 31`,
//           `Number('1e999') === Infinity`. Every one of those must read as NO SCORE.
//           A tile showing a wrong number is worse than a tile showing nothing.
//
// House rule (ADR-0004 + the games' existing storage seam): every failure mode
// degrades to NO SCORE. Nothing here may throw, ever — a broken cookie must never
// take the page down.
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  makeCookieJar,
  makeHostileDocument,
  locationStub,
  PROD_TEMPEST,
  DEV_LOCALHOST,
  type CookieJar,
} from './helpers/cookie-jar'
import { cookieTopScoreTransport, readTopScore, type TopScoreRow } from '../src/highscore'

afterEach(() => {
  vi.unstubAllGlobals()
})

// lb2-8 widened the transport from a single number to the board's ladder: `publish` now
// takes name+score ROWS and `read` returns them. This suite predates that and cares about the
// cookie MECHANICS — cross-origin scope, injection-safety, clear, fail-soft — which are the
// same whether the value is one number or five rows. So each scalar publish is wrapped in a
// one-row ladder, and each number/null-facing read goes through `readTopScore` (row 0's score,
// with the legacy bare-number fallback), keeping every mechanics assertion below meaningful.
const ladder = (score: number): TopScoreRow[] => [{ name: 'AAA', score }]

/** Put a cookie jar and a page location on the global, as a browser would. */
function installBrowser(
  jar: CookieJar,
  where: { hostname: string; protocol: string } = PROD_TEMPEST,
): void {
  const loc = locationStub(where)
  vi.stubGlobal('document', jar.document)
  vi.stubGlobal('location', loc.location)
  vi.stubGlobal('window', loc.window)
}

/** The attribute half of a raw `document.cookie` assignment (everything after `name=value`). */
const attributesOf = (raw: string): string => raw.slice(raw.indexOf(';') + 1)

const hasDomain = (raw: string): boolean => /(?:^|;)\s*domain\s*=/i.test(raw)
const hasSecure = (raw: string): boolean => /(?:^|;)\s*secure\s*(?:;|$)/i.test(raw)
const attr = (raw: string, name: string): string | null => {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]*)`, 'i').exec(raw)
  return m ? m[1].trim() : null
}

const FOUR_HUNDRED_DAYS = 400 * 24 * 60 * 60

// ---------------------------------------------------------------------------
// The cookie shape ADR-0004 specifies — the part that makes it cross-origin
// ---------------------------------------------------------------------------

describe('publish — the cookie shape in PRODUCTION (six subdomains)', () => {
  it('writes `arcade-hi-<gameId>=<name:score,…>` so the lobby can find it by name', () => {
    const jar = makeCookieJar()
    installBrowser(jar, PROD_TEMPEST)

    cookieTopScoreTransport.publish('tempest', ladder(124500))

    expect(jar.values()['arcade-hi-tempest']).toBe('AAA:124500')
  })

  it('scopes the cookie to the REGISTRABLE DOMAIN — without this the fix does nothing', () => {
    // The entire ADR turns on this one attribute. A cookie set from
    // tempest.slabgorb.com WITHOUT `Domain` is host-only: arcade.slabgorb.com can
    // never read it, and the lobby keeps showing NO SCORE. This is the assertion
    // that would have caught the original bug.
    const jar = makeCookieJar()
    installBrowser(jar, PROD_TEMPEST)

    cookieTopScoreTransport.publish('tempest', ladder(9000))

    const [write] = jar.writes
    expect(write, 'publish must assign to document.cookie').toBeDefined()
    expect(attr(write.raw, 'domain')).toBe('slabgorb.com')
  })

  it('sets Path=/ and SameSite=Lax, and marks the cookie Secure over https', () => {
    const jar = makeCookieJar()
    installBrowser(jar, PROD_TEMPEST)

    cookieTopScoreTransport.publish('tempest', ladder(9000))

    const { raw } = jar.writes[0]
    expect(attr(raw, 'path')).toBe('/')
    expect(attr(raw, 'samesite')?.toLowerCase()).toBe('lax')
    expect(hasSecure(raw), `expected Secure over https, got: ${attributesOf(raw)}`).toBe(true)
  })

  it('persists with a positive Max-Age no greater than the 400-day browser cap', () => {
    const jar = makeCookieJar()
    installBrowser(jar, PROD_TEMPEST)

    cookieTopScoreTransport.publish('tempest', ladder(9000))

    const maxAge = Number(attr(jar.writes[0].raw, 'max-age'))
    expect(Number.isFinite(maxAge), 'a Max-Age must be set, or the cookie dies with the session')
      .toBe(true)
    expect(maxAge).toBeGreaterThan(0)
    expect(maxAge).toBeLessThanOrEqual(FOUR_HUNDRED_DAYS)
  })
})

describe('publish — the cookie shape in DEV (`just serve`, six localhost ports)', () => {
  it('omits Domain on localhost — a host-only cookie is already shared across ports', () => {
    // Cookies ignore the port, so on localhost a host-only cookie already spans all six
    // dev servers. Setting `Domain=localhost` is at best redundant and is rejected
    // outright by some browsers, which would break the dev cabinet. AC: the same
    // mechanism must work in dev AND prod.
    const jar = makeCookieJar()
    installBrowser(jar, DEV_LOCALHOST)

    cookieTopScoreTransport.publish('tempest', ladder(9000))

    const { raw } = jar.writes[0]
    expect(hasDomain(raw), `expected NO Domain on localhost, got: ${attributesOf(raw)}`).toBe(false)
  })

  it('does not mark the cookie Secure over plain http — a Secure cookie would be dropped', () => {
    const jar = makeCookieJar()
    installBrowser(jar, DEV_LOCALHOST)

    cookieTopScoreTransport.publish('tempest', ladder(9000))

    const { raw } = jar.writes[0]
    expect(hasSecure(raw), `expected no Secure over http, got: ${attributesOf(raw)}`).toBe(false)
  })

  it('still round-trips in dev — publish then read gives the score back', () => {
    const jar = makeCookieJar()
    installBrowser(jar, DEV_LOCALHOST)

    cookieTopScoreTransport.publish('tempest', ladder(9000))

    expect(readTopScore('tempest')).toBe(9000)
  })
})

// ---------------------------------------------------------------------------
// One cookie PER GAME — no game may clobber a sibling
// ---------------------------------------------------------------------------

describe('publish — one cookie per game', () => {
  it('leaves every sibling game’s cookie untouched (no read-modify-write clobber)', () => {
    // ADR-0004 chose one cookie per game precisely so that a game writing its own
    // score can never destroy another's. A single combined cookie would make this
    // a lost-update race between six independently-deployed apps.
    const jar = makeCookieJar({
      'arcade-hi-star-wars': '8000',
      'arcade-hi-asteroids': '4400',
    })
    installBrowser(jar, PROD_TEMPEST)

    cookieTopScoreTransport.publish('tempest', ladder(9000))

    expect(jar.values()).toEqual({
      'arcade-hi-star-wars': '8000',
      'arcade-hi-asteroids': '4400',
      'arcade-hi-tempest': 'AAA:9000',
    })
  })

  it('names only its own game in the cookie it writes', () => {
    const jar = makeCookieJar()
    installBrowser(jar, PROD_TEMPEST)

    cookieTopScoreTransport.publish('tempest', ladder(9000))

    expect(jar.writes).toHaveLength(1)
    expect(jar.writes[0].name).toBe('arcade-hi-tempest')
  })

  it('drops a row whose score is a non-score (0, negative, NaN, Infinity, fractional)', () => {
    const jar = makeCookieJar()
    installBrowser(jar, PROD_TEMPEST)

    for (const bogus of [0, -1, -9000, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      cookieTopScoreTransport.publish('tempest', ladder(bogus))
    }

    // An all-unpublishable ladder encodes to nothing and clears — a published `0` would
    // otherwise render as a real score of 0. No score is an honest NO SCORE.
    expect(jar.values()['arcade-hi-tempest']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// publish(gameId, []) — the transport can say "this game has NO score"
// ---------------------------------------------------------------------------
//
// A transport that can only ever WRITE rows cannot express absence, and absence then becomes
// silence — leaving a stale ladder behind that outlives the table it was derived from. An
// empty ladder is how the caller says "the board is empty"; it must CLEAR.
//
// (lb2-8 note: the old suite also drew a "bogus number is a caller error, decline it — do NOT
// clear" distinction. That lived at the number transport; the rows transport is fed only
// pre-filtered rows by the factory, so an all-unpublishable ladder is indistinguishable from an
// empty one and both clear. The dropped-row guarantee now lives at the factory boundary —
// highscore-summary.test.ts "drops poisoned rows".)

describe('publish([]) — clears the published summary', () => {
  it('removes an existing cookie', () => {
    const jar = makeCookieJar({ 'arcade-hi-tempest': '50000' })
    installBrowser(jar, PROD_TEMPEST)

    cookieTopScoreTransport.publish('tempest', [])

    expect(jar.values()['arcade-hi-tempest']).toBeUndefined()
    expect(readTopScore('tempest')).toBeNull()
  })

  it('expires the cookie on the SAME Domain and Path it was set with', () => {
    // A browser only deletes a cookie when the expiring write matches the original's Domain
    // and Path. A clear that omits Domain silently does nothing on a subdomain — it would
    // look like it worked and leave the stale score in place.
    const jar = makeCookieJar({ 'arcade-hi-tempest': '50000' })
    installBrowser(jar, PROD_TEMPEST)

    cookieTopScoreTransport.publish('tempest', [])

    const { raw } = jar.writes[0]
    expect(attr(raw, 'domain')).toBe('slabgorb.com')
    expect(attr(raw, 'path')).toBe('/')
    expect(Number(attr(raw, 'max-age'))).toBeLessThanOrEqual(0)
  })

  it('does not disturb a sibling game', () => {
    const jar = makeCookieJar({ 'arcade-hi-tempest': '50000', 'arcade-hi-star-wars': '8000' })
    installBrowser(jar, PROD_TEMPEST)

    cookieTopScoreTransport.publish('tempest', [])

    expect(jar.values()).toEqual({ 'arcade-hi-star-wars': '8000' })
  })

  it('is a harmless no-op when there was no cookie to begin with', () => {
    const jar = makeCookieJar()
    installBrowser(jar, PROD_TEMPEST)

    expect(() => cookieTopScoreTransport.publish('tempest', [])).not.toThrow()
    expect(readTopScore('tempest')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// gameId is interpolated into a cookie string — it must be a slug, not a payload
// ---------------------------------------------------------------------------

describe('a hostile gameId cannot inject cookie attributes', () => {
  it('refuses a gameId carrying a `;` (attribute injection)', () => {
    // `;` and `=` are the cookie string's delimiters. Interpolating them unchecked lets a
    // caller smuggle in attributes — e.g. a Domain of their choosing — and mangles the
    // cookie's name and value. Every real id is a plain slug.
    const jar = makeCookieJar()
    installBrowser(jar, PROD_TEMPEST)

    cookieTopScoreTransport.publish('x; Domain=evil.example', ladder(9000))

    expect(jar.writes, 'nothing may be written at all').toHaveLength(0)
    expect(jar.values()).toEqual({})
  })

  it('refuses ids with `=`, whitespace, or an empty string, and reads null for them', () => {
    const jar = makeCookieJar({ 'arcade-hi-tempest': '9000' })
    installBrowser(jar, PROD_TEMPEST)

    for (const hostile of ['a=b', 'has space', '', 'UPPER', 'semi;colon']) {
      cookieTopScoreTransport.publish(hostile, ladder(9000))
      expect(readTopScore(hostile), `read(${JSON.stringify(hostile)})`).toBeNull()
    }

    expect(jar.values(), 'the real cookie is untouched').toEqual({ 'arcade-hi-tempest': '9000' })
  })

  it('still accepts every real game id in the cabinet', () => {
    // The guard must not be so tight that it rejects the actual games.
    const jar = makeCookieJar()
    installBrowser(jar, PROD_TEMPEST)

    for (const id of ['tempest', 'star-wars', 'asteroids', 'battlezone', 'red-baron']) {
      cookieTopScoreTransport.publish(id, ladder(1234))
      expect(readTopScore(id), id).toBe(1234)
    }
  })
})

// ---------------------------------------------------------------------------
// read — finding OUR value in a jar we do not control
// ---------------------------------------------------------------------------

describe('read — picks the right cookie out of a shared jar', () => {
  it('reads a score another origin published (the cross-origin bridge working)', () => {
    // The jar is pre-seeded as if tempest.slabgorb.com had published on its own origin;
    // we now read from the lobby's. Nothing but the cookie crosses.
    const jar = makeCookieJar({ 'arcade-hi-tempest': '124500' })
    installBrowser(jar, { hostname: 'arcade.slabgorb.com', protocol: 'https:' })

    expect(readTopScore('tempest')).toBe(124500)
  })

  it('finds its cookie among unrelated cookies', () => {
    const jar = makeCookieJar({
      _ga: 'GA1.2.3',
      'arcade-hi-tempest': '9000',
      theme: 'dark',
    })
    installBrowser(jar)

    expect(readTopScore('tempest')).toBe(9000)
  })

  it('keeps each game separate', () => {
    const jar = makeCookieJar({
      'arcade-hi-tempest': '5000',
      'arcade-hi-star-wars': '8000',
    })
    installBrowser(jar)

    expect(readTopScore('tempest')).toBe(5000)
    expect(readTopScore('star-wars')).toBe(8000)
  })

  it('does not match a cookie whose name merely CONTAINS the game id', () => {
    // `arcade-hi-star` must not be satisfied by `arcade-hi-star-wars`, and a
    // lookalike name must not be mistaken for ours. A naive `cookie.includes(name)`
    // or an unanchored regex passes the happy-path tests above and fails here.
    const jar = makeCookieJar({
      'arcade-hi-star-wars': '8000',
      'xarcade-hi-tempest': '111',
      'arcade-hi-tempest-legacy': '222',
    })
    installBrowser(jar)

    expect(readTopScore('star')).toBeNull()
    expect(readTopScore('tempest')).toBeNull()
  })

  it('returns null when the game has never published', () => {
    installBrowser(makeCookieJar({ 'arcade-hi-tempest': '9000' }))

    expect(readTopScore('red-baron')).toBeNull()
  })

  it('returns null for an empty jar', () => {
    installBrowser(makeCookieJar())

    expect(readTopScore('tempest')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// read — the cookie value is untrusted; every trap degrades to NO SCORE
// ---------------------------------------------------------------------------

describe('read — hostile values degrade to NO SCORE and never throw', () => {
  // Each of these is a specific way a naive parse produces a CONFIDENT WRONG NUMBER
  // instead of an honest null. The label names the trap.
  const traps: ReadonlyArray<readonly [label: string, value: string]> = [
    ['empty value — `Number("")` is 0, not NaN', ''],
    ['whitespace only — `Number(" ")` is also 0', '   '],
    ['trailing garbage — `parseInt("9000abc")` is 9000', '9000abc'],
    ['leading garbage', 'abc9000'],
    ['not a number at all', 'high-score'],
    ['hex — `Number("0x1F")` is 31', '0x1F'],
    ['exponent overflow — `Number("1e999")` is Infinity', '1e999'],
    ['literal NaN', 'NaN'],
    ['literal Infinity', 'Infinity'],
    ['negative score', '-500'],
    ['zero is not a score — the board never records one', '0'],
    ['fractional score', '1234.5'],
    ['a whole JSON table, as if someone pasted the localStorage value in', '[{"score":9000}]'],
    ['thousands separators', '124,500'],
  ]

  for (const [label, value] of traps) {
    it(`returns null for ${label}`, () => {
      installBrowser(makeCookieJar({ 'arcade-hi-tempest': value }))

      expect(() => readTopScore('tempest')).not.toThrow()
      expect(readTopScore('tempest')).toBeNull()
    })
  }

  it('accepts a legitimate large score', () => {
    // The guard must reject junk without also rejecting a real arcade score.
    installBrowser(makeCookieJar({ 'arcade-hi-tempest': '9999990' }))

    expect(readTopScore('tempest')).toBe(9999990)
  })
})

// ---------------------------------------------------------------------------
// Fail-soft: a hostile or absent document must never take the page down
// ---------------------------------------------------------------------------

describe('fail-soft — no document, no cookie access, no crash', () => {
  it('reads null when there is no document at all (node / SSR)', () => {
    vi.stubGlobal('document', undefined)

    expect(() => readTopScore('tempest')).not.toThrow()
    expect(readTopScore('tempest')).toBeNull()
  })

  it('publishes as a silent no-op when there is no document', () => {
    vi.stubGlobal('document', undefined)

    expect(() => cookieTopScoreTransport.publish('tempest', ladder(9000))).not.toThrow()
  })

  it('reads null when `document.cookie` itself throws (sandboxed / private mode)', () => {
    vi.stubGlobal('document', makeHostileDocument())
    vi.stubGlobal('location', PROD_TEMPEST)

    expect(() => readTopScore('tempest')).not.toThrow()
    expect(readTopScore('tempest')).toBeNull()
  })

  it('swallows a throwing cookie SETTER — a game must never crash on a failed publish', () => {
    vi.stubGlobal('document', makeHostileDocument())
    vi.stubGlobal('location', PROD_TEMPEST)

    expect(() => cookieTopScoreTransport.publish('tempest', ladder(9000))).not.toThrow()
  })

  it('survives an evicted cookie — ITP purges it and the tile honestly says NO SCORE', () => {
    // Safari's ITP deletes script-writable storage after 7 days without interaction.
    // The contract is that this degrades to NO SCORE, never to a wrong number.
    const jar = makeCookieJar({ 'arcade-hi-tempest': '9000' })
    installBrowser(jar)
    expect(readTopScore('tempest')).toBe(9000)

    jar.document.cookie = 'arcade-hi-tempest=; Max-Age=0'

    expect(readTopScore('tempest')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// readTopScore — the one function the lobby imports (AC-3: one adapter to swap)
// ---------------------------------------------------------------------------

describe('readTopScore — the lobby-facing read', () => {
  it('returns the published score for a game', () => {
    installBrowser(makeCookieJar({ 'arcade-hi-tempest': '124500' }))

    expect(readTopScore('tempest')).toBe(124500)
  })

  it('returns null when nothing is published — the tile shows NO SCORE', () => {
    installBrowser(makeCookieJar())

    expect(readTopScore('tempest')).toBeNull()
  })

  it('degrades to null rather than throwing when there is no document', () => {
    vi.stubGlobal('document', undefined)

    expect(() => readTopScore('tempest')).not.toThrow()
    expect(readTopScore('tempest')).toBeNull()
  })
})
