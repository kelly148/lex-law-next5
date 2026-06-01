/**
 * sendabilityOutputParse — MR-CAL-8B
 *
 * Parse + validate the sendability classifier's LLM output into the
 * SendabilityVerdict shape. Tolerant of the two shapes a model may emit — a
 * string of JSON or an already-parsed object — but STRICT on the verdict contract
 * (SendabilityVerdictSchema). THROWS on anything unparseable or non-conforming.
 *
 * The CALLER (document.checkSendability) catches the throw and returns an
 * "unavailable" result to the client — the sendability check is ADVISORY and must
 * NEVER surface an error into the finalize/export path or block the attorney.
 */
import {
  SendabilityVerdictSchema,
  type SendabilityVerdict,
} from '../../../shared/schemas/phase4b.js';

export function parseSendabilityOutput(raw: unknown): SendabilityVerdict {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    // May throw SyntaxError on malformed JSON — intentional; caller handles.
    obj = JSON.parse(raw);
  }
  // Strict schema validation — throws on mismatch.
  return SendabilityVerdictSchema.parse(obj);
}
