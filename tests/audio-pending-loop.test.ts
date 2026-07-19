// tests/audio-pending-loop.test.ts
//
// Story sw6-2 (epic sw6) — RED phase (TEA). A music cue that arrives before its
// buffer decodes is lost forever: `startSource` hits `if (!buffer) return` and the
// first-ever visitor hears no space theme, because the ~5 MB music buffers only
// BEGIN fetching on the unlock gesture — the same keypress that fires the run-start
// MusicEvent. The second run has music, which is exactly why sw6-1's browser check
// missed it.
//
// ── CONTRACT Dev implements to turn this GREEN ────────────────────────────────
//
// A loop requested early is honoured late — LOOPS ONLY:
//   • startLoop(name) with `name`'s buffer not yet decoded records a PENDING start,
//     keyed PER CHANNEL (at most one pending name per channel — the same shape as
//     the `live` voice map). When that buffer's decode lands, the loop starts on
//     its channel (stealing whatever sounds there), exactly as if startLoop had
//     been called then.
//   • LAST REQUEST WINS: a later startLoop on the same channel replaces the
//     channel's pending name. A stale pending track must NEVER start behind the
//     current one — in either decode order.
//   • stopLoop(name) clears the channel's pending start as well as its live voice.
//   • play() (one-shots) NEVER pends: a laser that fires before its sample decodes
//     is dropped, not replayed half a second late.
//   • The pending start fires when ITS OWN buffer decodes — never gated on
//     ready(), which goes true when ANY sample decodes (the tiny SFX always beat
//     the ~5 MB music, so a ready() gate would look fixed and fix nothing).
//   • A FAILED load must stay distinguishable from a SLOW one: when a file's
//     fetch/decode fails and a pending start is (or later gets) parked on it, the
//     engine must leave a trace — `console.warn` naming the file — instead of
//     pending forever in silence. (Silent degrade is how this epic's 404s hid for
//     a full epic; this story must not rebuild that trap one layer up.)
//
// Pre-resume behaviour is UNCHANGED: startLoop before resume() stays a silent
// no-op (pinned by SH2-16's suite). The race this story fixes is post-resume /
// pre-decode — the window the unlock gesture itself opens.
//
// ── RED audit — intended pre-GREEN passes ─────────────────────────────────────
// Most tests below FAIL against the shipped engine (no source is ever created for
// an early request — that IS the defect). Two are keep-behaviour guards that pass
// pre-GREEN by design and must STAY green after the fix:
//   • "a one-shot requested early stays dropped" (the loop-only scope of the fix)
//   • "stopLoop before the decode cancels the pending start" (its red counterpart
//     is the honoured-late test; this half pins that the fix doesn't overshoot)
// Every universally-quantified "never starts" assertion is paired, in the same
// test, with a positive existence assertion so it cannot pass vacuously.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Fake WebAudio surface ─────────────────────────────────────────────────────
// The audio.test.ts stub (context/gain/source spy log + fetch/decode pipeline),
// extended with PER-FILE DECODE GATES so a test can land decodes in a chosen
// order — the resurrection trap only shows when the stale file decodes LAST.

interface FakeHandles {
  created: {
    contexts: FakeCtx[]
    gains: FakeGain[]
    sources: FakeSource[]
    fetches: string[]
    decodes: string[]
  }
  /** Resolve the held decode for a gated filename (see InstallOpts.decodeGated). */
  release(file: string): Promise<void>
}

interface InstallOpts {
  startState?: 'suspended' | 'running'
  fetchFails?: Set<string> // filenames whose fetch REJECTS
  decodeFails?: Set<string> // filenames whose decodeAudioData REJECTS
  decodeGated?: Set<string> // filenames whose decode WAITS for release(file)
}

class FakeGain {
  gain = { value: -1 }
  connectedTo: unknown = null
  connect(dest: unknown): void {
    this.connectedTo = dest
  }
}

class FakeSource {
  buffer: unknown = null
  loop = false
  onended: (() => void) | null = null
  connectedTo: unknown = null
  started = false
  stopped = false
  disconnected = false
  connect(dest: unknown): void {
    this.connectedTo = dest
  }
  start(): void {
    this.started = true
  }
  stop(): void {
    this.stopped = true
  }
  disconnect(): void {
    this.disconnected = true
  }
}

class FakeCtx {
  state: 'suspended' | 'running'
  destination = { __dest: true }
  resumeCalls = 0
  private opts: InstallOpts
  private created: FakeHandles['created']
  private gates: Map<string, () => void>
  constructor(opts: InstallOpts, created: FakeHandles['created'], gates: Map<string, () => void>) {
    this.opts = opts
    this.created = created
    this.gates = gates
    this.state = opts.startState ?? 'running'
    created.contexts.push(this)
  }
  createGain(): FakeGain {
    const g = new FakeGain()
    this.created.gains.push(g)
    return g
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource()
    this.created.sources.push(s)
    return s
  }
  resume(): Promise<void> {
    this.resumeCalls++
    return Promise.resolve()
  }
  decodeAudioData(data: { __url?: string }): Promise<unknown> {
    const url = (data && data.__url) ?? ''
    this.created.decodes.push(url)
    if ([...(this.opts.decodeFails ?? [])].some((f) => url.endsWith(f))) {
      return Promise.reject(new Error('undecodable sample'))
    }
    const gatedAs = [...(this.opts.decodeGated ?? [])].find((f) => url.endsWith(f))
    if (gatedAs) {
      return new Promise((resolve) => {
        this.gates.set(gatedAs, () => resolve({ __buffer: url }))
      })
    }
    return Promise.resolve({ __buffer: url })
  }
}

let saved: { AC: unknown; WK: unknown; FETCH: unknown }
let warnSpy: ReturnType<typeof vi.spyOn>

function install(opts: InstallOpts = {}): FakeHandles {
  const created: FakeHandles['created'] = {
    contexts: [],
    gains: [],
    sources: [],
    fetches: [],
    decodes: [],
  }
  const gates = new Map<string, () => void>()
  const g = globalThis as Record<string, unknown>
  g.AudioContext = class extends FakeCtx {
    constructor() {
      super(opts, created, gates)
    }
  }
  g.webkitAudioContext = undefined
  g.fetch = (url: string) => {
    created.fetches.push(url)
    if ([...(opts.fetchFails ?? [])].some((f) => url.endsWith(f))) {
      return Promise.reject(new Error('network error'))
    }
    return Promise.resolve({ arrayBuffer: () => Promise.resolve({ __url: url }) })
  }
  return {
    created,
    async release(file: string): Promise<void> {
      // The fetch -> arrayBuffer -> decode pipeline reaches the gate on
      // microtasks — drain until the held decode appears, so a release issued
      // right after resume()/startLoop() doesn't race its own fixture.
      for (let i = 0; i < 16 && !gates.has(file); i++) await Promise.resolve()
      const open = gates.get(file)
      expect(open, `release('${file}') called but no decode is gated on it`).toBeTypeOf('function')
      open?.()
      gates.delete(file)
      await flush()
    },
  }
}

/** Drain the fetch -> arrayBuffer -> decode -> store (-> pending start) chain. */
async function flush(): Promise<void> {
  for (let i = 0; i < 16; i++) await Promise.resolve()
}

const load = () => import('../src/audio')

/** The fake decode marks each buffer with its url — read it back off a source. */
function bufferUrl(s: FakeSource): string {
  const b = s.buffer as { __buffer?: string } | null
  return (b && b.__buffer) ?? ''
}

/** Every warn call's args, stringified and joined — for "the trace names the file". */
function warnTexts(): string[] {
  return warnSpy.mock.calls.map((args: unknown[]) => args.map(String).join(' '))
}

// ── Manifests ─────────────────────────────────────────────────────────────────
// Names/channels mirror the star-wars music wiring (several tracks, ONE looping
// 'music' channel — sw3-5's single-music-channel invariant), but stay per-cabinet
// NUMBERS: the engine under test is the shared VERB.
const BASE = 'https://sfx.example/'
const MUSIC = {
  baseUrl: BASE,
  sounds: { space: 'space.wav', towers: 'towers.wav' },
  channels: { space: 'music', towers: 'music' },
}
// A tiny SFX beside the big theme — the ready() trap needs a fast file to win.
const MIXED = {
  baseUrl: BASE,
  sounds: { laser: 'laser.wav', space: 'space.wav' },
  channels: { laser: 'sfx', space: 'music' },
}
// Two loops on independent channels — pending must be per-channel, not a single slot.
const TWO_CHANNELS = {
  baseUrl: BASE,
  sounds: { hum: 'hum.wav', space: 'space.wav' },
  channels: { hum: 'engine', space: 'music' },
}

async function mkEngine(manifest: unknown, opts: InstallOpts = {}) {
  const h = install(opts)
  const { createAudioEngine } = await load()
  const engine = createAudioEngine(manifest as never)
  return { engine, created: h.created, release: h.release }
}

beforeEach(() => {
  const g = globalThis as Record<string, unknown>
  saved = { AC: g.AudioContext, WK: g.webkitAudioContext, FETCH: g.fetch }
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  const g = globalThis as Record<string, unknown>
  g.AudioContext = saved.AC
  g.webkitAudioContext = saved.WK
  g.fetch = saved.FETCH
  warnSpy.mockRestore()
})

// ── AC-1 + AC-2: the defect, reproduced — a loop requested early is honoured late ──

describe('sw6-2 audio — a loop requested before its buffer decodes (AC-1, AC-2)', () => {
  it('starts when the decode lands — the first-visitor space theme is not lost', async () => {
    const { engine, created } = await mkEngine(MUSIC)
    engine.resume()
    // The SAME gesture that unlocked audio fires the run-start music cue: the
    // request lands synchronously, before any fetch/decode microtask can run.
    engine.startLoop('space')
    expect(created.sources, 'nothing CAN sound yet — the buffer is still decoding').toHaveLength(0)
    await flush()
    expect(
      created.sources,
      'the decode landed — the remembered loop must now start (shipped code: silent no-op, 0 sources, the bug)',
    ).toHaveLength(1)
    expect(created.sources[0].loop, 'it starts as a LOOP').toBe(true)
    expect(created.sources[0].started, 'and is actually started').toBe(true)
    expect(bufferUrl(created.sources[0]), 'with the requested track buffer').toContain('space.wav')
  })

  it('a late-started loop is a real live voice — stopLoop stops it', async () => {
    const { engine, created } = await mkEngine(MUSIC)
    engine.resume()
    engine.startLoop('space')
    await flush()
    expect(created.sources, 'the pending loop started on decode').toHaveLength(1)
    engine.stopLoop('space')
    expect(
      created.sources[0].stopped,
      'a loop the engine started late must be registered on its channel, or it becomes unstoppable',
    ).toBe(true)
  })

  it('KEEP: a one-shot requested early stays DROPPED — only loops are honoured late', async () => {
    // Intended pre-GREEN pass (see header audit): a laser fired before its sample
    // decodes must NOT replay half a second late, out of sync with the shot.
    const { engine, created } = await mkEngine(MIXED)
    engine.resume()
    engine.play('laser')
    await flush()
    expect(
      created.sources,
      'the early one-shot is dropped for good — a pending queue must not replay it on decode',
    ).toHaveLength(0)
    // Positive control (non-vacuity): the same sound plays fine when requested
    // after its decode — the drop above was the scope rule, not a broken fixture.
    engine.play('laser')
    expect(created.sources, 'requested after decode, the one-shot sounds').toHaveLength(1)
    expect(created.sources[0].loop).toBe(false)
    expect(bufferUrl(created.sources[0])).toContain('laser.wav')
  })

  it('re-requesting the SAME pending loop does not double-start it', async () => {
    const { engine, created } = await mkEngine(MUSIC)
    engine.resume()
    engine.startLoop('space')
    engine.startLoop('space') // e.g. a second gesture / repeated cue in the window
    await flush()
    expect(
      created.sources,
      'one pending slot per channel — the decode starts ONE source, not one per request',
    ).toHaveLength(1)
    expect(created.sources[0].started).toBe(true)
  })
})

// ── AC-3: last request wins + the single-music-channel invariant ───────────────

describe('sw6-2 audio — two loops cued before either decodes (AC-3)', () => {
  it('only the MOST RECENT request sounds when decodes land in request order', async () => {
    const { engine, created } = await mkEngine(MUSIC)
    engine.resume()
    engine.startLoop('space') // a fast phase edge on a cold load:
    engine.startLoop('towers') // the newer cue replaces the pending older one
    await flush() // space.wav decodes first (fetch order), towers.wav after
    expect(
      created.sources,
      'exactly ONE source — the stale space theme must not start at all',
    ).toHaveLength(1)
    expect(bufferUrl(created.sources[0]), 'and it is the LATEST request').toContain('towers.wav')
    expect(created.sources[0].started).toBe(true)
    expect(created.sources[0].stopped, 'the current track keeps ringing').toBe(false)
    expect(created.sources[0].loop).toBe(true)
  })

  it('a stale pending track must not resurrect when ITS decode lands LAST', async () => {
    const { engine, created, release } = await mkEngine(MUSIC, {
      decodeGated: new Set(['space.wav', 'towers.wav']),
    })
    engine.resume()
    engine.startLoop('space')
    engine.startLoop('towers')
    await flush() // both fetched; both decodes held by the gates
    expect(created.sources, 'nothing sounds while both decodes are held').toHaveLength(0)
    await release('towers.wav') // the CURRENT track decodes first
    expect(created.sources, 'the current track starts on its decode').toHaveLength(1)
    expect(bufferUrl(created.sources[0])).toContain('towers.wav')
    await release('space.wav') // the STALE track decodes late
    expect(
      created.sources,
      'the stale space theme must NOT start behind the current one (no resurrection)',
    ).toHaveLength(1)
    expect(created.sources[0].stopped, 'and the current track was not stolen by a ghost').toBe(false)
  })

  it('the latest request steals a loop that is ALREADY sounding when its decode lands', async () => {
    const { engine, created, release } = await mkEngine(MUSIC, {
      decodeGated: new Set(['space.wav', 'towers.wav']),
    })
    engine.resume()
    await release('towers.wav') // towers decodes BEFORE it is requested…
    engine.startLoop('towers') // …so this start is the shipped, immediate path
    expect(created.sources, 'towers decoded and rings (existing behaviour)').toHaveLength(1)
    engine.startLoop('space') // phase edge: space is now the LAST request, still decoding
    await release('space.wav')
    expect(created.sources, 'space starts when its decode lands').toHaveLength(2)
    expect(created.sources[0].stopped, 'and STEALS the channel — towers stops').toBe(true)
    expect(created.sources[1].started).toBe(true)
    expect(created.sources[1].loop).toBe(true)
    expect(bufferUrl(created.sources[1])).toContain('space.wav')
    const ringing = created.sources.filter((s) => s.started && !s.stopped)
    expect(ringing, 'single-music-channel invariant: exactly one loop rings').toHaveLength(1)
  })

  it('loops pending on DIFFERENT channels both start — pending is per-channel', async () => {
    const { engine, created } = await mkEngine(TWO_CHANNELS)
    engine.resume()
    engine.startLoop('hum')
    engine.startLoop('space')
    await flush()
    expect(
      created.sources,
      'independent channels must not share one pending slot — both loops start',
    ).toHaveLength(2)
    const urls = created.sources.map(bufferUrl).join(' ')
    expect(urls, 'the engine hum started').toContain('hum.wav')
    expect(urls, 'and the music started').toContain('space.wav')
    for (const s of created.sources) {
      expect(s.started).toBe(true)
      expect(s.loop).toBe(true)
      expect(s.stopped, 'different channels never steal each other').toBe(false)
    }
  })
})

// ── AC-4: a loop cancelled before it decodes must never start ──────────────────

describe('sw6-2 audio — cancel before decode (AC-4)', () => {
  it('KEEP: stopLoop between the request and the decode cancels the pending start', async () => {
    // Intended pre-GREEN pass (see header audit) — the red counterpart is the
    // honoured-late test above. This half pins that the fix does not overshoot:
    // music must never fade up seconds after the phase that wanted it has ended.
    const { engine, created } = await mkEngine(MUSIC)
    engine.resume()
    engine.startLoop('space')
    engine.stopLoop('space')
    await flush()
    expect(
      created.sources,
      'the cancelled request contributes NO source when the decode lands',
    ).toHaveLength(0)
    // Positive control (non-vacuity): the channel is not poisoned — a fresh
    // request after the decode starts normally.
    engine.startLoop('space')
    expect(created.sources, 'a fresh post-decode request starts at once').toHaveLength(1)
    expect(created.sources[0].started).toBe(true)
    expect(created.sources[0].loop).toBe(true)
  })
})

// ── AC-5: ready() is NOT the gate — the pending start fires on ITS OWN decode ──

describe('sw6-2 audio — ready() cannot gate the music start (AC-5)', () => {
  it('the pending loop waits for ITS buffer even while ready() is already true', async () => {
    const { engine, created, release } = await mkEngine(MIXED, {
      decodeGated: new Set(['space.wav']), // the ~5 MB theme is slow…
    })
    engine.resume()
    engine.startLoop('space')
    await flush() // …and the tiny laser.wav decodes immediately
    expect(
      engine.ready(),
      'ready() goes true as soon as ANY sample decodes — the tiny SFX wins the race',
    ).toBe(true)
    expect(
      created.sources,
      'yet the music must NOT have started: its own buffer is still decoding, and a ready() gate would be starting it now against a missing buffer',
    ).toHaveLength(0)
    await release('space.wav')
    expect(created.sources, 'the music starts exactly when ITS decode lands').toHaveLength(1)
    expect(bufferUrl(created.sources[0])).toContain('space.wav')
    expect(created.sources[0].loop).toBe(true)
  })
})

// ── AC-6: a missing asset must stay distinguishable from a slow one ────────────

describe('sw6-2 audio — a FAILED load must leave a trace, never pend forever (AC-6)', () => {
  it('a pending loop whose FETCH fails warns (naming the file) and never starts', async () => {
    const { engine, created } = await mkEngine(MUSIC, { fetchFails: new Set(['space.wav']) })
    engine.resume()
    engine.startLoop('space') // parked pending…
    await flush() // …and the fetch 404s — the sw6 epic's original hidden failure
    expect(created.sources, 'nothing can start — the asset is gone').toHaveLength(0)
    expect(
      warnTexts().some((t) => t.includes('space.wav')),
      'the engine must console.warn naming space.wav — a silent forever-pending request is this epic’s 404 trap rebuilt one layer up',
    ).toBe(true)
  })

  it('a pending loop whose DECODE fails warns too — the trace lives on the shared failure path', async () => {
    const { engine, created } = await mkEngine(MUSIC, { decodeFails: new Set(['space.wav']) })
    engine.resume()
    engine.startLoop('space')
    await flush()
    expect(created.sources).toHaveLength(0)
    expect(
      warnTexts().some((t) => t.includes('space.wav')),
      'an undecodable sample with a pending start must warn, same as a failed fetch',
    ).toBe(true)
  })

  it('requesting a loop whose load ALREADY failed warns instead of pending in silence', async () => {
    const { engine, created } = await mkEngine(MUSIC, { fetchFails: new Set(['space.wav']) })
    engine.resume()
    await flush() // the failure lands first…
    engine.startLoop('space') // …then the cue arrives
    expect(created.sources, 'a known-failed sound never starts').toHaveLength(0)
    expect(
      warnTexts().some((t) => t.includes('space.wav')),
      'the request against a known-failed file must warn at request time, not park forever',
    ).toBe(true)
  })

  it('a slow (still-decoding) request does NOT warn — slow is not missing', async () => {
    const { engine, created, release } = await mkEngine(MUSIC, {
      decodeGated: new Set(['space.wav']),
    })
    engine.resume()
    engine.startLoop('space')
    await flush() // decode held open: the sound is SLOW, not FAILED
    expect(
      warnTexts(),
      'no failure has happened — warning on a merely-slow decode would cry wolf on every cold load',
    ).toHaveLength(0)
    await release('space.wav')
    expect(created.sources, 'and the slow request is then honoured').toHaveLength(1)
    expect(warnTexts(), 'still no warning after the honoured start').toHaveLength(0)
  })
})
