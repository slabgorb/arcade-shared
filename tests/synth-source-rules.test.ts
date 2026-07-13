// tests/synth-source-rules.test.ts
//
// SH2-18 — rule-enforcement tests (TS lang-review checklist) for the `synth` browser
// subpath, mirroring audio-source-rules / glow-source-rules. arcade-shared is untyped
// (esbuild strips types), so these scan src/synth.ts as TEXT via node:fs. The generic
// `<N extends string>` contract CANNOT be asserted at runtime — types are erased — so
// it is pinned here at the source level and, end-to-end, by the consumers' tsc builds.
//
//   • Generic contract — createSynthEngine / SynthEngine are generic over a
//     `<... extends string>` voice-name param, so startVoice(name) stays typed at the
//     cabinet (battlezone's 'saucer' | 'track', red-baron's 'gun') instead of
//     collapsing to bare `string`.
//   • VERB/NUMBERS fence — the skeleton must carry NO cabinet tuning. Not one ROM
//     seam, POKEY constant or oscillator frequency may cross into the shared package.
//   • #1 Type-safety escapes — no `as any`, `as unknown as`, `@ts-ignore`.
//   • #2 Generic/interface — no `Function` type, no `Record<string, any>`.
//   • #5 Module resolution — every RELATIVE import carries an explicit `.js` extension.
//   • #11 Error handling — no `catch (e: any)`; the guard swallows via bare `catch {}`.
//
// These FAIL until Dev creates src/synth.ts (RED), and stay green only while the
// source keeps the generic + type discipline AND the NUMBERS stay out.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const synthSrcPath = fileURLToPath(new URL('../src/synth.ts', import.meta.url))

function readSynthSource(): string {
  // Missing file must FAIL (not skip) — this is the RED driver + Dev's obligation.
  expect(
    existsSync(synthSrcPath),
    'src/synth.ts must exist — Dev builds the shared synthesis skeleton here (SH2-18 AC-1)',
  ).toBe(true)
  return readFileSync(synthSrcPath, 'utf8')
}

/** Relative import specifiers (`./x`, `../y`) from `import ... from '...'` statements. */
function relativeImportSpecifiers(src: string): string[] {
  const specs: string[] = []
  const re = /\bfrom\s+['"](\.[^'"]*)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) specs.push(m[1])
  return specs
}

describe('@arcade/shared/synth source — generic over the voice-name type', () => {
  it('createSynthEngine is exported and generic over a string-constrained name param', () => {
    const src = readSynthSource()
    // A bare `createSynthEngine(` with no `<... extends string>` collapses
    // startVoice()/stopVoice() to `string` and the cabinet loses its typed voice union.
    expect(
      src,
      'createSynthEngine must be exported generic: `createSynthEngine<N extends string>(`',
    ).toMatch(/export\s+function\s+createSynthEngine\s*<\s*[A-Za-z_]\w*\s+extends\s+string\s*>/)
  })

  it('the SynthEngine surface type is generic over the name param', () => {
    const src = readSynthSource()
    expect(
      src,
      'SynthEngine must be exported generic (interface|type) so startVoice(name) stays typed',
    ).toMatch(/export\s+(interface|type)\s+SynthEngine\s*<\s*[A-Za-z_]\w*\s+extends\s+string\s*>/)
  })

  it('exports the noiseBuffer helper — the byte-identical primitive both cabinets share', () => {
    const src = readSynthSource()
    expect(src, 'noiseBuffer must be exported for the cabinets to build their one-shots').toMatch(
      /export\s+function\s+noiseBuffer\s*\(/,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The VERB/NUMBERS fence — the whole point of the story
// ─────────────────────────────────────────────────────────────────────────────

describe('@arcade/shared/synth source — ships the VERB, keeps the NUMBERS out', () => {
  it('carries no cabinet-specific ROM seam or sound name', () => {
    const src = readSynthSource()
    // The skeleton is the ENGINE, not the instrument. Every one of these belongs to a
    // single cabinet, and any of them appearing here means a NUMBER has leaked into the
    // shared package — the exact failure this story exists to prevent.
    const cabinetSymbols = [
      'POKEY', // red-baron's sound chip
      'AUDF', // POKEY pitch register
      'AUDC', // POKEY volume register
      'gunStrobe', // rb ROM seam (INTCNT & 8)
      'explosionLevel', // rb ROM seam (EXPVAL $F0 ramp)
      'approachWhine', // rb ROM seam (ATGVAL)
      'engineHumParams', // rb ROM seam (detuned $F8/$F7)
      'engineParams', // bz throttle->hum curve
      'saucerVoice', // bz voice
      'trackVoice', // bz voice
      'EXPL2_FRAMES', // rb explosion window
    ]
    const leaked = cabinetSymbols.filter((sym) => new RegExp(`\\b${sym}\\b`).test(src))
    expect(
      leaked,
      `cabinet NUMBERS leaked into the shared VERB (they belong in each game): ${leaked.join(', ')}`,
    ).toEqual([])
  })

  it('imports nothing from a game — the shared package cannot depend on a cabinet', () => {
    const src = readSynthSource()
    expect(src).not.toMatch(/from\s+['"][^'"]*(battlezone|red-baron|tempest|asteroids)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TS lang-review checklist
// ─────────────────────────────────────────────────────────────────────────────

describe('@arcade/shared/synth source — TS lang-review #1 (type-safety escapes)', () => {
  it('uses no `as any` / `as unknown as` / `@ts-ignore` escapes', () => {
    const src = readSynthSource()
    expect(src).not.toMatch(/\bas any\b/)
    expect(src).not.toMatch(/as\s+unknown\s+as/)
    expect(src).not.toMatch(/@ts-ignore/)
  })
})

describe('@arcade/shared/synth source — TS lang-review #2 (generic/interface hygiene)', () => {
  it('uses no bare `Function` type — a callback is a specific signature', () => {
    const src = readSynthSource()
    // The engine takes callbacks (the withAudio effect, the startVoice builder), so
    // this is a live risk here, not a theoretical one.
    expect(src, 'no bare `Function` type — use `(t: SynthTarget) => void`').not.toMatch(
      /:\s*Function\b/,
    )
  })

  it('uses no `Record<string, any>`', () => {
    const src = readSynthSource()
    expect(src).not.toMatch(/Record\s*<\s*string\s*,\s*any\s*>/)
  })
})

describe('@arcade/shared/synth source — TS lang-review #4 (null/undefined handling)', () => {
  it('defaults the master gain with `??`, never `||` (0 is a valid gain)', () => {
    const src = readSynthSource()
    // `masterGain || 0.8` silently rewrites a deliberate 0 (a muted cabinet) to 0.8.
    // The behavioural proof is in synth.test.ts; this pins the spelling at the source.
    expect(src, 'masterGain must default with ?? — `||` would swallow a valid 0').not.toMatch(
      /masterGain\s*\|\|/,
    )
  })
})

describe('@arcade/shared/synth source — TS lang-review #5 (.js extension on ESM imports)', () => {
  it('every relative import carries an explicit `.js` extension (native ESM survival)', () => {
    const src = readSynthSource()
    const offenders = relativeImportSpecifiers(src).filter((s) => !s.endsWith('.js'))
    expect(
      offenders,
      `relative imports missing the required .js extension (breaks native Node ESM): ${offenders.join(', ')}`,
    ).toEqual([])
  })
})

describe('@arcade/shared/synth source — TS lang-review #11 (error handling)', () => {
  it('uses no `catch (e: any)` — narrow from unknown, or swallow with a bare catch', () => {
    const src = readSynthSource()
    expect(src).not.toMatch(/catch\s*\(\s*\w+\s*:\s*any\s*\)/)
  })
})
