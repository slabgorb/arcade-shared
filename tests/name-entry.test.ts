// tests/name-entry.test.ts
//
// SH2-13 RED — the shared keyboard initials-entry VERB. The cabinet's four
// scoring games converge on ONE entry mechanism (asteroids' direct typing is
// the reference): a letter key A-Z appends UPPERCASED while the buffer is
// short of the cabinet's max, Backspace deletes the last character (and can
// never delete past empty), and every other key is inert. The per-cabinet
// NUMBERS (max length, confirm key, styling) stay in the games — maxLength is
// a PARAMETER here, not a constant.
//
// Pinned GREEN surface: src/name-entry.ts exporting
//   stepNameEntry(buffer: string, key: string, maxLength: number): string
// `key` is the DOM KeyboardEvent.key string ('a', 'K', 'Backspace', 'Enter',
// 'ArrowLeft', ...) — the helper decides what a key MEANS; the game decides
// when to feed it and what to do with the result.
//
// RED via module-load failure until Dev creates src/name-entry.ts (the
// font.test.ts precedent). NOTE: arcade-shared tests are UNTYPED (no root
// tsconfig; vitest strips types) — every contract here is a runtime assertion.
import { describe, it, expect } from 'vitest'
import { stepNameEntry } from '../src/name-entry'

describe('stepNameEntry — typing letters (the asteroids reference behaviour)', () => {
  it('appends a lowercase letter UPPERCASED', () => {
    expect(stepNameEntry('', 'a', 3)).toBe('A')
  })

  it('appends an already-uppercase letter as-is', () => {
    expect(stepNameEntry('A', 'C', 3)).toBe('AC')
  })

  it('fills the buffer in typing order', () => {
    const out = ['k', 'a', 'v'].reduce((buf, k) => stepNameEntry(buf, k, 3), '')
    expect(out).toBe('KAV')
  })

  it('ignores letters once the buffer is at maxLength', () => {
    expect(stepNameEntry('ACE', 'x', 3)).toBe('ACE')
  })

  it('treats maxLength as the per-cabinet parameter, not a baked-in 3', () => {
    const out = ['l', 'u', 'k', 'e'].reduce((buf, k) => stepNameEntry(buf, k, 4), '')
    expect(out).toBe('LUKE')
    expect(stepNameEntry(out, 's', 4)).toBe('LUKE') // full at 4, further letters inert
  })

  it('maxLength 0 never accepts a letter', () => {
    expect(stepNameEntry('', 'a', 0)).toBe('')
  })
})

describe('stepNameEntry — Backspace (AC-2, new to the whole cabinet)', () => {
  it('deletes the last entered character', () => {
    expect(stepNameEntry('AC', 'Backspace', 3)).toBe('A')
  })

  it('cannot delete past an empty buffer', () => {
    expect(stepNameEntry('', 'Backspace', 3)).toBe('')
  })

  it('deletes from a FULL buffer too (correcting the 3rd initial)', () => {
    expect(stepNameEntry('ACX', 'Backspace', 3)).toBe('AC')
  })

  it('supports the correct-a-mistake loop: type, delete, retype', () => {
    const typo = ['a', 'c', 'x'].reduce((buf, k) => stepNameEntry(buf, k, 3), '')
    const fixed = stepNameEntry(stepNameEntry(typo, 'Backspace', 3), 'e', 3)
    expect(fixed).toBe('ACE')
  })
})

describe('stepNameEntry — every other key is inert (the A-Z charset holds)', () => {
  const INERT_KEYS = [
    '5', '0', // digits
    ' ', '-', '.', '/', ';', "'", // punctuation & space
    'Enter', 'Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape', 'CapsLock',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'F1', 'Delete', 'Dead',
    'ß', 'é', 'ñ', // single-char letters OUTSIDE A-Z (the stroke face has no glyph)
    'ab', 'AA', '', // multi-char / empty junk that is not a named key
  ]

  for (const key of INERT_KEYS) {
    it(`ignores ${JSON.stringify(key)}`, () => {
      expect(stepNameEntry('A', key, 3)).toBe('A')
      expect(stepNameEntry('', key, 3)).toBe('')
    })
  }

  it('holds the invariant under a mixed hostile key script: result is 0..max uppercase A-Z', () => {
    const script = [
      'q', 'Backspace', '7', 'z', ' ', 'Enter', 'j', 'ArrowLeft', 'ß', 'x',
      'Backspace', 'Backspace', 'Backspace', 'Backspace', 'm', 'ab', 'N', '.',
    ]
    const out = script.reduce((buf, k) => stepNameEntry(buf, k, 3), '')
    expect(out).toMatch(/^[A-Z]{0,3}$/)
    // And the exact trace, so the reducer is deterministic, not merely bounded:
    // q->Q, 7 inert, z->QZ, j->QZJ (full), x inert, 4x Backspace -> '', m->M, N->MN, '.' inert.
    expect(out).toBe('MN')
  })
})

describe('stepNameEntry — pure reducer discipline', () => {
  it('is deterministic: identical arguments give identical results', () => {
    expect(stepNameEntry('AB', 'c', 3)).toBe(stepNameEntry('AB', 'c', 3))
    expect(stepNameEntry('AB', 'Backspace', 3)).toBe(stepNameEntry('AB', 'Backspace', 3))
  })

  it('returns the SAME buffer value on a no-op (callers may reference-compare)', () => {
    expect(stepNameEntry('ACE', 'x', 3)).toBe('ACE')
    expect(stepNameEntry('', 'Backspace', 3)).toBe('')
    expect(stepNameEntry('AB', 'Escape', 3)).toBe('AB')
  })
})
