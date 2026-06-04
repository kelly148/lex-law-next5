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
  type EvaluatorOutput,
} from '../../../shared/schemas/phase4b.js';

function toCandidate(raw: unknown): unknown {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    // May throw SyntaxError on malformed JSON — intentional; caller handles.
    obj = JSON.parse(raw);
  }
  // Tolerate a bare array in addition to the canonical { dispositions: [...] }.
  return Array.isArray(obj) ? { dispositions: obj } : obj;
}

export function parseEvaluatorOutput(raw: unknown): EvaluatorDisposition[] {
  // Strict schema validation — throws on mismatch. The dispositions-persistence path is
  // unchanged by FOLD-ORCH-1 Inc2: the additive optional issueGroups field is ignored here.
  return EvaluatorOutputSchema.parse(toCandidate(raw)).dispositions;
}

/**
 * FOLD-ORCH-1 Inc2: parse the FULL evaluator output, including the additive optional
 * `issueGroups` grouping projection. Used by orchestration consolidation (the grouping source);
 * the legacy dispositions persistence path keeps using parseEvaluatorOutput above. Tolerant of
 * the same wrapped/bare shapes; strict on the schema (throws on mismatch).
 */
export function parseEvaluatorOutputFull(raw: unknown): EvaluatorOutput {
  return EvaluatorOutputSchema.parse(toCandidate(raw));
}
