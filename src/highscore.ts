// @arcade/shared/highscore — the high-score TABLE logic + localStorage seam.
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
// Pure shared logic: no rendering, no game state. The persistence seam is the one
// IO surface (localStorage), and it degrades gracefully on every failure mode
// (missing / corrupt / unavailable / quota-exceeded) — a game keeps playing,
// scores just don't persist.

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
): HighScoreStorage<E> {
  const key = highScoreKey(gameId)

  function load(): E[] {
    const storage = getStorage()
    if (!storage) return []

    let raw: string | null
    try {
      raw = storage.getItem(key)
    } catch {
      return []
    }
    if (raw === null) return []

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

  function save(table: readonly E[]): void {
    const storage = getStorage()
    if (!storage) return
    try {
      storage.setItem(key, JSON.stringify(table))
    } catch {
      console.warn(`[highscore] could not persist ${key} (storage full or unavailable)`)
    }
  }

  return { load, save }
}
