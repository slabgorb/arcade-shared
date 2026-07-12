// tests/helpers/storage-stub.ts
//
// lb2-2 — a fake `localStorage` for the node test env.
//
// highscore.test.ts (SH-4) grew its own private copy of this; rather than reach into
// that file and disturb 324 green tests, the lb2-2 suites share this one. The
// distinction that matters for THIS story is that a `Storage` here is a *per-origin*
// store: the games get one, the lobby gets a different one, and nothing is shared
// between them. That is the whole bug.

/** An in-memory `Storage`. One instance == one origin's localStorage. */
export function makeFakeStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial))
  const storage = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
  return storage as Storage
}

/** A `Storage` whose setItem always throws — the quota-exceeded / full-disk path. */
export function makeQuotaStorage(): Storage {
  const storage = makeFakeStorage()
  storage.setItem = () => {
    throw new Error('QuotaExceededError')
  }
  return storage
}
