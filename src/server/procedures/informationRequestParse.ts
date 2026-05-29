/**
 * informationRequestParse — MR-IR-ERR-1
 *
 * Pure parsing/validation for the LLM-generated information-request question
 * matrix. Extracted from informationRequest.generate so the failure contract is
 * unit-testable in isolation.
 *
 * Fail-loud contract (so generation failure is never presented as an
 * apparently-successful empty questionnaire):
 *   - Output that is not valid JSON          → throws IR_GENERATION_MALFORMED
 *   - Output that is not a JSON array        → throws IR_GENERATION_MALFORMED
 *   - Output with zero usable {category,questionText} items → throws IR_GENERATION_EMPTY
 *   - Otherwise → returns the usable items (existing successful behavior preserved)
 *
 * Zero questions is NOT a valid result of ordinary generation; the attorney can
 * still add questions manually to a successfully generated matrix.
 */

export interface GeneratedMatrixItem {
  category: string;
  questionText: string;
}

function isGeneratedMatrixItem(value: unknown): value is GeneratedMatrixItem {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.category === 'string' && typeof obj.questionText === 'string';
}

/**
 * Parse and validate raw LLM matrix output into usable question items.
 *
 * @param output - The LLM adapter output (string JSON or already-parsed value).
 * @returns A non-empty array of usable items.
 * @throws Error with message starting `IR_GENERATION_MALFORMED` if the output is
 *         not valid JSON or not an array, or `IR_GENERATION_EMPTY` if no usable
 *         items are present.
 */
export function parseGeneratedMatrixItems(output: unknown): GeneratedMatrixItem[] {
  let parsed: unknown;
  if (typeof output === 'string') {
    try {
      parsed = JSON.parse(output);
    } catch (err) {
      throw new Error(
        `IR_GENERATION_MALFORMED: could not parse question-matrix output as JSON. ` +
          `Parse error: ${String(err)}`,
      );
    }
  } else {
    parsed = output;
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      'IR_GENERATION_MALFORMED: question-matrix output was not a JSON array',
    );
  }

  const items = parsed.filter(isGeneratedMatrixItem);

  if (items.length === 0) {
    throw new Error(
      'IR_GENERATION_EMPTY: the model returned no usable questions',
    );
  }

  return items;
}
