# Changelog

All notable changes to **@arcade/shared** — the shared library behind the arcade's
vector games.

Unlike the games, this package has no players: its audience is the game repos that
consume it. Entries are therefore written for developers, in terms of the subpath
exports they can import.

Consumed as a version-pinned git dependency:

```json
"@arcade/shared": "github:slabgorb/arcade-shared#v0.13.1"
```

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Eligibility bar, per ADR-0001: only code that is byte- or algorithm-identical across
**two or more** games belongs here.

> **Note on the version history.** `v0.11.0` and `v0.12.0` were cut outside the normal
> release flow — tagged on their feature-branch commits rather than on a release merge —
> so neither is reachable from `main`. Both contain the correct code and resolve correctly
> for consumers: every game pinning them installs a working build. `main` has since caught
> up through the normal flow and now reads `v0.13.1`.
>
> Two versions were never tagged at all. There is **no `v0.8.0`** — the pause /
> esc-overlay work intended for it shipped as `v0.9.0` — and **no `v0.13.0`**, whose
> cross-origin high-score work shipped as `v0.13.1`.

## [0.14.0] - 2026-07-13

### Added
- **`/synth` — the WebAudio SYNTHESIS engine skeleton.** A **sibling of `/audio`, not a
  replacement for it**: `/audio` plays SAMPLES (`.wav` buffers) and cannot host oscillator
  synthesis, which is why the two synthesis cabinets — battlezone and red-baron — could
  never adopt it and hand-wrote the same engine architecture twice. Both subpaths ship.

  `/synth` carries the VERB and nothing else: the lazy gesture gate, the vendor-prefixed
  `webkitAudioContext` fallback, a white-noise buffer, sustained-voice bookkeeping, and the
  no-throw contract. Every NUMBER — each cabinet's oscillators, filters, envelopes and ROM
  seams — stays in the game that owns it.

  `createSynthEngine<N extends string>(config?)` is generic over the cabinet's voice-name
  union, so `startVoice(name)` stays typed at the consumer.

- **`withAudio(effect)` — the no-throw contract as one primitive.** It fuses the two halves
  that must never be separated: it refuses a dead context AND swallows whatever Web Audio
  throws. Both are required. A browser may CLOSE the context out from under a game (iOS
  reclaiming audio, a long-backgrounded tab), after which every `createOscillator` /
  `createGain` / `createBufferSource` throws `InvalidStateError` synchronously — and the
  cabinets call these from inside `frame()`, ABOVE the `requestAnimationFrame` re-schedule,
  so an escaping exception freezes rendering and input rather than merely muting the game.
  Catching without refusing is not enough: you would still be building nodes into a corpse.
  Sound may die; the game never does.

- **Recovery from a closed context.** A closed context is discarded and the next user
  gesture builds a fresh one, so a browser audio reclaim no longer silences a cabinet for
  the rest of the session. The voice registry is cleared with it — a stale entry would make
  `startVoice` a permanent no-op.

- **`onRebuild(listener)`.** Fires when a new context is built (the first, and every
  replacement). **Any consumer holding a WebAudio node OUTSIDE the voice registry — a
  free-running hum oscillator, an approach whine, anything built once behind an
  `if (node === null)` gate — must register a reset here**, or that node keeps referencing
  the dead context and its build gate never re-fires: the sound dies permanently while the
  registry voices come back. A half recovery is worse than none, because it looks like it
  worked.

## [0.13.2] - 2026-07-12

No API changes. Documentation only.

## [0.13.1] - 2026-07-12

### Added
- **`/highscore` publishes each game's top score to the rest of the arcade.** Alongside
  the existing save, the table's maximum is written to a cookie scoped to the shared
  parent domain — which is how the lobby, on its own origin, can read a score that a game
  saved on its (ADR-0004). `load()` republishes as well, so the four already-shipped games
  self-heal with no code change of their own.

### Changed
- **`/highscore` is now a browser subpath, not a pure one.** The default cookie transport
  sits inside the factory the games already call, so its import closure can no longer be
  DOM-free. This was forced by the requirement, not chosen. `localStorage` stays
  authoritative and unmigrated, the transport is injectable, and a transport that throws
  never costs a player their score.

## [0.12.1] - 2026-07-12

### Added
- `/audio` reached `main` through the normal release flow. The subpath itself is unchanged
  from the `v0.12.0` feature-branch tag documented below.

## [0.12.0] - 2026-07-11

### Added
- **`/audio`** — shared WebAudio SFX engine. Adopted by tempest, asteroids and star-wars
  (star-wars keeps a separate context for speech).

## [0.11.0] - 2026-07-11

### Added
- **`/view`** — `resizeToDisplay` plus a pure letterbox calculation, so every cabinet
  scales and pillarboxes identically.

## [0.10.0] - 2026-07-10

### Added
- **`/glow`** — browser subpath exporting `withGlow` and `glowPolyline`, the arcade's
  common phosphor stroke.
- **`/name-entry`** — the shared keyboard initials-entry reducer, which retired the
  per-game auto-tagged high-score entries ("ACE", "AAA").

## [0.9.0] - 2026-07-10

### Added
- **`/pause`** and **`/esc-overlay`** — the shared pause state and its overlay, giving
  every game the same Esc behaviour.

> Cut as `v0.9.0`; the work was authored as `v0.8.0`, which was never tagged.

## [0.7.0] - 2026-07-09

### Added
- Extended the VGMSGA font with the glyphs the audit found missing: comma, slash
  and underscore.

## [0.6.0] - 2026-07-09

### Added
- **`/font`** — the authentic VGMSGA stroke-vector font, extracted from the Tempest ROM,
  as a pure subpath.
- A **purity guard** in the test suite: the font subpath must not reach for the DOM or
  any browser API.

## [0.5.0] - 2026-07-08

### Added
- **`/loop`** — the fixed-timestep accumulator, extracted so every game steps its
  simulation identically.

## [0.4.0] - 2026-07-07

### Added
- **`/highscore`** — the high-score table and its storage contract, shared between the
  games and the lobby (which reads each game's scores to show on its tile).

## [0.3.0] - 2026-07-07

### Added
- **`/rng`** — the seeded `mulberry32` PRNG, so every game's simulation stays
  deterministic and reproducible.

## [0.2.0] - 2026-07-06

### Added
- **`/math3d`** — the ported Atari **Math Box**, the 3D maths hardware behind Star Wars,
  Battlezone and Red Baron. Extracted here so the three games share one implementation
  instead of three copies.

## [0.1.0] - 2026-07-06

**Initial release.**

### Added
- Package scaffold: the exports map and a `prepare` build producing ESM plus type
  declarations, per ADR-0001.
