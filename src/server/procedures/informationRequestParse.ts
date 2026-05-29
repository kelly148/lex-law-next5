/**
 * informationRequestParse — MR-IR-ERR-1 / MR-IR-GEN-2
 *
 * Schema + tolerant parsing/validation for the LLM-generated information-request
 * question matrix.
 *
 * MR-IR-GEN-2 hardens this against normal LLM output shapes. Two layers:
 *   1. Enforcement: informationRequest.generate passes InformationRequestItemsSchema
 *      as structuredOutputSchema, so the provider adapter applies its JSON-only
 *      instruction, markdown-fence stripping, and object-wrapper normalization
 *      before returning.
 *   2. Defensive: parseGeneratedMatrixItems (below) independently strips markdown
 *      fences and normalizes single-key / known object wrappers, so the path is
 *      robust even when the enforcement layer is bypassed or incomplete.
 *
 * Fail-loud contract (preserves MR-IR-ERR-1 visible-failure behavior):
 *   - Output that is not valid JSON               → throws IR_GENERATION_MALFORMED
 *   - Output with no array / no usable wrapper     → throws IR_GENERATION_MALFORMED
 *   - Output with zero usable {category,questionText} items → throws IR_GENERATION_EMPTY
 *   - Otherwise → returns the usable items (existing successful behavior preserved)
 *
 * Zero questions is NOT a valid result of ordinary generation; the attorney can
 * still add questions manually to a successfully generated matrix.
 */

import { z } from 'zod';

export interface GeneratedMatrixItem {
  category: string;
  questionText: string;
}

/**
 * Narrow structured-output schema for generated questionnaire items.
 * Passed as structuredOutputSchema at the LLM call site so the provider adapter
 * enforces the array contract. Extra item fields are tolerated (stripped by Zod).
 */
export const InformationRequestItemsSchema = z.array(
  z.object({
    category: z.string(),
    questionText: z.string(),
  }),
);

// Known single-value wrapper keys the model may use around the items array,
// e.g. { "questions": [...] }. Normalized only when unambiguous (see extractItemArray).
const KNOWN_WRAPPER_KEYS = [
  'questions',
  'items',
  'questionnaire',
  'informationRequest',
  'information_request',
] as const;

function isGeneratedMatrixItem(value: unknown): value is GeneratedMatrixItem {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.category === 'string' && typeof obj.questionText === 'string';
}

/**
 * Strip a whole-response markdown code fence (```json ... ``` or ``` ... ```).
 * Returns the original text if it is not a whole-response fence.
 */
function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch && fenceMatch[1] !== undefined) {
    return fenceMatch[1].trim();
  }
  return text;
}

/**
 * Resolve a parsed value to an items array, tolerating object wrappers.
 *   - Array → returned as-is.
 *   - Object with exactly one key whose value is an array → that array (unambiguous).
 *   - Object with exactly one KNOWN wrapper key whose value is an array → that array.
 *   - Anything else (no array value, or multiple competing array candidates) → null.
 */
function extractItemArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);

    // Unambiguous single-key wrapper: { "anything": [...] }
    if (keys.length === 1) {
      const inner = obj[keys[0]!];
      if (Array.isArray(inner)) return inner;
    }

    // Known wrapper keys — extract only if exactly one candidate array is present.
    const candidates = KNOWN_WRAPPER_KEYS.filter(
      (k) => k in obj && Array.isArray(obj[k]),
    );
    if (candidates.length === 1) {
      return obj[candidates[0]!] as unknown[];
    }
  }
  return null;
}

/**
 * Parse and validate raw LLM matrix output into usable question items.
 *
 * @param output - The LLM adapter output (string JSON, possibly fenced/wrapped, or
 *                 an already-parsed value).
 * @returns A non-empty array of usable items.
 * @throws Error with message starting `IR_GENERATION_MALFORMED` if the output is
 *         not valid JSON or yields no array, or `IR_GENERATION_EMPTY` if no usable
 *         items are present.
 */
export function parseGeneratedMatrixItems(output: unknown): GeneratedMatrixItem[] {
  let parsed: unknown;
  if (typeof output === 'string') {
    const stripped = stripJsonCodeFence(output);
    try {
      parsed = JSON.parse(stripped);
    } catch (err) {
      throw new Error(
        `IR_GENERATION_MALFORMED: could not parse question-matrix output as JSON. ` +
          `Parse error: ${String(err)}`,
      );
    }
  } else {
    parsed = output;
  }

  const itemArray = extractItemArray(parsed);
  if (itemArray === null) {
    throw new Error(
      'IR_GENERATION_MALFORMED: question-matrix output was not a JSON array or a recognized array wrapper',
    );
  }

  const items = itemArray.filter(isGeneratedMatrixItem);

  if (items.length === 0) {
    throw new Error(
      'IR_GENERATION_EMPTY: the model returned no usable questions',
    );
  }

  return items;
}
