// @arcade/shared — package root barrel.
//
// SH-1 (ADR-0001) lands ONLY the plumbing: this package's layout, its `exports`
// subpath map, and the `prepare` step that builds ESM + `.d.ts` via tsc — plus
// the single trivial export below, so the version-pinned git-URL dependency pipe
// can be proven end-to-end (a consumer game installs, imports, and both `vite
// build` and `vitest` pass) BEFORE any real code is extracted.
//
// The first genuine payloads arrive next and are added here as subpath exports,
// per the SH epic sequence:
//   - SH-2  ./math3d  — the ported Atari "Math Box"
//   - SH-3  ./rng     — the seeded mulberry32 PRNG
//   - later ./highscore, ./loop
//
// Eligibility bar (ADR-0001): only code byte/algorithm-identical across >=2
// games belongs here. Game-specific render pipelines, sim bodies, and input
// maps stay in their own repos.

/**
 * Version marker for the shared library.
 *
 * Kept in sync with `package.json`'s `version`; each consumer pins a matching
 * git tag (`github:slabgorb/arcade-shared#vX.Y.Z`), so a shared change can never
 * silently alter a frozen game's determinism/replay behaviour. This trivial,
 * side-effect-free export is what SH-1's consumer proof imports.
 */
export const SHARED_VERSION = '0.3.0'
