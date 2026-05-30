/**
 * outlineParse — LLN-OUTLINE-GEN-1
 *
 * Schema + tolerant parsing/validation for the LLM-generated document outline.
 *
 * This mirrors informationRequestParse.ts (MR-IR-GEN-2). Two layers:
 *   1. Enforcement: outline.generate / outline.regenerate pass OutlineSectionsSchema
 *      as structuredOutputSchema, so the provider adapter applies its JSON-only
 *      instruction, markdown-fence stripping, and object-wrapper normalization
 *      before returning.
 *   2. Defensive: parseGeneratedOutlineSections (below) independently strips
 *      markdown fences and normalizes single-key / known object wrappers, so the
 *      path is robust even when the enforcement layer is bypassed or incomplete.
 *
 * Fail-loud contract (replaces the prior silent-empty behavior in outline.ts):
 *   - Output that is not valid JSON                       → throws OUTLINE_GENERATION_MALFORMED
 *   - Output with no array / no usable wrapper             → throws OUTLINE_GENERATION_MALFORMED
 *   - Output with zero usable {title} sections             → throws OUTLINE_GENERATION_EMPTY
 *   - Otherwise → returns the usable sections (existing successful behavior preserved)
 *
 * orderIndex is assigned by the caller from array position, not taken from the
 * model output, so it is intentionally absent from the parsed shape.
 */

import { z } from 'zod';

export interface GeneratedOutlineSection {
  title: string;
  description: string;
}

/**
 * Narrow structured-output schema for generated outline sections.
 * Passed as structuredOutputSchema at the LLM call site so the provider adapter
 * enforces the array contract. Extra item fields (e.g. orderIndex) are tolerated
 * and stripped by Zod.
 */
export const OutlineSectionsSchema = z.array(
  z.object({
    title: z.string(),
    description: z.string(),
  }),
);

// Known single-value wrapper keys the model may use around the sections array,
// e.g. { "sections": [...] }. Normalized only when unambiguous (see extractItemArray).
const KNOWN_WRAPPER_KEYS = [
  'sections',
  'outline',
  'items',
  'document_outline',
  'documentOutline',
] as const;

/**
 * A usable section needs a non-empty title. description is optional in the raw
 * output and defaults to an empty string (matching OutlineSectionSchema, which
 * requires description: string but tolerates empty).
 */
function isGeneratedOutlineSection(value: unknown): value is { title: string; description?: unknown } {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.title === 'string' && obj.title.trim().length > 0;
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
 * Resolve a parsed value to a sections array, tolerating object wrappers.
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
 * Parse and validate raw LLM outline output into usable sections.
 *
 * @param output - The LLM adapter output (string JSON, possibly fenced/wrapped, or
 *                 an already-parsed value).
 * @returns A non-empty array of usable sections (title + description; description
 *          defaults to '' when absent). orderIndex is NOT included; the caller
 *          assigns it from array position.
 * @throws Error with message starting `OUTLINE_GENERATION_MALFORMED` if the output
 *         is not valid JSON or yields no array, or `OUTLINE_GENERATION_EMPTY` if no
 *         usable sections are present.
 */
export function parseGeneratedOutlineSections(output: unknown): GeneratedOutlineSection[] {
  let parsed: unknown;
  if (typeof output === 'string') {
    const stripped = stripJsonCodeFence(output);
    try {
      parsed = JSON.parse(stripped);
    } catch (err) {
      throw new Error(
        `OUTLINE_GENERATION_MALFORMED: could not parse outline output as JSON. ` +
          `Parse error: ${String(err)}`,
      );
    }
  } else {
    parsed = output;
  }

  const itemArray = extractItemArray(parsed);
  if (itemArray === null) {
    throw new Error(
      'OUTLINE_GENERATION_MALFORMED: outline output was not a JSON array or a recognized array wrapper',
    );
  }

  const sections = itemArray.filter(isGeneratedOutlineSection).map((s) => ({
    title: s.title,
    description: typeof s.description === 'string' ? s.description : '',
  }));

  if (sections.length === 0) {
    throw new Error(
      'OUTLINE_GENERATION_EMPTY: the model returned no usable outline sections',
    );
  }

  return sections;
}
