# Changelog

All notable changes to **@arcade/shared** — the shared library behind the arcade's
vector games.

Unlike the games, this package has no players: its audience is the game repos that
consume it. Entries are therefore written for developers, in terms of the subpath
exports they can import.

Consumed as a version-pinned git dependency:

```json
"@arcade/shared": "github:slabgorb/arcade-shared#v0.12.0"
```

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Eligibility bar, per ADR-0001: only code that is byte- or algorithm-identical across
**two or more** games belongs here.

> **Note on the version history.** Two tags were cut outside the normal release flow:
> `v0.11.0` and `v0.12.0` are tagged on their feature-branch commits rather than on a
> release merge, so they are not reachable from `main` (which still reads `v0.10.0`).
> Both tags contain the correct code and resolve correctly for consumers — every game
> pinning them installs working builds — but `main` does not yet reflect them. There is
> also **no `v0.8.0`**: the pause / esc-overlay work intended for it shipped as `v0.9.0`.

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
