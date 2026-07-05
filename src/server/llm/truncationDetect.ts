/**
 * truncationDetect — REVIEWER-PARSE-RELIABILITY-1 (RPR-1)
 *
 * A shared STRUCTURAL truncation detector, decoupled from any single provider's finish_reason signal.
 *
 * WHY: every adapter's existing truncation guard fires ONLY when the provider reports a specific
 * finish_reason ('length' for OpenAI/xAI, 'MAX_TOKENS' for Gemini, stop_reason 'max_tokens' for
 * Anthropic). But a provider can cut a response mid-string while returning a NON-'length' terminal
 * signal (confirmed in the CAL-1 corpus: P8-T7 x grok run1 — an 817-byte JSON array cut inside an open
 * string, classified PARSE_FAILURE). JSON.parse then throws "Unterminated string" and the failure is
 * mis-taxonomized as parse_error (terminal, non-retriable) instead of the truncation api_error class
 * that the transient-retry / L2 escalation act on.
 *
 * WHAT: `looksLikeTruncatedJson` scans the raw text (string-aware, escape-aware) and returns true ONLY
 * when the text is meant-to-be JSON (first non-whitespace char is `[` or `{`) AND it ends while still
 * inside an open string OR with unclosed brackets (positive nesting depth). It is a PURE detector —
 * it never mutates or fabricates content; adapters use it solely to pick the error CLASS on a
 * JSON.parse failure, failing OPEN to the existing parse_error when it returns false.
 *
 * It deliberately does NOT flag a COMPLETE-but-malformed response (balanced brackets, wrong delimiter,
 * extra trailing text) — that is a genuine parse_error and is the domain of the tolerant-parse recovery
 * (RPR-2), which must run AFTER this so real truncations are classified retriable rather than patched.
 */

/**
 * Returns true when `text` looks like a TRUNCATED JSON value (array/object) — it starts as JSON but is
 * cut off partway. Never throws.
 *
 * PRECISION (why not "any unclosed brackets"): a bare bracket-depth imbalance also matches obvious
 * GARBAGE like `{ broken json` or `{{{`, which is a genuine parse_error, not a truncation — flagging it
 * as retriable would waste an escalation retry (a concern the RPR findings called out). This scanner
 * therefore flags only the UNAMBIGUOUS truncation signals, both of which the CAL-1 corpus exhibits:
 *   (a) it ends INSIDE an open string (a value was being emitted and got cut — the grok P8-T7 case), or
 *   (b) it is unclosed (depth > 0) AND the last non-whitespace char is a `,` or `:` — the model had just
 *       committed to another element/value and was cut before producing it.
 * A complete-but-malformed response (balanced depth, or unclosed ending on garbage/an opener) stays a
 * parse_error — the domain of the tolerant-parse recovery (RPR-2) or a genuine failure.
 */
export function looksLikeTruncatedJson(text: string): boolean {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length === 0) return false;
  const first = t[0];
  // Only consider values that were meant to be a JSON array or object.
  if (first !== '[' && first !== '{') return false;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === '\\') {
        escaped = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === '[' || c === '{') {
      depth += 1;
    } else if (c === ']' || c === '}') {
      depth -= 1;
    }
  }

  // (a) ended mid-string — unambiguous truncation.
  if (inString) return true;
  // (b) unclosed AND ended on a "more is coming" token (`,` or `:`).
  const lastChar = t[t.length - 1];
  return depth > 0 && (lastChar === ',' || lastChar === ':');
}
