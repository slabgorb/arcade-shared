# arcade-shared

Shared library for the [slabgorb](https://github.com/slabgorb) browser vector-arcade
games. Published as the scoped npm package **`@arcade/shared`** and consumed by each game
(and the lobby) as a **version-pinned git-URL dependency** — not copied.

> **Why this repo exists:** established by **ADR-0001** in the arcade orchestrator
> (`docs/adr/0001-shared-code-strategy.md`). After five vector games, code that is
> byte/algorithm-identical across ≥2 games (the Atari "Math Box", the seeded RNG, the
> high-score contract) had been hand-ported with `port, don't share` headers. This repo
> is the shared home those comments were waiting for.

## Consumption

Each consumer declares a **pinned** dependency, so a shared change can never silently
alter a frozen game's determinism/replay behavior:

```jsonc
// <game>/package.json
"dependencies": {
  "@arcade/shared": "github:slabgorb/arcade-shared#vX.Y.Z"
}
```

Ships built ESM + `.d.ts` (via a `prepare` step) so each game's Vite build consumes it as
an ordinary dependency. Import via subpath exports:

```ts
import { /* … */ } from '@arcade/shared/math3d'
import { /* … */ } from '@arcade/shared/rng'
import { /* … */ } from '@arcade/shared/highscore'
```

**Dev inner loop:** during active co-development, point a consumer at a `#branch` ref or
use `npm link` locally; bump to a tag when stabilizing.

## Eligibility bar

Only code that is **byte/algorithm-identical across ≥2 games** belongs here. Game-specific
render pipelines, sim bodies, and input maps stay in their own repos.

## Status

Scaffold pending — package layout, `exports` map, and the `prepare` build land in story
**SH-1**. Extraction sequence (per the `SH` epic): math3d → rng → highscore/storage → loop.

## Provenance

- Branch strategy: gitflow. Default branch `develop`; PRs target `develop`; `main` holds
  tagged releases that consumers pin to.
- Governed by the arcade orchestrator's `SH` epic and ADR-0001.
