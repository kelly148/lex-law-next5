/**
 * structuredOutputNormalize — HI-5b (REVIEWER-ROBUSTNESS-1)
 *
 * The SINGLE shared structured-output object-wrapper normalizer for ALL FOUR reviewer adapters
 * (OpenAI, xAI, Anthropic, Google). Reviewer feedback is a bare JSON array (RawSuggestionsArraySchema),
 * but providers in JSON-object mode frequently wrap it. Before this module, OpenAI and xAI implemented
 * the full recovery (Rules 1-5, including the nested-wrapper and singleton-item rules from MR-LLM-LITE-3
 * / MR-LLM-LITE-5) while Anthropic and Google implemented only Rules 1-3 — so Claude/Gemini were the
 * lanes most likely to fail on a recoverable shape. Lifting the logic here gives every adapter the same
 * robustness from one place.
 *
 * This does NOT weaken the canonical schema. RawSuggestionsArraySchema remains a z.array(...);
 * normalization runs BEFORE Zod validation and only ever recovers an array from a wrapper that the
 * schema would otherwise reject — it never changes a value the schema already accepts. The function is
 * total and never throws.
 *
 * Normalization rules:
 *   1. Already an array → return as-is (no-op).
 *   2. Plain object with exactly one property whose value is an array → extract it (unambiguous).
 *   3. Plain object with multiple properties where a KNOWN_ARRAY_WRAPPER_KEY holds an array → extract it.
 *   4. Nested object wrapper — e.g. { "review": { "feedback": [...] } }: across the known OUTER keys,
 *      collect unambiguous inner-array candidates; if exactly one exists → extract it; if multiple
 *      compete → leave unchanged (ambiguous; Zod rejects).
 *   5. Singleton feedback item — if [value] validates against RawSuggestionsArraySchema → return [value].
 *   6. Otherwise → return unchanged; Zod rejects with a typed parse_error.
 */

import { RawSuggestionsArraySchema } from './parsers/feedbackParser.js';

/** Top-level wrapper key names a provider may use when the expected schema is a bare array. */
export const KNOWN_ARRAY_WRAPPER_KEYS = ['feedback', 'suggestions', 'items', 'result', 'data'] as const;

/** Outer wrapper keys for a nested object wrapper, e.g. { "review": { "feedback": [...] } }. */
export const KNOWN_OUTER_WRAPPER_KEYS = ['review', 'output', 'response', 'result', 'data'] as const;

/** Inner array keys expected inside a nested object wrapper. */
export const KNOWN_INNER_ARRAY_KEYS = ['feedback', 'suggestions', 'items', 'issues'] as const;

/**
 * Normalize a parsed structured-output value toward the canonical reviewer-feedback array, applying
 * Rules 1-6 above. Shared by every reviewer adapter. Never throws.
 */
export function normalizeStructuredOutput(value: unknown): unknown {
  // Rule 1: Direct array — pass through unchanged
  if (Array.isArray(value)) {
    return value;
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);

    // Rule 2: Exactly one property whose value is an array — unambiguous extraction
    if (keys.length === 1) {
      const inner = obj[keys[0]!];
      if (Array.isArray(inner)) {
        return inner;
      }
    }

    // Rule 3: Multi-key object — try known wrapper key names in priority order
    for (const knownKey of KNOWN_ARRAY_WRAPPER_KEYS) {
      if (knownKey in obj && Array.isArray(obj[knownKey])) {
        return obj[knownKey];
      }
    }

    // Rule 4: Nested object wrapper — collect unambiguous nested array candidates across outer keys
    const nestedCandidates: unknown[] = [];
    for (const outerKey of KNOWN_OUTER_WRAPPER_KEYS) {
      if (!(outerKey in obj)) continue;
      const outerVal = obj[outerKey];
      if (outerVal === null || typeof outerVal !== 'object' || Array.isArray(outerVal)) continue;
      const innerObj = outerVal as Record<string, unknown>;
      for (const innerKey of KNOWN_INNER_ARRAY_KEYS) {
        if (innerKey in innerObj && Array.isArray(innerObj[innerKey])) {
          nestedCandidates.push(innerObj[innerKey]);
        }
      }
    }
    if (nestedCandidates.length === 1) {
      return nestedCandidates[0];
    }
    // nestedCandidates.length > 1 → ambiguous; fall through to Rule 5

    // Rule 5: Singleton feedback item — [obj] validates against the canonical array schema → return [obj]
    const singletonCandidate = RawSuggestionsArraySchema.safeParse([obj]);
    if (singletonCandidate.success) {
      return [obj];
    }
    // Rule 5 failed — arbitrary object, leave unchanged; Zod will reject with parse_error
  }

  // Rule 6: All other cases — return unchanged; Zod will reject with parse_error
  return value;
}
