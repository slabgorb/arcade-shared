// tests/audio-source-rules.test.ts
//
// SH2-16 — rule-enforcement tests (TS lang-review checklist) for the audio browser
// subpath, mirroring glow-source-rules / font-source-rules. arcade-shared is untyped
// (esbuild strips types), so these scan src/audio.ts as TEXT via node:fs. The generic
// `<N extends string>` contract CANNOT be asserted at runtime (types are erased), and
// design §8 flags "losing typed SoundName" as the top risk — so it is pinned here at
// the source level and, end-to-end, by tempest's tsc build (AC-5).
//
//   • Generic contract — createAudioEngine / AudioEngine / AudioManifest are all
//     generic over a `<... extends string>` name param (NOT collapsed to
//     Record<string,string>, per design §8 risk #1).
//   • #1 Type-safety escapes — no `as any`, `as unknown as`, `@ts-ignore`.
//   • #5 Module resolution — every RELATIVE import carries an explicit `.js`
//     extension (native Node ESM survival; bit SH2-12's esc-overlay → './font.js').
//   • #2 No `Function`-typed callback — any callback is a specific signature.
//
// These FAIL until Dev creates src/audio.ts (RED), and stay green only while the
// source keeps the generic + type discipline.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const audioSrcPath = fileURLToPath(new URL('../src/audio.ts', import.meta.url))

function readAudioSource(): string {
  // Missing file must FAIL (not skip) — this is the RED driver + Dev's obligation.
  expect(
    existsSync(audioSrcPath),
    'src/audio.ts must exist — Dev builds the shared SFX engine here (SH2-16 AC-1)',
  ).toBe(true)
  return readFileSync(audioSrcPath, 'utf8')
}

/** Relative import specifiers (`./x`, `../y`) from `import ... from '...'` statements. */
function relativeImportSpecifiers(src: string): string[] {
  const specs: string[] = []
  const re = /\bfrom\s+['"](\.[^'"]*)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) specs.push(m[1])
  return specs
}

describe('@arcade/shared/audio source — generic over the sound-name type (design §8)', () => {
  it('createAudioEngine is exported and generic over a string-constrained name param', () => {
    const src = readAudioSource()
    // The factory must keep the caller's SoundName union typed — a bare
    // `createAudioEngine(` with no `<... extends string>` collapses play() to `string`.
    expect(
      src,
      'createAudioEngine must be exported generic: `createAudioEngine<N extends string>(`',
    ).toMatch(/export\s+function\s+createAudioEngine\s*<\s*[A-Za-z_]\w*\s+extends\s+string\s*>/)
  })

  it('the AudioEngine surface type is generic over the name param', () => {
    const src = readAudioSource()
    expect(
      src,
      'AudioEngine must be exported generic (interface|type) so play(name) stays typed',
    ).toMatch(/export\s+(interface|type)\s+AudioEngine\s*<\s*[A-Za-z_]\w*\s+extends\s+string\s*>/)
  })

  it('the AudioManifest config type is generic over the name param', () => {
    const src = readAudioSource()
    expect(
      src,
      'AudioManifest must be exported generic so sounds/channels are Record<N,string>',
    ).toMatch(/export\s+(interface|type)\s+AudioManifest\s*<\s*[A-Za-z_]\w*\s+extends\s+string\s*>/)
  })

  it('does not collapse the manifest to an untyped Record<string, string>', () => {
    const src = readAudioSource()
    // Guards design §8 risk #1 directly: the whole point of the generic is lost if
    // sounds/channels are widened to `Record<string, string>`.
    expect(src, 'sounds/channels must be keyed by the generic N, not `string`').not.toMatch(
      /Record\s*<\s*string\s*,\s*string\s*>/,
    )
  })
})

describe('@arcade/shared/audio source — TS lang-review #1 (type-safety escapes)', () => {
  it('uses no `as any` / `as unknown as` / `@ts-ignore` escapes', () => {
    const src = readAudioSource()
    expect(src).not.toMatch(/\bas any\b/)
    expect(src).not.toMatch(/as\s+unknown\s+as/)
    expect(src).not.toMatch(/@ts-ignore/)
  })
})

describe('@arcade/shared/audio source — TS lang-review #5 (.js extension on ESM imports)', () => {
  it('every relative import carries an explicit `.js` extension (native ESM survival)', () => {
    const src = readAudioSource()
    const offenders = relativeImportSpecifiers(src).filter((s) => !s.endsWith('.js'))
    expect(
      offenders,
      `relative imports missing the required .js extension (breaks native Node ESM): ${offenders.join(', ')}`,
    ).toEqual([])
  })
})

describe('@arcade/shared/audio source — TS lang-review #2 (specific callback signature)', () => {
  it('uses no bare `Function`-typed parameter (onended etc. must be a real signature)', () => {
    const src = readAudioSource()
    expect(src, 'no bare `Function` type — use `() => void`').not.toMatch(/:\s*Function\b/)
  })
})
