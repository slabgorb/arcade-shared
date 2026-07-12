// tests/helpers/cookie-jar.ts
//
// lb2-2 (ADR-0004) — a faithful `document.cookie` stub.
//
// The whole point of this story is that the lobby and the games live on DIFFERENT
// ORIGINS and a cookie is the only bridge between them. A test that models
// `document.cookie` as a plain mutable string would happily certify a broken
// implementation, so this jar reproduces the two behaviours that actually matter:
//
//   1. WRITE is single-cookie and attribute-bearing. `document.cookie = "a=1; Path=/"`
//      creates/overwrites ONE cookie — it does not replace the whole jar. The
//      attributes (Domain / Path / SameSite / Secure / Max-Age) ride along on the
//      write and are NOT readable afterwards.
//   2. READ is name=value pairs ONLY. The getter returns "a=1; b=2" — a browser never
//      hands the attributes back. An implementation that tries to read `Domain` off
//      `document.cookie` must fail, because a real browser would never give it back.
//
// Attributes are preserved separately in `writes` so tests can assert the cookie was
// SET with the shape ADR-0004 specifies, which is the only way to check scoping
// (Domain=slabgorb.com) without a real browser.
//
// Deletion is modelled too (Max-Age<=0 / an Expires in the past), because Safari's ITP
// purge and a normal cookie expiry both surface to us as "the cookie is simply gone".

/** One recorded assignment to `document.cookie`, split into its parts. */
export interface CookieWrite {
  /** The exact string assigned, e.g. `arcade-hi-tempest=9000; Domain=slabgorb.com; Path=/`. */
  raw: string
  name: string
  value: string
}

export interface CookieJar {
  /** Every raw assignment, in order — attributes included. */
  readonly writes: CookieWrite[]
  /** The jar as a browser would expose it: name → value, attributes stripped. */
  values(): Record<string, string>
  /** The `document`-shaped stub for `vi.stubGlobal('document', jar.document)`. */
  readonly document: { cookie: string }
}

/** Parse `name=value; Attr=x; Flag` into its name/value plus a lowercased attribute map. */
function parseAssignment(raw: string): {
  name: string
  value: string
  attrs: Map<string, string>
} {
  const parts = raw.split(';')
  const [namePart = '', ...attrParts] = parts
  const eq = namePart.indexOf('=')
  const name = (eq === -1 ? namePart : namePart.slice(0, eq)).trim()
  const value = eq === -1 ? '' : namePart.slice(eq + 1).trim()

  const attrs = new Map<string, string>()
  for (const part of attrParts) {
    const i = part.indexOf('=')
    const key = (i === -1 ? part : part.slice(0, i)).trim().toLowerCase()
    const val = i === -1 ? '' : part.slice(i + 1).trim()
    if (key) attrs.set(key, val)
  }
  return { name, value, attrs }
}

/** True when the assignment's attributes mean "delete this cookie now". */
function isExpiry(attrs: Map<string, string>): boolean {
  const maxAge = attrs.get('max-age')
  if (maxAge !== undefined && Number(maxAge) <= 0) return true

  const expires = attrs.get('expires')
  if (expires !== undefined) {
    const when = Date.parse(expires)
    if (Number.isFinite(when) && when <= Date.now()) return true
  }
  return false
}

/**
 * A `document.cookie` that behaves like a browser's.
 *
 * @param initial name → value pairs already in the jar (as if a previous page set them).
 */
export function makeCookieJar(initial: Record<string, string> = {}): CookieJar {
  const store = new Map<string, string>(Object.entries(initial))
  const writes: CookieWrite[] = []

  const document = {
    get cookie(): string {
      // Browsers hand back name=value pairs only — never the attributes.
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    },
    set cookie(raw: string) {
      const { name, value, attrs } = parseAssignment(raw)
      if (!name) return
      writes.push({ raw, name, value })
      if (isExpiry(attrs)) store.delete(name)
      else store.set(name, value)
    },
  }

  return {
    writes,
    values: () => Object.fromEntries(store),
    document,
  }
}

/** A `document` whose cookie getter AND setter both throw — private mode / sandboxed. */
export function makeHostileDocument(message = 'access denied'): { cookie: string } {
  return {
    get cookie(): string {
      throw new Error(message)
    },
    set cookie(_raw: string) {
      throw new Error(message)
    },
  }
}

/**
 * Stub the page location for BOTH access paths an implementation might use
 * (`location.hostname` or `window.location.hostname`), so the tests stay agnostic
 * about which seam Dev picks.
 */
export function locationStub(href: { hostname: string; protocol: string }): {
  location: typeof href
  window: { location: typeof href }
} {
  return { location: href, window: { location: href } }
}

/** The production cabinet: a game on its own subdomain, over https. */
export const PROD_TEMPEST = { hostname: 'tempest.slabgorb.com', protocol: 'https:' }
/** The dev cabinet: `just serve`, six localhost ports, plain http. */
export const DEV_LOCALHOST = { hostname: 'localhost', protocol: 'http:' }
