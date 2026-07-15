// @arcade/shared/highscore — the high-score TABLE logic + its TWO persistence seams:
// the localStorage table (authoritative) and the cross-origin score cookie (derived).
//
// NOTE: this is a BROWSER subpath, not a pure one (ADR-0003's fence, tests/purity.test.ts).
// It was pure until lb2-2: `save()`/`load()` now write `document.cookie`, so the subpath
// touches the DOM and is classified by its dirtiest export. The table logic below
// (qualifiesForHighScore / insertHighScore / highScoreKey / isHighScoreRow) is still pure
// and side-effect-free — but the module as a whole is not, and saying otherwise would make
// the purity fence a lie.
//
// SH-4 (ADR-0001) extraction. tempest, star-wars, and asteroids each shipped a
// logic-identical high-score table (src/core/highscore.ts) + persistence seam
// (src/shell/storage.ts), and the lobby reads their `{gameId}-high-scores`
// entries by convention only. This module lifts all of it into one place and
// turns that convention into a compile-time contract:
//
//   - The entry type is GENERIC over the domain field: tempest records `level`;
//     star-wars and asteroids record `wave`, so HighScoreEntry<'level'> and
//     HighScoreEntry<'wave'> share every other field. The stored JSON keeps each
//     game's real field name — no localStorage migration.
//   - The row guard requires a FINITE score (and finite domain field). The three
//     games split on this: tempest/star-wars used loose `typeof === 'number'`
//     (which admits a poisoned `1e999` -> Infinity); asteroids hardened to
//     `Number.isFinite`, and the lobby's tile read demands a finite score. One
//     shared guard can hold only one standard, so it holds the finite one.
//   - `highScoreKey` + `isHighScoreRow` are what the LOBBY imports — the same key
//     and shape the games write — so the tile no longer re-derives them by hand.
//
// No rendering, no game state. There are TWO IO surfaces:
//
//   localStorage  the game's own high-score TABLE. Origin-scoped, authoritative, and
//                 never migrated. This is the source of truth.
//   document.cookie  the top score alone, published to the shared parent domain so the
//                 lobby — which lives on a DIFFERENT ORIGIN and therefore cannot read the
//                 table — can show it on a tile (lb2-2 / ADR-0004, below).
//
// The cookie is DERIVED from the table and mirrors it in both directions, so it is always
// disposable: losing it costs nothing (the next load republishes it) and it can never
// outlive the board it came from (an empty table clears it).
//
// Both seams degrade gracefully on every failure mode (missing / corrupt / unavailable /
// quota-exceeded / no DOM / a hostile document) — a game keeps playing, scores just don't
// persist, and a tile that cannot be trusted reads NO SCORE rather than a wrong number.

/** Board depth — the classic 10-deep arcade ladder. The single source of truth
 *  (AC-4): no game redeclares it. */
export const MAX_HIGH_SCORES = 10

/** Fields every high-score entry carries, regardless of game. `date` is an
 *  optional ISO-8601 timestamp. */
export interface HighScoreEntryBase {
  name: string // player initials (3 chars, arcade convention)
  score: number // points
  date?: string // optional ISO-8601 timestamp of the entry
}

/** A high-score entry with its game's numeric domain field mixed in by name:
 *  HighScoreEntry<'level'> for tempest, HighScoreEntry<'wave'> for star-wars and
 *  asteroids. */
export type HighScoreEntry<DomainKey extends string> = HighScoreEntryBase & {
  [K in DomainKey]: number
}

/** A table is a list of entries, ordered descending by score (lowest last). */
export type HighScoreTable<DomainKey extends string> = HighScoreEntry<DomainKey>[]

// --- pure table logic --------------------------------------------------------

// Precondition: `table` is assumed sorted DESCENDING by score (lowest entry
// last) — the order insertHighScore maintains. True when `score` is worth
// recording: a non-positive score never qualifies; while the board has open
// slots any positive score makes it; once full the score must STRICTLY beat the
// lowest entry to displace it (a tie does not). Reads only `.score`, so it is
// domain-agnostic.
export function qualifiesForHighScore(table: readonly HighScoreEntryBase[], score: number): boolean {
  if (score <= 0) return false
  if (table.length < MAX_HIGH_SCORES) return true
  const lowest = table[table.length - 1].score
  return score > lowest
}

// Returns a NEW table with `entry` inserted in descending-score order, truncated
// to MAX_HIGH_SCORES. Ties place the new entry AFTER existing equal-score entries
// (existing holders keep the higher rank). The input table is not mutated.
// Generic over the entry type, so the domain field rides through the sort.
export function insertHighScore<E extends HighScoreEntryBase>(
  table: readonly E[],
  entry: E,
): E[] {
  const out = table.slice()
  let i = out.length
  for (let k = 0; k < out.length; k++) {
    if (out[k].score < entry.score) {
      i = k
      break
    }
  }
  out.splice(i, 0, entry)
  return out.slice(0, MAX_HIGH_SCORES)
}

// --- the key + row guards (the lobby contract) -------------------------------

/** The per-game localStorage key, e.g. `tempest-high-scores`. Every game writes
 *  its table under this key and the lobby reads it — the one shared literal. */
export function highScoreKey(gameId: string): string {
  return `${gameId}-high-scores`
}

// The domain-AGNOSTIC base guard: a row is usable only if it carries a string
// `name` and a FINITE numeric `score`. This is what the lobby imports — it reads
// only `.score`, so it validates that and tolerates any extra/missing fields.
// `Number.isFinite` (false for non-numbers AND ±Infinity/NaN) is the line the
// lobby already held; a poisoned `1e999` -> Infinity row does not pass.
export function isHighScoreRow(value: unknown): value is HighScoreEntryBase {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.name === 'string' && Number.isFinite(row.score)
}

// Builds the domain-AWARE guard a game uses: the base contract PLUS a finite
// numeric value under the game's own domain field (`level` | `wave`). Generic
// over the field name, so this one factory replaces the per-game
// `Number.isFinite(row[field])` line that used to be copied into each storage.ts.
export function makeHighScoreRowGuard<DomainKey extends string>(
  domainKey: DomainKey,
): (value: unknown) => value is HighScoreEntry<DomainKey> {
  return (value: unknown): value is HighScoreEntry<DomainKey> => {
    // Capture the raw record view while `value` is still `unknown` — the base
    // guard below narrows it to a type without an index signature, so we read
    // the game's own domain field (`level` | `wave`) from this view by name.
    const row = value as Record<string, unknown>
    return isHighScoreRow(value) && Number.isFinite(row[domainKey])
  }
}

// --- the cross-origin transport (ADR-0004) -----------------------------------
//
// lb2-2. The games and the lobby are DIFFERENT ORIGINS in production
// (tempest.slabgorb.com vs arcade.slabgorb.com — six R2 buckets, six domains), and
// localStorage is partitioned by origin. So the lobby was reading a store no game had
// ever written, and every tile showed NO SCORE or a frozen stale number.
//
// The fix: a game publishes its TOP SCORE to a cookie scoped to the registrable domain
// (`Domain=slabgorb.com`), which every subdomain can read. Cookie scoping is
// host-suffix-based, so it walks straight through the storage partitioning that kills
// every other same-browser option (notably Safari, which partitions localStorage
// per-ORIGIN in defiance of its own published spec).
//
// The cookie is a DERIVED CACHE, never a source of truth: the localStorage table below
// stays authoritative and unmigrated, and the cookie is republished on every load, so it
// heals itself and cannot lose a player's scores. Losing the cookie costs nothing;
// losing the table would cost everything, and nothing here can do that.
//
// The transport sits behind a narrow interface because ADR-0004 rejected collapsing the
// cabinet onto one origin on COST, not merit: swapping the cookie for same-origin
// localStorage (or a fetch) must remain a one-adapter change.

/** One published high-score row: the arcade initials and the score, and nothing else. The
 *  game's own domain field (`level` | `wave`) is deliberately NOT carried across — the board
 *  draws a name and a number, and a summary that leaked a game-private field would let the
 *  lobby accidentally depend on it. */
export interface TopScoreRow {
  name: string
  score: number
}

/** How many rows the published summary carries — the design's TOP FIVE ladder. The single
 *  source of truth for the cap; the factory derives at most this many, highest first, and the
 *  read caps at it too so a bloated hostile cookie cannot grow the board's ladder. */
export const PUBLISHED_SUMMARY_DEPTH = 5

/**
 * How a game's published high-score SUMMARY gets across the origin boundary to the lobby.
 *
 * lb2-8 widened this from a single number to the board's ladder: `publish` carries the top-N
 * name+score ROWS (already derived, sorted highest-first and capped at PUBLISHED_SUMMARY_DEPTH),
 * and `read` hands them back. The tile's single top score is still available — it is row 0's
 * score (see `readTopScore`), which also still parses a legacy bare-number cookie.
 *
 * `publish(gameId, [])` means "this game has NO score" and must CLEAR the published value — it
 * is not the same as declining to publish. That distinction is load-bearing: the summary is
 * derived from the table, and derivation is a total function. If the table is empty, the derived
 * summary is *no rows*, and a transport with no way to say so leaves a stale ladder behind that
 * outlives the board it came from.
 */
export interface TopScoreTransport {
  publish(gameId: string, rows: readonly TopScoreRow[]): void
  read(gameId: string): TopScoreRow[]
}

/** The published cookie: `arcade-hi-tempest=JPX:149830,AAA:98000`. One per game, so no game
 *  can clobber a sibling's ladder via a read-modify-write on a shared cookie. */
function topScoreCookieName(gameId: string): string {
  return `arcade-hi-${gameId}`
}

// `gameId` is interpolated straight into a cookie string, where `;` and `=` are the
// delimiters — so an id carrying either would inject cookie ATTRIBUTES rather than name a
// cookie. Every real id is a plain slug ('tempest', 'star-wars'), and today they are all
// hardcoded constants; but this is a shared library's public API and nothing in the
// signature stops a caller passing something dynamic. Reject anything that is not a slug
// instead of trusting the caller.
function isValidGameId(gameId: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(gameId)
}

// Browsers cap cookie persistence at 400 days and silently clamp anything longer.
const TOP_SCORE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

// A score worth publishing: a whole, positive, finite number of points. The board never
// records anything else (`qualifiesForHighScore` rejects <= 0), so publishing a 0 would
// render a real-looking score of zero on a tile that should honestly read NO SCORE.
function isPublishableScore(score: number): boolean {
  return Number.isInteger(score) && score > 0
}

// The cookie value is UNTRUSTED: any of our own subdomains can write it, the player can
// edit it by hand, and ITP can shred it. JS number parsing is a minefield of ways to turn
// junk into a CONFIDENT WRONG NUMBER — `Number('')` is 0, `parseInt('9000abc')` is 9000,
// `Number('0x1F')` is 31, `Number('1e999')` is Infinity. Demanding plain digits up front
// closes all of them at once; a wrong score on a tile is worse than no score at all.
function parseTopScore(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const score = Number(value)
  return isPublishableScore(score) ? score : null
}

// --- rows summary encoding (lb2-8) -------------------------------------------
//
// The widened summary is a list of `name:score` pairs joined by commas:
// `JPX:149830,AAA:98000`. NAMES are the new untrusted input the widening introduces
// (gameId is already slug-guarded); a name lands in the cookie value where ; = , : are
// structural, so it is sanitized on the way in and re-validated on the way back.

// Strip the cookie/encoding delimiters from a name so a hostile `X;Y=Z,Q:R` cannot forge a
// cookie attribute, a second cookie, or an extra ladder row. Arcade initials never contain
// these, so a real name is untouched.
function sanitizeName(name: string): string {
  return name.replace(/[;=,:]/g, '')
}

// Encode rows as `name:score,name:score`, sanitizing each name and dropping any row that
// cannot be safely represented (a non-string name, a non-publishable score, or a name that is
// nothing but delimiters and sanitizes to empty). Returns null when nothing publishable
// remains — which builds the CLEAR form of the cookie, so an empty ladder never leaves a
// zombie behind.
function encodeRows(rows: readonly TopScoreRow[]): string | null {
  const parts: string[] = []
  for (const row of rows) {
    if (typeof row.name !== 'string' || !isPublishableScore(row.score)) continue
    const name = sanitizeName(row.name)
    if (name === '') continue
    parts.push(`${name}:${row.score}`)
  }
  return parts.length > 0 ? parts.join(',') : null
}

// Decode the cookie value back into rows, dropping anything that is not a clean `name:score`
// pair. The value is UNTRUSTED (any subdomain can write it, a player can edit it, ITP can
// shred it), so a junk pair becomes NO row, never a confident wrong one — and a LEGACY
// bare-number value (`124500`, published before this story) carries no `:`, so it yields no
// rows and the board shows its empty state until the game republishes. Capped at
// PUBLISHED_SUMMARY_DEPTH so a bloated hostile cookie cannot grow the ladder.
function decodeRows(value: string): TopScoreRow[] {
  const rows: TopScoreRow[] = []
  for (const pair of value.split(',')) {
    const colon = pair.indexOf(':')
    if (colon === -1) continue
    const name = pair.slice(0, colon)
    if (name === '') continue
    const score = parseTopScore(pair.slice(colon + 1))
    if (score === null) continue
    rows.push({ name, score })
    if (rows.length === PUBLISHED_SUMMARY_DEPTH) break
  }
  return rows
}

// The DOM may be absent (node, SSR) or hostile (sandboxed iframes and private mode can
// throw on the mere act of touching document.cookie). Every path degrades to NO SCORE.
function getDocument(): Document | null {
  try {
    return typeof document === 'undefined' ? null : document
  } catch {
    return null
  }
}

function getLocation(): Location | null {
  try {
    return typeof location === 'undefined' ? null : location
  } catch {
    return null
  }
}

// The cookie must be scoped to the REGISTRABLE DOMAIN or a sibling subdomain cannot read
// it and the whole fix is inert. `tempest.slabgorb.com` -> `slabgorb.com`.
//
// ASSUMPTION: the cabinet lives on a single-label public suffix (`slabgorb.com`), so the
// registrable domain is the last two labels. This is deliberately NOT a public-suffix-list
// implementation — on a multi-part suffix (`arcade.example.co.uk`) it would yield `co.uk`,
// which every browser rejects, and the cookie simply would not be set. That fails SAFE (no
// cookie -> NO SCORE, never a wrong number), so the assumption costs a feature, not
// correctness. Revisit only if the arcade ever moves to such a domain.
//
// Returns null when the Domain attribute must be OMITTED:
//   - localhost (`just serve`, six ports): cookies ignore the port, so a host-only cookie
//     is ALREADY shared across all six dev servers. `Domain=localhost` is redundant at
//     best and rejected outright by some browsers, which would break the dev cabinet.
//   - a bare hostname or a raw IP: there is no parent domain to scope to.
function registrableDomain(hostname: string): string | null {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return null
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) return null // IPv4 / IPv6

  const labels = hostname.split('.')
  if (labels.length < 2) return null
  return labels.slice(-2).join('.')
}

// `value: null` builds the DELETION form of the same cookie. A browser only removes a
// cookie when the expiring write carries the SAME Domain and Path as the original, so the
// two forms must be built from one place — a clear that quietly misses on Domain would
// leave the stale ladder sitting there while appearing to work.
function buildTopScoreCookie(name: string, value: string | null, page: Location | null): string {
  const parts =
    value === null
      ? [`${name}=`, 'Path=/', 'SameSite=Lax', 'Max-Age=0']
      : [`${name}=${value}`, 'Path=/', 'SameSite=Lax', `Max-Age=${TOP_SCORE_MAX_AGE_SECONDS}`]

  const domain = page ? registrableDomain(page.hostname) : null
  if (domain) parts.push(`Domain=${domain}`)

  // Secure only over https — a Secure cookie is dropped on the plain-http dev cabinet.
  if (page?.protocol === 'https:') parts.push('Secure')

  return parts.join('; ')
}

// Read the raw summary cookie VALUE for a game, or null (no cookie / no DOM / hostile doc).
// Both `readTopScores` (rows) and `readTopScore` (the top number, incl. the legacy fallback)
// go through here, so the jar parsing and exact-name matching live in exactly one place.
function readSummaryCookie(gameId: string): string | null {
  if (!isValidGameId(gameId)) return null

  const doc = getDocument()
  if (!doc) return null

  let jar: string
  try {
    jar = doc.cookie
  } catch {
    return null
  }
  if (typeof jar !== 'string' || jar === '') return null

  // Match the cookie NAME exactly. A substring test would let `arcade-hi-star-wars`
  // answer a lookup for `star`, and a lookalike cookie impersonate a real one.
  const wanted = topScoreCookieName(gameId)
  for (const pair of jar.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    if (pair.slice(0, eq).trim() !== wanted) continue
    return pair.slice(eq + 1).trim()
  }
  return null
}

/** The default transport: one cookie per game on the shared parent domain, carrying the
 *  top-N ladder as `name:score` pairs. */
export const cookieTopScoreTransport: TopScoreTransport = {
  publish(gameId: string, rows: readonly TopScoreRow[]): void {
    if (!isValidGameId(gameId)) return

    const doc = getDocument()
    if (!doc) return

    try {
      // `encodeRows` returns null for an empty/all-unpublishable ladder, which builds the
      // CLEAR form — so an empty board can never leave a stale ladder behind.
      doc.cookie = buildTopScoreCookie(topScoreCookieName(gameId), encodeRows(rows), getLocation())
    } catch {
      // A failed publish costs a cached ladder, not a score. Never take the page down.
    }
  },

  read(gameId: string): TopScoreRow[] {
    const raw = readSummaryCookie(gameId)
    return raw === null ? [] : decodeRows(raw)
  },
}

/** The board's published ladder for a game — up to PUBLISHED_SUMMARY_DEPTH name+score rows,
 *  highest first, or [] when there is nothing trustworthy to show (never a fabricated row).
 *  This is what the LOBBY's high-scores board imports (lb2-8, widening ADR-0004). */
export function readTopScores(gameId: string): TopScoreRow[] {
  return cookieTopScoreTransport.read(gameId)
}

/** The single best score a game has published, or null when there is none to show. Derives
 *  from row 0 of the widened summary, and still parses a LEGACY bare-number cookie so a tile
 *  does not blank mid-rollout (before a game is redeployed on this version). This is what the
 *  lobby's TILE imports — its original ADR-0004 contract, unbroken by the widening. */
export function readTopScore(gameId: string): number | null {
  const raw = readSummaryCookie(gameId)
  if (raw === null) return null
  const rows = decodeRows(raw)
  if (rows.length > 0) return rows[0].score
  return parseTopScore(raw)
}

// --- the persistence factory -------------------------------------------------

/** The load/save pair a game binds to its own key + row validator. */
export interface HighScoreStorage<E extends HighScoreEntryBase> {
  load(): E[]
  save(table: readonly E[]): void
}

// Access localStorage defensively: in private-browsing / sandboxed contexts even
// *reading* the global can throw, and outside a browser it is simply absent.
function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

// Bind a load/save pair to `${gameId}-high-scores`, filtering loaded rows through
// `validator` (drop bad rows; [] if none). Every storage failure mode
// (missing / corrupt / not-a-table / unavailable / throwing / quota-exceeded)
// degrades gracefully — load returns [], save is a no-op — so persistence never
// crashes the game. load FILTERS the parsed rows (it does not rebuild them), so
// a survivor keeps its exact shape including an absent optional `date`.
export function makeHighScoreStorage<E extends HighScoreEntryBase>(
  gameId: string,
  validator: (value: unknown) => value is E,
  transport: TopScoreTransport = cookieTopScoreTransport,
): HighScoreStorage<E> {
  const key = highScoreKey(gameId)

  // The board's top-N ladder, or [] when there is nothing worth publishing. Derives the
  // summary the transport carries: keep only rows with a string name and a publishable
  // (finite, positive, whole) score — the same finite line isHighScoreRow holds — carry
  // name+score ONLY (the game-private `level`/`wave` field does not ride across), sort
  // highest-first (the table is written sorted, but corrupt or unsorted data must still
  // yield the true ranking), and cap at PUBLISHED_SUMMARY_DEPTH.
  function topRowsOf(table: readonly E[]): TopScoreRow[] {
    const rows: TopScoreRow[] = []
    for (const entry of table) {
      if (typeof entry.name !== 'string' || !isPublishableScore(entry.score)) continue
      rows.push({ name: entry.name, score: entry.score })
    }
    rows.sort((a, b) => b.score - a.score)
    return rows.slice(0, PUBLISHED_SUMMARY_DEPTH)
  }

  // Publish the derived ladder across the origin boundary so the lobby's board can read it.
  // This is the choke point ADR-0004 targets: every game already calls this factory exactly
  // once, so installing the publish HERE reaches tempest / star-wars / asteroids / battlezone
  // with a version bump and no game-side code at all.
  //
  // The cookie MIRRORS the table in BOTH directions. An empty board derives NO rows, and the
  // transport CLEARS on `[]` — it does not merely decline to write. Skipping the clear is what
  // let a stale ladder outlive the table it came from: the player's board was gone (quota
  // eviction, an ITP purge, a cleared localStorage) while the cookie kept advertising a high
  // score for up to 400 days, and replaying the game could not fix it, because a load with an
  // empty table published nothing. That is a tile showing a number the game itself denies — the
  // exact defect this story exists to remove. ADR-0004 says the cookie is "fully derivable from
  // the table"; derivation is a TOTAL function, and the derived summary of an empty table is
  // NO ROWS.
  function publishTop(table: readonly E[]): void {
    try {
      transport.publish(gameId, topRowsOf(table))
    } catch {
      // The cookie is a cache; the player's scores are not. A transport that blows up
      // must never cost a score or crash a game.
      console.warn(`[highscore] could not publish ${gameId}'s high-score summary; the lobby may lag`)
    }
  }

  function parseTable(raw: string): E[] {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        console.warn(`[highscore] ${key} data is not a table array; ignoring`)
        return []
      }
      return parsed.filter(validator)
    } catch {
      console.warn(`[highscore] ${key} data is corrupt JSON; ignoring`)
      return []
    }
  }

  function load(): E[] {
    const storage = getStorage()
    // Storage is unreachable (node, private mode), so we cannot know what the table says.
    // Leave the cookie ALONE: silence is not evidence of an empty board, and clearing on a
    // failed read would throw away a perfectly good published score.
    if (!storage) return []

    let raw: string | null
    try {
      raw = storage.getItem(key)
    } catch {
      return []
    }

    // Whatever we return here IS the board the player sees — a missing key and corrupt
    // JSON both mean an empty board. Republish on every load so the cookie tracks it:
    // that heals an evicted or stale cookie upward, and clears a zombie one downward.
    const rows = raw === null ? [] : parseTable(raw)
    publishTop(rows)
    return rows
  }

  function save(table: readonly E[]): void {
    const storage = getStorage()
    if (storage) {
      try {
        storage.setItem(key, JSON.stringify(table))
      } catch {
        console.warn(`[highscore] could not persist ${key} (storage full or unavailable)`)
      }
    }
    // Publish AFTER the table is safely written: localStorage is the source of truth and
    // gets the first and best chance to succeed.
    publishTop(table)
  }

  return { load, save }
}
