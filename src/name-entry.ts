// @arcade/shared/name-entry — the cabinet's shared keyboard initials-entry VERB.
//
// SH2-13 (epic SH2). The four scoring games converge on ONE entry mechanism,
// with asteroids' direct-typing flow as the reference: a letter key A-Z appends
// UPPERCASED while the buffer is short of the cabinet's max, Backspace deletes
// the last character (and can never delete past empty), and every other key is
// inert. The per-cabinet NUMBERS (max length, confirm key, styling, timeout)
// stay in the games — `maxLength` is a parameter here, not a constant.
//
// `key` is the DOM KeyboardEvent.key string ('a', 'K', 'Backspace', 'Enter',
// 'ArrowLeft', ...): this module decides what a key MEANS; the game decides
// when to feed it and what to do with the result. The charset is strictly
// ASCII A-Z — the shared stroke face has no other letter glyphs, so single-char
// keys outside that range (accented letters, 'ß', ...) are inert, as are named
// keys and any multi-character junk.
//
// Pure shared logic: a deterministic string reducer. No IO, no clocks, no
// randomness, nothing rendered. A no-op returns the SAME buffer value, so
// callers may reference-compare to skip state churn.

/** One keydown against an initials buffer: returns the next buffer. */
export function stepNameEntry(buffer: string, key: string, maxLength: number): string {
  if (key === 'Backspace') return buffer.slice(0, -1)
  if (buffer.length < maxLength && /^[a-zA-Z]$/.test(key)) return buffer + key.toUpperCase()
  return buffer
}
