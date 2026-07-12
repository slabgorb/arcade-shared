// src/audio.ts
//
// SH2-16 (epic SH2) — @arcade/shared/audio, the shared shell-side WebAudio SFX
// engine. A BROWSER subpath (it touches `AudioContext`, a browser global), so it is
// fenced from the pure core by the purity guard like glow/view/esc-overlay — never
// added to PURE_SUBPATHS.
//
// This is the VERB four cabinets hand-write today (tempest is the reference impl):
// lazy-context-on-gesture, silent-degrade at every failure path, a master GainNode,
// buffer loading/decoding, and POKEY-style channel voice-stealing. The NUMBERS —
// the per-cabinet SOUNDS manifest, CHANNELS map, baseUrl, masterGain — pass in as
// config and stay in each game (design: share the VERB, not the NUMBERS).
//
// Generic over the game's sound-name union `N`, so `play(name)` stays typed at the
// consumer. arcade-shared's own tests are untyped (esbuild strips types), so the
// generic is validated at the consumer — tempest's `tsc` build (SH2-16 AC-5).
//
// Buffers are keyed by FILENAME (not logical name): a manifest mapping several names
// to one `.wav` fetches/decodes that file ONCE and both names resolve to it
// (design §4.1 — the asteroids N:1 case, absorbed as a superset rather than a mode).

export interface AudioEngine<N extends string> {
  // Create/resume the AudioContext and start loading samples. Safe to call
  // repeatedly (e.g. on every user gesture); only the first call does work. A no-op
  // until called, and forever if WebAudio is absent.
  resume(): void
  // Play a loaded sample once. Steals its channel. No-op if the sound is not loaded,
  // the context is not ready, or audio is unavailable.
  play(name: N): void
  // Start a sustained (looping) sample on its channel. Steals the channel like
  // play(), so only one loop rings per channel. Same silent no-ops when unavailable.
  startLoop(name: N): void
  // Stop the sustained sample sounding on `name`'s channel. A safe no-op when
  // nothing is looping there.
  stopLoop(name: N): void
  // True once at least one sample has decoded. Mainly for tests / readiness UI.
  ready(): boolean
}

export interface AudioManifest<N extends string> {
  // Where the `.wav` samples are hosted (each sound's filename is appended).
  baseUrl: string
  // Master volume, 0..1. Headroom so overlapping SFX don't clip. Default 0.4.
  masterGain?: number
  // Logical name -> filename (per-cabinet NUMBERS). Multiple names may map to one
  // file — that file is fetched/decoded once (buffers are keyed by filename).
  sounds: Record<N, string>
  // Logical name -> logical channel (per-cabinet NUMBERS). A new sound on an
  // occupied channel steals (stops) whatever was sounding there.
  channels: Record<N, string>
}

// Resolve the AudioContext constructor, covering the legacy `webkitAudioContext`
// prefix (older Safari/iOS) and non-browser environments. Read off `globalThis`
// with an explicit shape — `AudioContext` is a global ambient, not a member of the
// `Window` interface, so a bare `window.AudioContext` access won't typecheck.
function getAudioContextCtor(): typeof AudioContext | undefined {
  const g = globalThis as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  return g.AudioContext ?? g.webkitAudioContext
}

const DEFAULT_MASTER_GAIN = 0.4

export function createAudioEngine<N extends string>(manifest: AudioManifest<N>): AudioEngine<N> {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let loadStarted = false
  // Keyed by FILENAME so several logical names sharing one `.wav` decode once.
  const buffers = new Map<string, AudioBuffer>()
  // The source currently sounding on each logical channel, so the next trigger on
  // that channel can steal (stop) it. Cleared by `onended` when a source finishes on
  // its own, so a later trigger never tries to stop a node that already ended.
  const live = new Map<string, AudioBufferSourceNode>()

  // Fetch + decode every DISTINCT sample file once. A failure on any one file
  // (network, CORS, undecodable) is swallowed — that sound simply never plays.
  function load(): void {
    if (loadStarted || !ctx) return
    loadStarted = true
    const context = ctx
    const files = new Set<string>(Object.values<string>(manifest.sounds))
    for (const file of files) {
      fetch(manifest.baseUrl + file)
        .then((res) => res.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => {
          buffers.set(file, buffer)
        })
        .catch(() => {
          /* one missing sound is non-fatal — leave it unloaded, stay silent */
        })
    }
  }

  function resume(): void {
    if (!ctx) {
      const Ctor = getAudioContextCtor()
      if (!Ctor) return // no WebAudio — engine stays inert
      try {
        ctx = new Ctor()
        master = ctx.createGain()
        master.gain.value = manifest.masterGain ?? DEFAULT_MASTER_GAIN
        master.connect(ctx.destination)
      } catch {
        // A blocked-autoplay context (or any ctor failure) leaves the game silent.
        ctx = null
        master = null
        return
      }
    }
    // The context can start 'suspended' until a gesture unlocks it.
    if (ctx.state === 'suspended') void ctx.resume()
    load()
  }

  // Steal a channel: stop whatever is sounding on it so a new trigger cuts in. Its
  // own guard, separate from starting any replacement — a prior source that already
  // ended would throw on stop(), and that must NOT abort the cut-in.
  function stopChannel(channel: string): void {
    const prev = live.get(channel)
    if (!prev) return
    live.delete(channel)
    try {
      prev.stop()
      prev.disconnect()
    } catch {
      /* prior source may have already ended — ignore */
    }
  }

  // Start a buffer source on `name`'s channel, optionally looping. Shared by the
  // one-shot play() and the sustained startLoop() — the only difference is
  // `source.loop`. Steals the channel first so retriggers cut in instead of
  // stacking; silently no-ops when unavailable or unloaded.
  function startSource(name: N, loop: boolean): void {
    if (!ctx || !master) return
    const buffer = buffers.get(manifest.sounds[name])
    if (!buffer) return // not loaded (yet) or failed to decode — silent no-op
    const channel = manifest.channels[name]
    const destination = master
    stopChannel(channel)
    try {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = loop
      source.connect(destination)
      // Forget a source once it finishes so it isn't left as the channel's "live"
      // voice; otherwise the next trigger would stop an already-ended node. (A
      // looping source never fires onended on its own — stopLoop ends it.)
      source.onended = () => {
        if (live.get(channel) === source) live.delete(channel)
      }
      source.start()
      live.set(channel, source)
    } catch {
      /* never let a single sound failure crash the frame */
    }
  }

  function play(name: N): void {
    startSource(name, false)
  }

  function startLoop(name: N): void {
    startSource(name, true)
  }

  function stopLoop(name: N): void {
    stopChannel(manifest.channels[name])
  }

  function ready(): boolean {
    return buffers.size > 0
  }

  return { resume, play, startLoop, stopLoop, ready }
}
