// src/synth.ts
//
// SH2-18 (epic SH2) — @arcade/shared/synth, the shared shell-side WebAudio SYNTHESIS
// engine skeleton. A BROWSER subpath (it touches `AudioContext`, a browser global), so
// it is fenced from the pure core by the purity guard like glow/view/audio — never
// added to PURE_SUBPATHS.
//
// SIBLING OF /audio, NOT A REPLACEMENT. `@arcade/shared/audio` (SH2-16) is a SAMPLE
// player: it fetches and decodes `.wav` buffers. It cannot host oscillator synthesis,
// which is why the two synthesis cabinets — battlezone (bz1-11) and red-baron (rb2-11)
// — could never adopt it and hand-wrote this engine instead. Both subpaths ship.
//
// This is the VERB those two cabinets duplicate: the lazy gesture gate, the no-throw
// contract, the vendor-prefix fallback, the white-noise buffer, and voice bookkeeping.
// The NUMBERS stay home — every oscillator, filter, envelope and ROM seam belongs to
// the cabinet that owns it, and none of them appear in this file.
//
// ── THE NO-THROW CONTRACT (load-bearing — do not "simplify" it away) ─────────
//
// Browsers forbid an AudioContext before a user gesture, so the context is built
// LAZILY inside `resume()`. But the gate alone is not enough: a browser may CLOSE the
// context out from under the game (iOS reclaiming audio under memory pressure, a
// long-backgrounded tab), and every `createOscillator`/`createGain`/`createBufferSource`
// call then throws `InvalidStateError` SYNCHRONOUSLY. The cabinets call these from
// inside their frame() — ABOVE the `requestAnimationFrame(frame)` re-schedule — so an
// escaping exception would not merely mute the game, it would FREEZE rendering and
// input. Sound may die; the game never does.
//
// So the contract has two halves, and BOTH are required:
//   (a) refuse a dead context — a CLOSED context is treated as ABSENT, not as live
//   (b) swallow whatever the Web Audio layer throws anyway
// Catching without refusing is not enough: you would still build nodes into a corpse.
// `withAudio()` fuses the two so a caller cannot take one without the other.

/** The live rig a cabinet plays into: the context, and the master bus to connect to. */
export interface SynthTarget {
  readonly context: AudioContext
  readonly out: GainNode
}

/** A running sustained voice: everything to tear down when it is silenced. */
export interface Voice {
  readonly stop: () => void
}

/** The skeleton's only knob. Everything else a cabinet tunes for itself. */
export interface SynthConfig {
  /** Master mix headroom, 0..1, so overlapping cues never clip. Default 0.8. */
  masterGain?: number
}

/**
 * Generic over the cabinet's voice-name union `N` (battlezone's 'saucer' | 'track',
 * red-baron's 'gun'), so `startVoice(name)` stays typed at the consumer instead of
 * collapsing to bare `string`.
 */
export interface SynthEngine<N extends string> {
  /** Build (once) and unlock the context. Idempotent — wire it to any gesture. */
  resume(): void
  /**
   * Run a Web Audio side effect against the LIVE rig. The effect does not run at all
   * when there is no context, or when the context is closed; and anything it throws is
   * swallowed. This is the whole no-throw contract in one call.
   */
  withAudio(effect: (target: SynthTarget) => void): void
  /**
   * Start a sustained voice under `name`, building it with `build`. Idempotent: a
   * repeat start on an already-running voice does NOT build a second one (the cabinets
   * re-trigger these every frame a control is held).
   */
  startVoice(name: N, build: (target: SynthTarget) => Voice): void
  /** Stop the voice running under `name`. Harmless when nothing is running there. */
  stopVoice(name: N): void
  /** True while a voice is running under `name`. */
  isVoiceActive(name: N): boolean
  /** True once there is a LIVE (open) context to play into. */
  ready(): boolean
}

/** Master mix headroom — the one number both cabinets happened to agree on. */
const DEFAULT_MASTER_GAIN = 0.8

/** Safari's historical vendor-prefixed constructor, structurally identical. */
function resolveContextCtor(): (new () => AudioContext) | null {
  if (typeof AudioContext !== 'undefined') return AudioContext
  const g = globalThis as typeof globalThis & { webkitAudioContext?: new () => AudioContext }
  return g.webkitAudioContext ?? null
}

/**
 * A buffer of white noise — the raw material of every analog one-shot. Exported
 * because both cabinets build their bursts from it; what they do with it afterwards
 * (the filter, the envelope) is theirs, not ours.
 *
 * Never returns a zero-frame buffer: a real AudioContext throws NotSupportedError.
 */
export function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds))
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

export function createSynthEngine<N extends string>(config?: SynthConfig): SynthEngine<N> {
  // ALL context state lives behind the gesture gate — nothing is constructed at module
  // load or at engine creation (browser autoplay policy).
  let ctx: AudioContext | null = null
  let master: GainNode | null = null

  const voices = new Map<N, Voice>()

  // `??`, never `||`: 0 is a perfectly valid gain (a deliberately muted cabinet) and is
  // falsy, so `||` would silently overwrite it with the default.
  const masterGain = config?.masterGain ?? DEFAULT_MASTER_GAIN

  /**
   * The live rig, or null when there is nothing to play into. A CLOSED context counts
   * as ABSENT: its factory methods throw synchronously, so building into one is not a
   * degraded sound, it is an exception in the frame loop.
   */
  function live(): SynthTarget | null {
    if (ctx === null || master === null) return null
    if (ctx.state === 'closed') return null
    return { context: ctx, out: master }
  }

  /** Run a Web Audio side effect, swallowing anything it throws. */
  function guard(effect: () => void): void {
    try {
      effect()
    } catch {
      /* a dead sound must never take the frame loop down with it */
    }
  }

  function resume(): void {
    if (ctx === null) {
      const Ctor = resolveContextCtor()
      if (Ctor === null) return // no Web Audio: the game runs silent, forever
      let building: AudioContext | null = null
      try {
        building = new Ctor()
        const gain = building.createGain()
        gain.gain.setValueAtTime(masterGain, building.currentTime)
        gain.connect(building.destination)
        ctx = building
        master = gain
      } catch {
        // Close the half-built context rather than orphaning it: resume() is wired to
        // EVERY gesture, so a persistent fault would otherwise leak a live AudioContext
        // per keystroke until the browser's cap starts rejecting new ones.
        if (building !== null) {
          try {
            void building.close()
          } catch {
            /* nothing left to do */
          }
        }
        ctx = null
        master = null
        return
      }
    }
    // Repeat gestures land here: nudge a context the browser left suspended. resume()
    // REJECTS on a closed context — swallow it rather than let it surface as an
    // unhandled rejection.
    void ctx.resume().catch(() => {
      /* a closed context simply stays silent */
    })
  }

  function withAudio(effect: (target: SynthTarget) => void): void {
    const target = live()
    if (target === null) return
    guard(() => effect(target))
  }

  function startVoice(name: N, build: (target: SynthTarget) => Voice): void {
    const target = live()
    if (target === null) return
    if (voices.has(name)) return // already running — a repeat start is a no-op
    guard(() => {
      // Registered only on success: a voice that threw while building is not running,
      // so it must not occupy the slot — otherwise the cabinet could never start the
      // real one.
      voices.set(name, build(target))
    })
  }

  function stopVoice(name: N): void {
    const voice = voices.get(name)
    if (voice === undefined) return // never started — harmless
    // Freed BEFORE the teardown runs: if stop() throws, the slot must still be released,
    // or one Web Audio hiccup would silence that voice permanently.
    voices.delete(name)
    guard(() => voice.stop())
  }

  function isVoiceActive(name: N): boolean {
    return voices.has(name)
  }

  function ready(): boolean {
    return live() !== null
  }

  return { resume, withAudio, startVoice, stopVoice, isVoiceActive, ready }
}
