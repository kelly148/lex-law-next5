/**
 * tolerantJsonParse — REVIEWER-PARSE-RELIABILITY-1 (RPR-2)
 *
 * A guarded, minimal structural repair for a COMPLETE-but-malformed reviewer array whose bytes throw in
 * JSON.parse before any of the shape-recovery layers (normalizeStructuredOutput Rules 1-6) can run.
 *
 * WHY: all existing robustness (fence strip, finish_reason truncation guards, normalizeStructuredOutput)
 * assumes JSON.parse SUCCEEDS and only repairs valid-but-wrong SHAPES. A complete response with a single
 * bad delimiter is unrecoverable by design (confirmed in the CAL-1 corpus: P8-T7 x gemini run2 — a
 * complete array closed with a `}` instead of `]`). JSON.parse throws upstream of every recovery layer.
 *
 * SAFETY (why this cannot corrupt the evaluator or mask a real failure):
 *  - ARRAY-GATED: repairs are attempted ONLY when the trimmed text's first non-whitespace char is `[`.
 *    The object-shaped evaluator schema ({dispositions:[...]}) is object-first, so it is never touched.
 *  - MINIMAL + SCOPED: only two structural typos are repaired — a mismatched top-level closer (`}` where
 *    the opener was `[`) and a trailing comma before the final closer. No content is fabricated.
 *  - CALLER RE-VALIDATES: this returns a candidate parsed VALUE only; the calling adapter still runs the
 *    normal Zod validation and MUST reject a repaired value that does not validate (fail-open to
 *    parse_error). A repair that parses to the wrong thing is therefore never accepted.
 *  - TRUNCATION-FIRST: the caller must check looksLikeTruncatedJson (RPR-1) BEFORE calling this, so a real
 *    truncation is classified as a retriable api_error rather than silently patched. This helper is
 *    array-first-gated and only fixes a final closer / trailing comma, so it does not "close" an
 *    unterminated mid-string truncation anyway.
 */

/** Index of the last non-whitespace character, or -1 if the string is all whitespace/empty. */
function lastNonWsIndex(s: string): number {
  for (let i = s.length - 1; i >= 0; i -= 1) {
    const c = s[i]!;
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') return i;
  }
  return -1;
}

/** Minimal repair candidates for an array-first, complete-but-malformed JSON text. */
function arrayRepairCandidates(t: string): string[] {
  const candidates: string[] = [];

  // (1) Mismatched top-level closer: array opened with `[` but the final closer is `}`.
  const last = lastNonWsIndex(t);
  const closerFixed =
    last >= 0 && t[last] === '}' ? t.slice(0, last) + ']' + t.slice(last + 1) : null;
  if (closerFixed) candidates.push(closerFixed);

  // (2) Trailing comma before the final closer: `[ ... , ]` / `[ ... , }`.
  const commaStripped = t.replace(/,(\s*[\]}]\s*)$/, '$1');
  if (commaStripped !== t) candidates.push(commaStripped);

  // (3) Both fixes together.
  if (closerFixed) {
    const both = closerFixed.replace(/,(\s*[\]}]\s*)$/, '$1');
    if (both !== closerFixed) candidates.push(both);
  }

  return candidates;
}

/**
 * Attempt a minimal structural repair of an array-shaped JSON text. Returns the first repaired candidate
 * that JSON.parses, or null if the text is not array-first or no candidate parses. The caller MUST still
 * Zod-validate the returned value and reject it on failure. Never throws.
 */
export function tryRepairArrayJson(text: string): { value: unknown } | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  // ARRAY-GATED: never touch object-first inputs (protects the evaluator object schema).
  if (t[0] !== '[') return null;
  for (const candidate of arrayRepairCandidates(t)) {
    try {
      return { value: JSON.parse(candidate) };
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
