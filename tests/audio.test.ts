// tests/audio.test.ts
//
// Story SH2-16 (epic SH2) — RED phase (O'Brien / TEA). The FIRST audio subpath and
// a BROWSER subpath: @arcade/shared/audio, the shell-side WebAudio SFX engine four
// cabinets hand-write today (tempest is the reference impl). This suite PINS THE
// MECHANISM — the shared VERB — against a fake AudioContext.
//
// WHY a fake context and RUNTIME assertions (not type checks): arcade-shared's own
// tests are untyped (esbuild strips types; memory: arcade-shared-tests-untyped) and
// run in node with NO WebAudio. A compile-only guarantee would be silently erased,
// so every behaviour below is observed on a controllable stub installed on
// globalThis. The generic `<N extends string>` contract is proven separately — at
// the consumer (tempest's tsc build, SH2-16 AC-5) and by audio-source-rules.test.ts.
//
// ── CONTRACT Dev implements to turn this GREEN (design §4) ───────────────────
//
//   interface AudioEngine<N extends string> {
//     resume(): void          // lazily create/unlock the AudioContext + begin load
//     play(name: N): void     // one-shot; STEALS its channel
//     startLoop(name: N): void // sustained loop on its channel; steals like play()
//     stopLoop(name: N): void // stop the loop sounding on name's channel
//     ready(): boolean        // true once >= 1 sample has decoded
//   }
//   interface AudioManifest<N extends string> {
//     baseUrl: string
//     masterGain?: number           // default 0.4
//     sounds: Record<N, string>     // logical name -> FILENAME (per-cabinet NUMBERS)
//     channels: Record<N, string>   // logical name -> channel  (per-cabinet NUMBERS)
//   }
//   function createAudioEngine<N extends string>(manifest: AudioManifest<N>): AudioEngine<N>
//
// The load-bearing NEW behaviour vs tempest's per-name engine: buffers are keyed by
// FILENAME, so a manifest mapping two names to one .wav fetches/decodes it ONCE
// (design §4.1 — the asteroids N:1 case, proven here ahead of SH2-17).
//
// RED until src/audio.ts exists and exports createAudioEngine.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ── Fake WebAudio surface ─────────────────────────────────────────────────────
// A stub AudioContext / GainNode / BufferSource + a stub fetch/decode pipeline,
// installed on globalThis so the engine's lazy `new AudioContext()`, sample
// loading, and voice-stealing can be OBSERVED without a browser. `created` is the
// spy log every test asserts against.

interface FakeHandles {
  created: {
    contexts: FakeCtx[]
    gains: FakeGain[]
    sources: FakeSource[]
    fetches: string[] // every url fetch() was called with
    decodes: string[] // every url that reached decodeAudioData (got past fetch)
  }
}

interface InstallOpts {
  startState?: 'suspended' | 'running' // context.state at creation (default suspended)
  fetchFails?: Set<string> // filenames whose fetch REJECTS
  decodeFails?: Set<string> // filenames whose decodeAudioData REJECTS
  stopThrows?: boolean // BufferSource.stop() throws (models stopping an ended node)
}

class FakeGain {
  gain = { value: -1 } // sentinel; the engine must overwrite it with masterGain
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
  private throwOnStop: boolean
  constructor(throwOnStop: boolean) {
    this.throwOnStop = throwOnStop
  }
  connect(dest: unknown): void {
    this.connectedTo = dest
  }
  start(): void {
    this.started = true
  }
  stop(): void {
    if (this.throwOnStop) throw new Error('cannot stop an already-ended source')
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
  constructor(opts: InstallOpts, created: FakeHandles['created']) {
    this.opts = opts
    this.created = created
    this.state = opts.startState ?? 'suspended'
    created.contexts.push(this)
  }
  createGain(): FakeGain {
    const g = new FakeGain()
    this.created.gains.push(g)
    return g
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource(Boolean(this.opts.stopThrows))
    this.created.sources.push(s)
    return s
  }
  resume(): Promise<void> {
    this.resumeCalls++
    return Promise.resolve()
  }
  decodeAudioData(data: { __url?: string }): Promise<unknown> {
    const url = data && data.__url
    this.created.decodes.push(url ?? '')
    const fails =
      typeof url === 'string' && [...(this.opts.decodeFails ?? [])].some((f) => url.endsWith(f))
    if (fails) return Promise.reject(new Error('undecodable sample'))
    // A distinct fake AudioBuffer per decode. Two names sharing ONE file still get
    // one buffer object, because the engine decodes that file once and keys it by
    // filename — that identity is exactly what the dedup test asserts.
    return Promise.resolve({ __buffer: url })
  }
}

let saved: { AC: unknown; WK: unknown; FETCH: unknown }

function install(opts: InstallOpts = {}): FakeHandles {
  const created: FakeHandles['created'] = {
    contexts: [],
    gains: [],
    sources: [],
    fetches: [],
    decodes: [],
  }
  const g = globalThis as Record<string, unknown>
  g.AudioContext = class extends FakeCtx {
    constructor() {
      super(opts, created)
    }
  }
  g.webkitAudioContext = undefined
  g.fetch = (url: string) => {
    created.fetches.push(url)
    const fails = [...(opts.fetchFails ?? [])].some((f) => url.endsWith(f))
    if (fails) return Promise.reject(new Error('network error'))
    return Promise.resolve({ arrayBuffer: () => Promise.resolve({ __url: url }) })
  }
  return { created }
}

/** Drain the fetch -> arrayBuffer -> decode -> store microtask chain. */
async function flush(): Promise<void> {
  for (let i = 0; i < 16; i++) await Promise.resolve()
}

const load = () => import('../src/audio')

// ── Manifests (per-cabinet NUMBERS; the shared engine is the VERB) ──────────────
const BASE = 'https://sfx.example/'
const TWO = {
  baseUrl: BASE,
  sounds: { a: 'a.wav', b: 'b.wav' },
  channels: { a: 'ca', b: 'cb' }, // independent channels
}
const SAME_CHANNEL = {
  baseUrl: BASE,
  sounds: { a: 'a.wav', b: 'b.wav' },
  channels: { a: 'ch', b: 'ch' }, // one voice — b steals a
}
const ONE = { baseUrl: BASE, sounds: { a: 'a.wav' }, channels: { a: 'ch' } }
const LOOP = { baseUrl: BASE, sounds: { hum: 'hum.wav' }, channels: { hum: 'hum' } }
// asteroids' N:1 case: two logical names, ONE .wav file, distinct channels.
const DEDUP = {
  baseUrl: BASE,
  sounds: { boom: 'explode.wav', blast: 'explode.wav' },
  channels: { boom: 'c1', blast: 'c2' },
}

async function mkEngine(manifest: unknown, opts: InstallOpts = {}) {
  const h = install(opts)
  const { createAudioEngine } = await load()
  const engine = createAudioEngine(manifest as never)
  return { engine, created: h.created }
}

beforeEach(() => {
  const g = globalThis as Record<string, unknown>
  saved = { AC: g.AudioContext, WK: g.webkitAudioContext, FETCH: g.fetch }
})
afterEach(() => {
  const g = globalThis as Record<string, unknown>
  g.AudioContext = saved.AC
  g.webkitAudioContext = saved.WK
  g.fetch = saved.FETCH
})

// ── AC-2: lazy context, no-op-before-resume, inert without WebAudio ─────────────

describe('SH2-16 audio — lazy context creation (only on resume, AC-2)', () => {
  it('creates NO AudioContext until resume() is called', async () => {
    const { engine, created } = await mkEngine(TWO)
    expect(created.contexts, 'no context before a user gesture unlocks it').toHaveLength(0)
    engine.resume()
    expect(created.contexts, 'resume() builds exactly one context').toHaveLength(1)
  })

  it('play/startLoop/stopLoop before resume() are silent no-ops (no source, no throw)', async () => {
    const { engine, created } = await mkEngine(TWO)
    expect(() => {
      engine.play('a')
      engine.startLoop('a')
      engine.stopLoop('a')
    }, 'every method must no-op before the context exists').not.toThrow()
    expect(created.contexts, 'no method may lazily build a context on its own').toHaveLength(0)
    expect(created.sources, 'nothing sounds before resume()').toHaveLength(0)
  })

  it('resume() is idempotent — a second call adds no context and does not refetch', async () => {
    const { engine, created } = await mkEngine(TWO)
    engine.resume()
    await flush()
    const fetchesAfterFirst = created.fetches.length
    engine.resume()
    await flush()
    expect(created.contexts, 'still exactly one context').toHaveLength(1)
    expect(created.fetches.length, 'samples load once, not again on the next gesture').toBe(
      fetchesAfterFirst,
    )
  })

  it('stays completely inert when WebAudio is absent (no AudioContext global)', async () => {
    const g = globalThis as Record<string, unknown>
    g.AudioContext = undefined
    g.webkitAudioContext = undefined
    const { createAudioEngine } = await load()
    const engine = createAudioEngine(TWO as never)
    expect(() => {
      engine.resume()
      engine.play('a')
      engine.startLoop('a')
      engine.stopLoop('a')
    }, 'no WebAudio must leave the game silent, never throwing').not.toThrow()
    await flush()
    expect(engine.ready(), 'nothing can be ready with no audio subsystem').toBe(false)
  })

  it('degrades silently when the AudioContext constructor throws', async () => {
    const g = globalThis as Record<string, unknown>
    g.AudioContext = class {
      constructor() {
        throw new Error('blocked by autoplay policy')
      }
    }
    g.webkitAudioContext = undefined
    const { createAudioEngine } = await load()
    const engine = createAudioEngine(TWO as never)
    expect(() => engine.resume(), 'a throwing ctor must not crash the caller').not.toThrow()
    expect(() => engine.play('a')).not.toThrow()
    await flush()
    expect(engine.ready()).toBe(false)
  })
})

// ── AC-2: master gain node + routing ────────────────────────────────────────────

describe('SH2-16 audio — master GainNode (AC-2)', () => {
  it('builds one master gain at the default 0.4 and connects it to the destination', async () => {
    const { engine, created } = await mkEngine(TWO) // no masterGain → default
    engine.resume()
    expect(created.gains, 'exactly one master gain').toHaveLength(1)
    expect(created.gains[0].gain.value, 'default masterGain is 0.4').toBeCloseTo(0.4, 9)
    expect(created.gains[0].connectedTo, 'master routes to ctx.destination').toBe(
      created.contexts[0].destination,
    )
  })

  it('honours the manifest masterGain when provided', async () => {
    const { engine, created } = await mkEngine({ ...TWO, masterGain: 0.7 })
    engine.resume()
    expect(created.gains[0].gain.value, 'masterGain overrides the default').toBeCloseTo(0.7, 9)
  })

  it('routes every played source through the master gain (not straight to destination)', async () => {
    const { engine, created } = await mkEngine(TWO)
    engine.resume()
    await flush()
    engine.play('a')
    expect(created.sources, 'one source played').toHaveLength(1)
    expect(created.sources[0].connectedTo, 'source connects to the master gain').toBe(
      created.gains[0],
    )
  })
})

// ── AC-2: suspended-context gesture unlock ──────────────────────────────────────

describe('SH2-16 audio — suspended-context unlock', () => {
  it('resume()s a context that starts suspended (the gesture unlock)', async () => {
    const { engine, created } = await mkEngine(TWO, { startState: 'suspended' })
    engine.resume()
    expect(created.contexts[0].resumeCalls, 'a suspended context is resumed').toBeGreaterThanOrEqual(
      1,
    )
  })

  it('does NOT call ctx.resume() when the context is already running', async () => {
    const { engine, created } = await mkEngine(TWO, { startState: 'running' })
    engine.resume()
    expect(created.contexts[0].resumeCalls, 'a running context needs no resume()').toBe(0)
  })
})

// ── AC-2: loading + ready() ─────────────────────────────────────────────────────

describe('SH2-16 audio — sample loading + ready() (AC-2)', () => {
  it('ready() is false before any decode and true once a sample decodes', async () => {
    const { engine } = await mkEngine(TWO)
    expect(engine.ready(), 'nothing decoded before resume()').toBe(false)
    engine.resume()
    expect(engine.ready(), 'decode is async — not ready the instant resume() returns').toBe(false)
    await flush()
    expect(engine.ready(), 'ready once >= 1 sample has decoded').toBe(true)
  })

  it('fetches each distinct sample exactly once (1:1 manifest)', async () => {
    const { engine, created } = await mkEngine(TWO)
    engine.resume()
    await flush()
    expect(created.fetches.filter((u) => u.endsWith('a.wav'))).toHaveLength(1)
    expect(created.fetches.filter((u) => u.endsWith('b.wav'))).toHaveLength(1)
    expect(created.fetches, 'two distinct files → two fetches').toHaveLength(2)
  })
})

// ── AC-3: filename-keyed buffer dedup (the asteroids N:1 case) ───────────────────

describe('SH2-16 audio — buffers keyed by filename (AC-3)', () => {
  it('decodes a shared file ONCE when two names map to it', async () => {
    const { engine, created } = await mkEngine(DEDUP)
    engine.resume()
    await flush()
    expect(
      created.fetches.filter((u) => u.endsWith('explode.wav')),
      'two names → one file → ONE fetch',
    ).toHaveLength(1)
    expect(
      created.decodes.filter((u) => u.endsWith('explode.wav')),
      'two names → one file → ONE decode',
    ).toHaveLength(1)
  })

  it('resolves both shared-file names to the SAME decoded buffer', async () => {
    const { engine, created } = await mkEngine(DEDUP)
    engine.resume()
    await flush()
    engine.play('boom')
    engine.play('blast')
    expect(created.sources, 'both names play (distinct channels, no steal)').toHaveLength(2)
    expect(created.sources[0].buffer, 'boom got a decoded buffer').toBeTruthy()
    expect(
      created.sources[0].buffer,
      'name → file → buffer: both names resolve to the one shared buffer',
    ).toBe(created.sources[1].buffer)
  })

  it('is ready after the single shared decode', async () => {
    const { engine } = await mkEngine(DEDUP)
    engine.resume()
    await flush()
    expect(engine.ready()).toBe(true)
  })
})

// ── AC-2: POKEY-style voice-stealing ────────────────────────────────────────────

describe('SH2-16 audio — channel voice-stealing (AC-2)', () => {
  it('a retrigger on the SAME channel steals — stops the prior source, starts the new one', async () => {
    const { engine, created } = await mkEngine(SAME_CHANNEL)
    engine.resume()
    await flush()
    engine.play('a')
    const first = created.sources[0]
    engine.play('b') // b shares a's channel → steals it
    const second = created.sources[1]
    expect(first.stopped, 'the prior source on the channel is stopped').toBe(true)
    expect(second.started, 'the stealing source starts').toBe(true)
    expect(second.stopped, 'the new source keeps sounding').toBe(false)
  })

  it('a retrigger of the SAME name steals its own channel (held-fire pile-up fix)', async () => {
    const { engine, created } = await mkEngine(ONE)
    engine.resume()
    await flush()
    engine.play('a')
    engine.play('a')
    expect(created.sources, 'a fresh source per trigger').toHaveLength(2)
    expect(created.sources[0].stopped, 'the first source is cut off, not stacked').toBe(true)
    expect(created.sources[1].started).toBe(true)
  })

  it('independent channels do NOT steal one another', async () => {
    const { engine, created } = await mkEngine(TWO)
    engine.resume()
    await flush()
    engine.play('a')
    engine.play('b')
    expect(created.sources[0].stopped, 'a on channel ca is untouched by b on cb').toBe(false)
    expect(created.sources[0].started).toBe(true)
    expect(created.sources[1].started).toBe(true)
  })
})

// ── AC-2: sustained loops ────────────────────────────────────────────────────────

describe('SH2-16 audio — startLoop / stopLoop (AC-2)', () => {
  it('startLoop sets source.loop = true and starts it', async () => {
    const { engine, created } = await mkEngine(LOOP)
    engine.resume()
    await flush()
    engine.startLoop('hum')
    expect(created.sources[0].loop, 'a loop must set source.loop').toBe(true)
    expect(created.sources[0].started).toBe(true)
  })

  it('play() is a one-shot — source.loop stays false', async () => {
    const { engine, created } = await mkEngine(LOOP)
    engine.resume()
    await flush()
    engine.play('hum')
    expect(created.sources[0].loop, 'one-shots never loop').toBe(false)
  })

  it('stopLoop stops the loop sounding on its channel', async () => {
    const { engine, created } = await mkEngine(LOOP)
    engine.resume()
    await flush()
    engine.startLoop('hum')
    engine.stopLoop('hum')
    expect(created.sources[0].stopped, 'stopLoop silences the looping source').toBe(true)
  })

  it('stopLoop is a silent no-op when nothing is looping on the channel', async () => {
    const { engine, created } = await mkEngine(LOOP)
    engine.resume()
    await flush()
    expect(() => engine.stopLoop('hum'), 'stopping an empty channel must not throw').not.toThrow()
    expect(created.sources, 'nothing was sounding — nothing to stop').toHaveLength(0)
  })
})

// ── AC-2: silent-degrade at EVERY failure path ──────────────────────────────────

describe('SH2-16 audio — silent degradation, never a throw (AC-2)', () => {
  it('a sample whose FETCH fails never plays (no source, no throw, not ready)', async () => {
    const { engine, created } = await mkEngine(ONE, { fetchFails: new Set(['a.wav']) })
    engine.resume()
    await flush()
    expect(engine.ready(), 'a failed fetch leaves nothing decoded').toBe(false)
    expect(() => engine.play('a'), 'playing an unloaded sound must no-op').not.toThrow()
    expect(created.sources, 'nothing sounds').toHaveLength(0)
  })

  it('a sample whose DECODE rejects never plays (decode attempted, then silent)', async () => {
    const { engine, created } = await mkEngine(ONE, { decodeFails: new Set(['a.wav']) })
    engine.resume()
    await flush()
    expect(
      created.decodes.some((u) => u.endsWith('a.wav')),
      'the fetch succeeded — decode was attempted',
    ).toBe(true)
    expect(engine.ready(), 'an undecodable sample leaves the store empty').toBe(false)
    expect(() => engine.play('a')).not.toThrow()
    expect(created.sources).toHaveLength(0)
  })

  it('stealing a channel whose prior source THROWS on stop() still cuts in', async () => {
    const { engine, created } = await mkEngine(SAME_CHANNEL, { stopThrows: true })
    engine.resume()
    await flush()
    engine.play('a')
    expect(() => engine.play('b'), 'a stop() on an ended node must not abort the cut-in').not.toThrow()
    expect(created.sources, 'the replacement source is still created').toHaveLength(2)
    expect(created.sources[1].started, 'and still starts').toBe(true)
  })

  it('a source cleared by onended is not re-stopped on the next trigger', async () => {
    const { engine, created } = await mkEngine(ONE)
    engine.resume()
    await flush()
    engine.play('a')
    const first = created.sources[0]
    expect(first.onended, 'the engine wires onended to release the channel').toBeTypeOf('function')
    first.onended?.() // the sound ended on its own → engine forgets it as the live voice
    engine.play('a')
    expect(first.stopped, 'an already-ended source is never stopped again').toBe(false)
    expect(created.sources[1].started, 'the next trigger still sounds').toBe(true)
  })
})
