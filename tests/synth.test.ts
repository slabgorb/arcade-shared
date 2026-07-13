// tests/synth.test.ts
//
// Story SH2-18 (epic SH2) — RED phase (Imperator Furiosa / TEA).
// @arcade/shared/synth: the WebAudio SYNTHESIS engine skeleton. A BROWSER subpath
// (it touches AudioContext), sibling to — never a replacement for — /audio (SH2-16),
// which is a SAMPLE/.wav buffer player and cannot host oscillator synthesis.
//
// WHY this story exists: battlezone (bz1-11) and red-baron (rb2-11) hand-write the
// same engine ARCHITECTURE. (The story title says "byte-identical copies" — that is
// false; only ~13 lines literally match. See the session's Delivery Findings.) Red
// Baron's is the more evolved one and is the DONOR: it carries a no-throw contract
// battlezone does not have at all.
//
// ── THE CONTRACT Dev implements to turn this GREEN ───────────────────────────
//
//   interface SynthTarget { readonly context: AudioContext; readonly out: GainNode }
//   interface Voice       { readonly stop: () => void }
//   interface SynthConfig { masterGain?: number }          // default 0.8
//
//   interface SynthEngine<N extends string> {
//     resume(): void                                        // lazy gesture gate; idempotent
//     withAudio(effect: (target: SynthTarget) => void): void // live()+guard(), fused
//     startVoice(name: N, build: (t: SynthTarget) => Voice): void  // idempotent
//     stopVoice(name: N): void
//     isVoiceActive(name: N): boolean
//     ready(): boolean                                      // a LIVE (open) context exists
//   }
//   function createSynthEngine<N extends string>(config?: SynthConfig): SynthEngine<N>
//   function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer
//
// `withAudio` is the heart of the VERB. Every method in both cabinets is written
//   const l = live(); if (l === null) return; guard(() => …)
// so the shared engine fuses those two into ONE no-throw primitive: the effect runs
// only against a LIVE context, and anything it throws is swallowed.
//
// WHY THE NO-THROW CONTRACT IS LOAD-BEARING (not defensive dressing): a browser may
// CLOSE the context out from under the game (iOS reclaiming audio, a long-backgrounded
// tab). Every createOscillator/createGain/createBufferSource then throws
// InvalidStateError SYNCHRONOUSLY. Those calls run inside the games' frame() — ABOVE
// the requestAnimationFrame(frame) re-schedule — so an escaping exception does not
// merely mute the game, it FREEZES rendering and input. Sound may die; the game never does.
//
// The NUMBERS stay in the cabinets: every oscillator, filter, envelope and ROM seam
// (bz's engineParams/saucerVoice; rb's POKEY math/gunStrobe/explosionLevel) is out of
// scope here. This suite pins the MECHANISM only.
//
// Untyped by construction: arcade-shared's tests run in node with types stripped by
// esbuild, so the generic `<N extends string>` contract cannot be asserted at runtime.
// It is pinned as source text in synth-source-rules.test.ts and end-to-end by the
// consumers' tsc builds.
//
// RED until src/synth.ts exists and exports createSynthEngine + noiseBuffer.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Fake WebAudio surface ────────────────────────────────────────────────────
// The rb-grade fake (rb2-11, review round 1): close() really CLOSES, and a closed
// context throws synchronously from every factory method — the exact behaviour the
// contract exists to survive. A fake whose close() is cosmetic (battlezone's, today)
// literally cannot express the bug, which is why bz has zero coverage of this path.

class FakeAudioParam {
  readonly values: number[] = []
  private v = 0
  get value(): number {
    return this.v
  }
  set value(next: number) {
    this.v = next
    this.values.push(next)
  }
  setValueAtTime(v: number): this {
    this.value = v
    return this
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v
    return this
  }
  exponentialRampToValueAtTime(v: number): this {
    this.value = v
    return this
  }
}

class FakeNode {
  connectedTo: unknown = null
  disconnected = false
  connect<T>(target: T): T {
    this.connectedTo = target
    return target
  }
  disconnect(): void {
    this.disconnected = true
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeAudioParam()
}

class FakeOscillator extends FakeNode {
  type = 'sine'
  readonly frequency = new FakeAudioParam()
  start(): void {}
  stop(): void {}
}

class FakeBuffer {
  readonly data: Float32Array
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length)
  }
  getChannelData(): Float32Array {
    return this.data
  }
}

class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null
  loop = false
  start(): void {}
  stop(): void {}
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  /** Set to make createGain() throw — models a ctor that half-builds then fails. */
  static failCreateGain = false
  /** Set to make close() REJECT. A real close() returns a promise that can reject;
   *  discarding it with a bare `void` leaks an unhandled rejection (review round 1). */
  static rejectClose = false

  readonly gains: FakeGain[] = []
  readonly oscillators: FakeOscillator[] = []
  readonly sources: FakeBufferSource[] = []
  currentTime = 0
  sampleRate = 48_000
  state = 'running'
  readonly destination = new FakeNode()
  resumeCalls = 0
  closeCalls = 0

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  resume(): Promise<void> {
    this.resumeCalls++
    // A CLOSED context REJECTS. An engine that does a bare `void ctx.resume()`
    // leaks an unhandled rejection here — asserted against below.
    return this.state === 'closed'
      ? Promise.reject(new Error('InvalidStateError: context is closed'))
      : Promise.resolve()
  }

  close(): Promise<void> {
    this.closeCalls++
    this.state = 'closed'
    return FakeAudioContext.rejectClose
      ? Promise.reject(new Error('InvalidStateError: close failed'))
      : Promise.resolve()
  }

  /** A closed context throws SYNCHRONOUSLY from every factory. The real behaviour. */
  private assertOpen(): void {
    if (this.state === 'closed') throw new Error('InvalidStateError: context is closed')
  }

  createGain(): FakeGain {
    this.assertOpen()
    if (FakeAudioContext.failCreateGain) throw new Error('createGain failed')
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createOscillator(): FakeOscillator {
    this.assertOpen()
    const o = new FakeOscillator()
    this.oscillators.push(o)
    return o
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    this.assertOpen()
    return new FakeBuffer(channels, length, sampleRate)
  }
  createBufferSource(): FakeBufferSource {
    this.assertOpen()
    const s = new FakeBufferSource()
    this.sources.push(s)
    return s
  }
}

const contexts = () => FakeAudioContext.instances
const only = () => {
  const all = FakeAudioContext.instances
  expect(all.length, 'expected exactly one AudioContext to have been built').toBe(1)
  return all[0]
}

async function loadSynth() {
  return import('../src/synth')
}

/** Let queued microtasks (a rejected resume() promise) settle. */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.resetModules()
  FakeAudioContext.instances = []
  FakeAudioContext.failCreateGain = false
  FakeAudioContext.rejectClose = false
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('webkitAudioContext', FakeAudioContext)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-5 — the gesture gate
// ─────────────────────────────────────────────────────────────────────────────

describe('the gesture gate — no context before a user gesture (AC-5)', () => {
  it('importing the module constructs no AudioContext', async () => {
    await loadSynth()
    expect(contexts()).toHaveLength(0)
  })

  it('creating the engine constructs no AudioContext', async () => {
    const { createSynthEngine } = await loadSynth()
    createSynthEngine()
    // Browsers forbid an AudioContext before a gesture: construction must be LAZY,
    // deferred to resume(), or the browser hands back a permanently-suspended context.
    expect(contexts()).toHaveLength(0)
  })

  it('the first resume() constructs exactly one context', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    expect(contexts()).toHaveLength(1)
  })

  it('repeat resume() reuses the one context but keeps nudging it', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    synth.resume()
    synth.resume()
    // resume() is wired to EVERY gesture: it must build once...
    expect(contexts()).toHaveLength(1)
    // ...but still call through each time, because the browser can re-suspend a
    // context between gestures and only a resume() call revives it.
    expect(only().resumeCalls).toBeGreaterThanOrEqual(3)
  })

  it('ready() is false before the gate opens and true after', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    expect(synth.ready()).toBe(false)
    synth.resume()
    expect(synth.ready()).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The master gain — the one NUMBER the skeleton owns
// ─────────────────────────────────────────────────────────────────────────────

describe('the master gain', () => {
  it('resume() builds a master gain wired to the destination at the 0.8 default', async () => {
    const { createSynthEngine } = await loadSynth()
    createSynthEngine().resume()
    const ctx = only()
    expect(ctx.gains.length, 'a master GainNode must be built').toBeGreaterThanOrEqual(1)
    const master = ctx.gains[0]
    expect(master.gain.values).toContain(0.8)
    expect(master.connectedTo, 'the master gain must reach the destination').toBe(ctx.destination)
  })

  it('an explicit masterGain overrides the default', async () => {
    const { createSynthEngine } = await loadSynth()
    createSynthEngine({ masterGain: 0.25 }).resume()
    expect(only().gains[0].gain.values).toContain(0.25)
  })

  it('masterGain: 0 is HONOURED, not silently replaced by the default', async () => {
    // TS lang-review #4 (null/undefined): `config.masterGain || DEFAULT` is a BUG —
    // 0 is falsy but a perfectly valid gain (a muted cabinet). Only `??` is correct.
    // This test fails loudly against the `||` spelling and passes against `??`.
    const { createSynthEngine } = await loadSynth()
    createSynthEngine({ masterGain: 0 }).resume()
    const master = only().gains[0]
    expect(master.gain.values, 'masterGain 0 must reach the node, not become 0.8').toContain(0)
    expect(master.gain.values).not.toContain(0.8)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — withAudio: the live gate fused with the no-throw guard
// ─────────────────────────────────────────────────────────────────────────────

describe('withAudio — the live gate (AC-4)', () => {
  it('does not run the effect before the gate opens, and does not throw', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    const effect = vi.fn()
    expect(() => synth.withAudio(effect)).not.toThrow()
    expect(effect, 'no context yet — the effect must not run').not.toHaveBeenCalled()
  })

  it('runs the effect against the live context and the master gain once resumed', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    const effect = vi.fn()
    synth.withAudio(effect)
    expect(effect).toHaveBeenCalledTimes(1)
    const target = effect.mock.calls[0][0]
    expect(target.context, 'the target must carry the live context').toBe(only())
    expect(target.out, 'the target must carry the master gain to play into').toBe(only().gains[0])
  })

  it('swallows anything the effect throws — a dead sound never takes the frame down', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    // These run inside the games' frame() above the rAF re-schedule. An escaping
    // exception would freeze rendering and input, not merely the audio.
    expect(() =>
      synth.withAudio(() => {
        throw new Error('WebAudio blew up')
      }),
    ).not.toThrow()
  })

  it('keeps working after an effect throws — one bad cue does not poison the engine', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    synth.withAudio(() => {
      throw new Error('boom')
    })
    const after = vi.fn()
    synth.withAudio(after)
    expect(after, 'the engine must not latch into a broken state').toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — the no-throw contract: a CLOSED context degrades to silence
// ─────────────────────────────────────────────────────────────────────────────

describe('a CLOSED context is treated as ABSENT — it must never freeze the game (AC-4)', () => {
  it('withAudio stops running effects once the context is closed', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    await only().close() // iOS reclaims audio; a backgrounded tab is culled

    const effect = vi.fn()
    expect(() => synth.withAudio(effect)).not.toThrow()
    // The effect must not even be ATTEMPTED: every factory on a closed context throws
    // synchronously, so running it and catching would work by accident. The engine is
    // required to KNOW the context is dead (`live()` checks state === 'closed').
    expect(effect, 'a closed context must read as absent, not as live-and-throwing').not.toHaveBeenCalled()
  })

  it('ready() goes false once the context is closed', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    expect(synth.ready()).toBe(true)
    await only().close()
    expect(synth.ready(), 'a closed context is not ready — it is dead').toBe(false)
  })

  it('startVoice REFUSES a closed context — the builder is never even invoked', async () => {
    // THE test the first round was missing. `withAudio` had this covered; the voice
    // registry did not, and the gap was invisible because the old test passed a builder
    // that never touched the context and only asserted `.not.toThrow()`.
    //
    // Refusing a dead context and merely CATCHING its throw are different things, and the
    // difference IS this story: catching-without-refusing is exactly battlezone's old bug.
    // A spy is the only way to tell them apart — so spy.
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    await only().close()

    const build = vi.fn(() => ({ stop: () => {} }))
    expect(() => synth.startVoice('gun', build)).not.toThrow()
    expect(build, 'a dead context must be REFUSED, not built into and caught').not.toHaveBeenCalled()
    expect(synth.isVoiceActive('gun'), 'no voice can be running on a dead context').toBe(false)
  })

  it('stopVoice and isVoiceActive stay honest on a closed context', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    synth.startVoice('gun', () => ({ stop: () => {} }))
    expect(synth.isVoiceActive('gun')).toBe(true)

    await only().close()

    // The nodes behind that voice no longer exist. Reporting it as still running is a
    // lie, and a lie that MATTERS: a stale entry makes a later startVoice a silent no-op.
    expect(synth.isVoiceActive('gun'), 'a voice cannot be live on a dead context').toBe(false)
    expect(() => synth.stopVoice('gun')).not.toThrow()
  })

  it('the rest of the surface may be hammered on a closed context without throwing', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    await only().close()

    // NOTE: resume() is deliberately NOT in this list — it now RECOVERS (see below), so
    // calling it here would revive the context and the rest would no longer be hammering
    // a corpse, which is the whole point of the test.
    expect(() => {
      synth.withAudio(() => {})
      synth.startVoice('gun', () => ({ stop: () => {} }))
      synth.stopVoice('gun')
      synth.isVoiceActive('gun')
      synth.ready()
    }, 'the whole surface must degrade to silence, never to an exception').not.toThrow()
  })

  it('resume() does not leak an unhandled rejection when the context rejects', async () => {
    // The real AudioContext.resume() REJECTS on a closed context (and can reject on a
    // context the browser is tearing down). A bare `void ctx.resume()` — battlezone's old
    // spelling — surfaces that as an unhandled rejection; only `.catch()` contains it.
    const rejections: unknown[] = []
    const onUnhandled = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const { createSynthEngine } = await loadSynth()
      const synth = createSynthEngine()
      synth.resume()
      // Close it WITHOUT going through the engine, then drive resume() again. Whether the
      // engine rebuilds or nudges, no rejection may escape.
      await only().close()
      synth.resume()
      synth.resume()
      await settle()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(rejections, 'resume() must .catch() any rejection from the context').toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The RECOVERY contract — decided in review round 1, previously unspecified
// ─────────────────────────────────────────────────────────────────────────────
//
// A browser that closes the context under memory pressure (iOS reclaiming audio, a
// long-backgrounded tab) used to leave the cabinet silent FOREVER: `resume()` guards on
// `ctx === null`, and a closed context is not null, so it never rebuilt — it just nudged
// a corpse. The player keeps generating gestures and never gets sound back.
//
// resume() is already wired to every gesture, so it is exactly the right place to heal.
// The contract is now: a closed context is DISCARDED and the next gesture builds a fresh
// one. The registry must be cleared with it — its voices point at nodes that no longer
// exist, and a stale entry would make startVoice a permanent no-op.

describe('a closed context RECOVERS on the next gesture (review round 1)', () => {
  it('the next resume() builds a FRESH context instead of nudging the corpse', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    expect(contexts()).toHaveLength(1)

    await contexts()[0].close() // the browser reclaims audio
    expect(synth.ready()).toBe(false)

    synth.resume() // the player touches the controls again
    expect(contexts(), 'a dead context must be replaced, not nudged forever').toHaveLength(2)
    expect(synth.ready(), 'sound must come back').toBe(true)
  })

  it('effects play into the NEW context after recovery', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    await contexts()[0].close()
    synth.resume()

    const effect = vi.fn()
    synth.withAudio(effect)
    expect(effect).toHaveBeenCalledTimes(1)
    expect(effect.mock.calls[0][0].context, 'must play into the LIVE context').toBe(contexts()[1])
  })

  it('the voice registry is CLEARED on recovery, so voices can actually restart', async () => {
    // The trap in the obvious one-line fix: rebuild the context but leave `voices` alone,
    // and startVoice sees the (dead) voice as already running and no-ops forever. The gun
    // would never fire again — a silent failure worse than the one being fixed.
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    synth.startVoice('gun', () => ({ stop: () => {} }))

    await contexts()[0].close()
    synth.resume()

    const build = vi.fn(() => ({ stop: () => {} }))
    synth.startVoice('gun', build)
    expect(build, 'a stale registry entry must not block the voice from restarting').toHaveBeenCalledTimes(1)
    expect(synth.isVoiceActive('gun')).toBe(true)
  })

  it('onRebuild fires so a cabinet can drop its OWN stale node references', async () => {
    // Review round 2 caught the hole in round 1's recovery: clearing the shared registry
    // is not enough. Each cabinet ALSO holds free-running nodes outside it — battlezone's
    // engine hum, red-baron's hum and approach whine — kept in local `let humOsc` slots
    // and built once behind an `if (humOsc === null)` gate.
    //
    // After a recovery those refs are still non-null, pointing at nodes on the DEAD
    // context, so the build gate never re-fires and the hum is silent for the rest of the
    // session — while gun/saucer/track come back. A HALF recovery, which is nastier than
    // none: it looks like it works.
    //
    // The engine therefore has to TELL the cabinet its context changed.
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    const onRebuild = vi.fn()
    synth.onRebuild(onRebuild)

    synth.resume()
    expect(onRebuild, 'fires for the first context too').toHaveBeenCalledTimes(1)

    await contexts()[0].close()
    synth.resume()
    expect(onRebuild, 'and again for the replacement — that is the whole point').toHaveBeenCalledTimes(2)
  })

  it('onRebuild does NOT fire when an existing context is merely nudged', async () => {
    // A repeat gesture on a live (or suspended) context is not a rebuild. Firing here
    // would make cabinets tear down and rebuild their hum on every keypress.
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    const onRebuild = vi.fn()
    synth.onRebuild(onRebuild)

    synth.resume()
    synth.resume()
    synth.resume()
    expect(onRebuild).toHaveBeenCalledTimes(1)
  })

  it('a throwing onRebuild listener cannot take down resume()', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.onRebuild(() => {
      throw new Error('a cabinet handler blew up')
    })
    const good = vi.fn()
    synth.onRebuild(good)

    expect(() => synth.resume()).not.toThrow()
    expect(good, 'one bad listener must not starve the others').toHaveBeenCalledTimes(1)
    expect(synth.ready()).toBe(true)
  })

  it('a context closed mid-life does not resurrect itself without a gesture', async () => {
    // Recovery is gesture-driven, not spontaneous: until resume() fires, the engine stays
    // silent. (Autoplay policy — we may not build a context on our own initiative.)
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    await contexts()[0].close()

    synth.withAudio(() => {})
    synth.startVoice('gun', () => ({ stop: () => {} }))
    expect(contexts(), 'no context may be built without a gesture').toHaveLength(1)
    expect(synth.ready()).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — degrade when WebAudio is absent or the constructor fails
// ─────────────────────────────────────────────────────────────────────────────

describe('no WebAudio at all — the game runs silent forever (AC-4)', () => {
  it('constructs no context, never throws, and stays un-ready', async () => {
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    const build = vi.fn(() => ({ stop: () => {} }))
    const effect = vi.fn()

    expect(() => {
      synth.resume()
      synth.withAudio(effect)
      synth.startVoice('hum', build)
      synth.stopVoice('hum')
    }, 'a browser without WebAudio must play no sound and break nothing').not.toThrow()

    expect(contexts()).toHaveLength(0)
    expect(synth.ready()).toBe(false)
    expect(effect).not.toHaveBeenCalled()
    expect(build).not.toHaveBeenCalled()
    expect(synth.isVoiceActive('hum')).toBe(false)
  })

  it('falls back to the vendor-prefixed webkitAudioContext when AudioContext is absent', async () => {
    // Safari's historical prefix, structurally identical.
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', FakeAudioContext)
    const { createSynthEngine } = await loadSynth()
    createSynthEngine().resume()
    expect(contexts(), 'the webkit fallback must be used, not ignored').toHaveLength(1)
  })
})

describe('a failing AudioContext constructor degrades to silence', () => {
  it('a throwing constructor leaves the engine inert and does not throw', async () => {
    class ExplodingContext {
      constructor() {
        throw new Error('autoplay blocked')
      }
    }
    vi.stubGlobal('AudioContext', ExplodingContext)
    vi.stubGlobal('webkitAudioContext', ExplodingContext)
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    expect(() => synth.resume()).not.toThrow()
    expect(synth.ready()).toBe(false)
  })

  it('CLOSES a half-built context rather than orphaning it', async () => {
    // resume() is wired to EVERY gesture. If the context constructs but the master
    // gain fails, abandoning it leaks a live AudioContext PER KEYSTROKE until the
    // browser's hard cap starts rejecting new ones.
    FakeAudioContext.failCreateGain = true
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    expect(() => synth.resume()).not.toThrow()

    expect(contexts(), 'the context was constructed before createGain failed').toHaveLength(1)
    expect(contexts()[0].closeCalls, 'the half-built context must be closed, not leaked').toBe(1)
    expect(synth.ready()).toBe(false)
  })

  it('a REJECTING close() on the half-built context leaks no unhandled rejection', async () => {
    // `close()` returns a promise. `try { void building.close() } catch {}` catches only a
    // SYNCHRONOUS throw — an async rejection sails straight past it. That is the identical
    // bug this file fixes for `ctx.resume()` a few lines below, and it was left unfixed
    // here (found in review round 1). Same class, same file, same function.
    FakeAudioContext.failCreateGain = true // force the half-built-context cleanup path
    FakeAudioContext.rejectClose = true // ...and make the cleanup itself reject

    const rejections: unknown[] = []
    const onUnhandled = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const { createSynthEngine } = await loadSynth()
      const synth = createSynthEngine()
      expect(() => synth.resume()).not.toThrow()
      await settle()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(rejections, 'building.close() must .catch() its rejection, like resume() does').toEqual(
      [],
    )
  })

  it('does not leak a NEW context on every gesture after a persistent failure', async () => {
    FakeAudioContext.failCreateGain = true
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    synth.resume()
    synth.resume()
    // Each attempt may re-try, but every context it opens must also be closed —
    // none may be left running.
    const leaked = contexts().filter((c) => c.state !== 'closed')
    expect(leaked, 'no half-built context may be left open').toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-6 — voice bookkeeping
// ─────────────────────────────────────────────────────────────────────────────

describe('voice bookkeeping — idempotent start/stop, no node leaks (AC-6)', () => {
  it('startVoice builds the voice once and marks it active', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    const build = vi.fn(() => ({ stop: () => {} }))

    synth.startVoice('gun', build)
    expect(build).toHaveBeenCalledTimes(1)
    expect(synth.isVoiceActive('gun')).toBe(true)
    // The builder is handed the live target so the cabinet can wire its own NUMBERS.
    const target = build.mock.calls[0][0]
    expect(target.context).toBe(only())
    expect(target.out).toBe(only().gains[0])
  })

  it('a repeat startVoice does NOT build a second voice', async () => {
    // The rat-a-tat is re-triggered every frame the trigger is held. Building a
    // second voice per frame stacks oscillators until the cabinet chokes.
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    const build = vi.fn(() => ({ stop: () => {} }))

    synth.startVoice('gun', build)
    synth.startVoice('gun', build)
    synth.startVoice('gun', build)
    expect(build, 'an already-running voice must not be rebuilt').toHaveBeenCalledTimes(1)
  })

  it('stopVoice stops the running voice and clears the slot', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    const stop = vi.fn()

    synth.startVoice('gun', () => ({ stop }))
    synth.stopVoice('gun')
    expect(stop).toHaveBeenCalledTimes(1)
    expect(synth.isVoiceActive('gun')).toBe(false)
  })

  it('a stopped voice can be started again', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    const build = vi.fn(() => ({ stop: () => {} }))

    synth.startVoice('gun', build)
    synth.stopVoice('gun')
    synth.startVoice('gun', build)
    expect(build, 'the trigger is released and pulled again — it must rattle again').toHaveBeenCalledTimes(2)
    expect(synth.isVoiceActive('gun')).toBe(true)
  })

  it('stopVoice on a voice that never started is a harmless no-op', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    expect(() => synth.stopVoice('never-started')).not.toThrow()
    expect(synth.isVoiceActive('never-started')).toBe(false)
  })

  it('voices are tracked independently by name', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    const gunStop = vi.fn()
    const humStop = vi.fn()

    synth.startVoice('gun', () => ({ stop: gunStop }))
    synth.startVoice('hum', () => ({ stop: humStop }))
    synth.stopVoice('gun')

    expect(gunStop).toHaveBeenCalledTimes(1)
    expect(humStop, 'stopping the gun must not silence the engine hum').not.toHaveBeenCalled()
    expect(synth.isVoiceActive('gun')).toBe(false)
    expect(synth.isVoiceActive('hum')).toBe(true)
  })

  it('a builder that throws is guarded, and leaves NO half-registered voice', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()

    expect(() =>
      synth.startVoice('gun', () => {
        throw new Error('createOscillator failed')
      }),
    ).not.toThrow()
    // A voice that failed to build is not running, so it must not be marked active —
    // otherwise the slot is wedged and the cabinet can never start the real one.
    expect(synth.isVoiceActive('gun'), 'a failed build must not occupy the slot').toBe(false)

    const build = vi.fn(() => ({ stop: () => {} }))
    synth.startVoice('gun', build)
    expect(build, 'the slot must still be usable after a failed build').toHaveBeenCalledTimes(1)
  })

  it('a voice whose stop() throws is guarded, and the slot is still cleared', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    synth.resume()
    synth.startVoice('gun', () => ({
      stop: () => {
        throw new Error('already stopped')
      },
    }))

    expect(() => synth.stopVoice('gun')).not.toThrow()
    // If a throwing stop() left the slot occupied, the voice could never be restarted —
    // the gun would go permanently silent after one WebAudio hiccup.
    expect(synth.isVoiceActive('gun'), 'a throwing stop() must still free the slot').toBe(false)
  })

  it('startVoice before the gesture gate opens does not build anything', async () => {
    const { createSynthEngine } = await loadSynth()
    const synth = createSynthEngine()
    const build = vi.fn(() => ({ stop: () => {} }))
    expect(() => synth.startVoice('gun', build)).not.toThrow()
    expect(build).not.toHaveBeenCalled()
    expect(synth.isVoiceActive('gun')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// noiseBuffer — the raw material of every analog one-shot
// ─────────────────────────────────────────────────────────────────────────────

describe('noiseBuffer — white noise, the raw material of the one-shots', () => {
  it('builds a one-channel buffer of sampleRate x seconds frames', async () => {
    const { noiseBuffer } = await loadSynth()
    const ctx = new FakeAudioContext()
    const buffer = noiseBuffer(ctx, 0.5)
    expect(buffer.numberOfChannels).toBe(1)
    expect(buffer.length).toBe(Math.floor(48_000 * 0.5))
    expect(buffer.sampleRate).toBe(48_000)
  })

  it('fills the buffer with noise spanning both polarities in [-1, 1]', async () => {
    const { noiseBuffer } = await loadSynth()
    const ctx = new FakeAudioContext()
    const data = noiseBuffer(ctx, 0.1).getChannelData()

    expect(data.length).toBeGreaterThan(0)
    // Every sample in range...
    expect([...data].every((v) => v >= -1 && v <= 1), 'samples must stay within [-1, 1]').toBe(true)
    // ...and it is actually NOISE, not a buffer of silence. A zero-filled buffer
    // would satisfy the range check above while making every one-shot inaudible.
    expect([...data].some((v) => v > 0), 'noise must have positive samples').toBe(true)
    expect([...data].some((v) => v < 0), 'noise must have negative samples').toBe(true)
  })

  it('never builds a zero-length buffer, however short the request', async () => {
    // A 0-frame buffer throws in a real AudioContext (NotSupportedError).
    const { noiseBuffer } = await loadSynth()
    const ctx = new FakeAudioContext()
    expect(noiseBuffer(ctx, 0).length).toBeGreaterThanOrEqual(1)
    expect(noiseBuffer(ctx, 0.0000001).length).toBeGreaterThanOrEqual(1)
  })
})
