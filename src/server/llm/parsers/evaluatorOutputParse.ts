/**
 * evaluatorOutputParse — MR-CAL-5C
 *
 * Parse + validate the evaluator LLM output into the persisted dispositions shape.
 * Tolerant of the two shapes a model may emit — a wrapped object
 * { "dispositions": [...] } or a bare array [...] — but STRICT on the disposition
 * contract (EvaluatorOutputSchema / EvaluatorDispositionSchema). Throws on anything
 * unparseable or non-conforming so the caller fails the job and persists NOTHING
 * (the legacy reviewer feedback remains fully usable; the evaluator is additive).
 */
import {
  EvaluatorOutputSchema,
  type EvaluatorDisposition,
} from '../../../shared/schemas/phase4b.js';

export function parseEvaluatorOutput(raw: unknown): EvaluatorDisposition[] {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    // May throw SyntaxError on malformed JSON — intentional; caller handles.
    obj = JSON.parse(raw);
  }
  // Tolerate a bare array in addition to the canonical { dispositions: [...] }.
  const candidate = Array.isArray(obj) ? { dispositions: obj } : obj;
  // Strict schema validation — throws on mismatch.
  return EvaluatorOutputSchema.parse(candidate).dispositions;
}
