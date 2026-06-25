/**
 * locusGate.ts — EXPRESS-AUTO-REVIEW-LOOP-1 E1: the deterministic LOCUS GATE.
 *
 * THE single safety ruling of the whole Express program. A reviewer suggestion may be AUTO-ADOPT-ELIGIBLE only
 * because of WHERE its change lands:
 *   - it intersects NO protected legal span, AND
 *   - it is NOT a deletion, AND
 *   - it does NOT edit a defined term or its definition.
 * Otherwise it ESCALATES — regardless of any label the suggestion (or a model) attaches.
 *
 * A MODEL CAN NEVER AUTHORIZE AN AUTO-ADOPT. A model classification is an ADDITIVE-ONLY input: it may RAISE an
 * escalation (a "model says risky" hint can flip eligible -> escalate), but it can NEVER lower one — a
 * "model says safe" hint is IGNORED for the adopt direction. The verdict is computed purely from the locus
 * (character-range intersection) and the deterministic deletion / defined-term rails; the model hint is only
 * ever consulted to ADD an escalation. This is the architectural ruling (build spec §"one architectural
 * decision"): a span-intersection check is deterministic and exhaustively testable; a semantic "is this safe?"
 * label is not, so it is never the gate.
 *
 * PURE + deterministic + no-egress + flag-dark. Same input -> same verdict, byte-identical reason. No LLM, no
 * DB, no dependency. E1 is the gate + span model in ISOLATION; nothing wires into the live review path yet
 * (E2–E5 do that).
 */

import type { ProtectedSpan } from './protectedSpans.js';

/** The gate verdict. Only 'auto_adopt_eligible' may ever proceed to (mechanical) auto-adopt downstream. */
export type LocusDecision = 'auto_adopt_eligible' | 'escalate';

/**
 * A reviewer suggestion as the gate sees it. The gate cares ONLY about the LOCUS (where it lands) + whether it
 * is a deletion + which defined terms it touches — never about a free-text "what it claims to be".
 */
export interface LocusSuggestion {
  /** Inclusive start char offset of the change's target range in the CURRENT document text. */
  targetStart: number;
  /** Exclusive end char offset of the change's target range. For a pure INSERTION, targetStart === targetEnd
   *  (a zero-width point); the gate treats an insertion AT a protected boundary conservatively (see rules). */
  targetEnd: number;
  /** true when the suggestion removes text (a deletion, or a replacement whose new text is shorter / empty in a
   *  way the caller classifies as a removal). A deletion ALWAYS escalates — removal of operative text is never
   *  auto-adoptable. */
  isDeletion: boolean;
  /**
   * ADDITIVE-ONLY model hint. The gate may use modelEscalates === true to RAISE an escalation; it NEVER uses
   * any value of this field to authorize an auto-adopt. modelSaysSafe is accepted on the type purely to make
   * the "a safe label cannot lower the verdict" guarantee EXPLICIT and testable — it is structurally ignored
   * for the adopt direction.
   */
  modelEscalates?: boolean | undefined;
  /** A "model says safe" hint. STRUCTURALLY IGNORED for the adopt direction — present only so a test can assert
   *  that providing it never flips an escalate to an auto-adopt. */
  modelSaysSafe?: boolean | undefined;
}

/** The auditable result: the verdict + a stable human-readable reason + the structured evidence. */
export interface LocusResult {
  decision: LocusDecision;
  /** A byte-identical-for-identical-input explanation (the FIRST triggering rule, then the rest as context). */
  reason: string;
  /** Every protected span the suggestion intersected (label + range), in catalog order — for the E4 ledger. */
  intersectedSpans: ProtectedSpan[];
  /** True when the deletion rail fired. */
  isDeletion: boolean;
  /** True when the defined-term rail fired (definition-site intersection OR a tracked-term occurrence touch). */
  touchedDefinedTerm: boolean;
  /** True when the additive model hint RAISED the escalation (never the sole reason auto-adopt was denied if a
   *  deterministic rail also fired; recorded for audit). */
  modelRaisedEscalation: boolean;
}

/** Optional, deterministic inputs that strengthen the defined-term rail. All pure. */
export interface LocusOptions {
  /**
   * The document's defined TERMS (e.g. ["Grantor", "Grantee", "Property"]). When provided, the gate computes
   * each term's occurrence ranges in `documentText` and escalates a suggestion whose target range intersects
   * ANY occurrence — so a "rename one instance of a defined term" edit escalates even if it lands outside the
   * definition-site span. Deterministic (literal, case-sensitive whole-word occurrence scan). Omit -> the rail
   * relies solely on the 'defined_terms_definitions' protected span.
   */
  definedTerms?: readonly string[] | undefined;
}

/** Two half-open ranges [aS,aE) and [bS,bE) intersect when aS < bE AND bS < aE. A zero-width insertion
 *  (aS === aE) is treated as intersecting a span when it lands STRICTLY INSIDE the span (bS < aS < bE) — an
 *  insertion exactly AT a boundary is handled by the boundary-adjacency rule below. Pure. */
function rangesIntersect(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  if (aStart === aEnd) {
    // zero-width insertion point: intersects only when strictly interior to the span
    return aStart > bStart && aStart < bEnd;
  }
  return aStart < bEnd && bStart < aEnd;
}

/** Does the suggestion's range sit IMMEDIATELY adjacent to a protected span (touching its start or end boundary
 *  without overlapping)? Conservative escalation: an edit hugging a protected boundary is treated as protected.
 *  Pure. */
function isBoundaryAdjacent(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  // adjacency = the change's end touches the span's start, or the change's start touches the span's end
  return aEnd === bStart || aStart === bEnd;
}

/** Literal, case-sensitive, whole-word occurrence ranges of `term` in `text`. Deterministic; no regex injection
 *  (term is escaped). Whole-word so "Grant" inside "Grantor" is not a false match for term "Grant". */
function termOccurrences(text: string, term: string): Array<{ start: number; end: number }> {
  const t = term.trim();
  if (t.length === 0) return [];
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'g');
  const out: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/**
 * THE LOCUS GATE — pure, deterministic. Decide whether `suggestion` is auto-adopt-eligible purely from WHERE
 * it lands (plus the deletion + defined-term rails). A model hint may only RAISE an escalation.
 *
 * RULES (evaluated deterministically; ANY firing rail -> escalate):
 *   R1  DELETION            -> escalate. Removal of text is never auto-adoptable.
 *   R2  PROTECTED-SPAN      -> escalate if the target range INTERSECTS any protected span.
 *   R3  BOUNDARY-ADJACENT   -> escalate if the target range is immediately adjacent to (touching) a protected
 *                             span boundary (conservative — an edit hugging operative text is treated as
 *                             operative).
 *   R4  DEFINED-TERM        -> escalate if the target intersects a 'defined_terms_definitions' definition span
 *                             (covered by R2) OR intersects any tracked defined-term occurrence (R4b).
 *   R5  MODEL-RAISED        -> escalate if modelEscalates === true (ADDITIVE only — never lowers).
 *   ELSE                    -> auto_adopt_eligible.
 *
 * The verdict NEVER depends on modelSaysSafe (or any "safe" label). A model can only push toward escalate.
 */
export function evaluateLocus(
  suggestion: LocusSuggestion,
  protectedSpans: readonly ProtectedSpan[],
  documentText: string,
  options: LocusOptions = {},
): LocusResult {
  const { targetStart, targetEnd, isDeletion } = suggestion;
  // Normalize a possibly-reversed range so intersection math is well-defined (defensive; deterministic).
  const aStart = Math.min(targetStart, targetEnd);
  const aEnd = Math.max(targetStart, targetEnd);

  const intersectedSpans: ProtectedSpan[] = [];
  let adjacentSpan: ProtectedSpan | null = null;
  let definitionSpanTouched = false;

  for (const span of protectedSpans) {
    if (rangesIntersect(aStart, aEnd, span.start, span.end)) {
      intersectedSpans.push(span);
      if (span.label === 'defined_terms_definitions') definitionSpanTouched = true;
    } else if (adjacentSpan === null && isBoundaryAdjacent(aStart, aEnd, span.start, span.end)) {
      adjacentSpan = span;
    }
  }

  // R4b — tracked defined-term occurrences (deterministic literal scan). Independent of the located spans, so a
  // single-instance rename of a defined term escalates even outside the definition site.
  let termOccurrenceTouched = false;
  let touchedTerm: string | null = null;
  const terms = options.definedTerms ?? [];
  for (const term of terms) {
    for (const occ of termOccurrences(documentText, term)) {
      if (rangesIntersect(aStart, aEnd, occ.start, occ.end) || isBoundaryAdjacent(aStart, aEnd, occ.start, occ.end)) {
        termOccurrenceTouched = true;
        touchedTerm = term;
        break;
      }
    }
    if (termOccurrenceTouched) break;
  }

  const touchedDefinedTerm = definitionSpanTouched || termOccurrenceTouched;
  const modelRaisedEscalation = suggestion.modelEscalates === true;

  // Assemble the verdict. ANY deterministic rail -> escalate; the model hint can only ADD an escalation.
  // The reason leads with the FIRST (highest-priority) firing rail for a stable, byte-identical explanation.
  const reasons: string[] = [];

  if (isDeletion) {
    reasons.push('DELETION: removal of text is never auto-adoptable (R1).');
  }
  if (intersectedSpans.length > 0) {
    const labels = intersectedSpans.map((s) => `${s.label}[${s.start},${s.end})`).join(', ');
    reasons.push(`PROTECTED-SPAN intersection (R2): target [${aStart},${aEnd}) intersects ${labels}.`);
  }
  if (adjacentSpan !== null && intersectedSpans.length === 0) {
    reasons.push(
      `BOUNDARY-ADJACENT (R3): target [${aStart},${aEnd}) is adjacent to protected span ` +
        `${adjacentSpan.label}[${adjacentSpan.start},${adjacentSpan.end}) — conservative escalation.`,
    );
  }
  if (termOccurrenceTouched) {
    reasons.push(`DEFINED-TERM (R4b): target touches a defined-term occurrence ("${touchedTerm}").`);
  } else if (definitionSpanTouched) {
    reasons.push('DEFINED-TERM (R4): target intersects a defined-term definition site.');
  }
  if (modelRaisedEscalation) {
    reasons.push('MODEL-RAISED (R5): additive classifier raised an escalation (advisory only).');
  }

  const mustEscalate =
    isDeletion ||
    intersectedSpans.length > 0 ||
    adjacentSpan !== null ||
    touchedDefinedTerm ||
    modelRaisedEscalation;

  if (mustEscalate) {
    return {
      decision: 'escalate',
      reason: reasons.join(' '),
      intersectedSpans,
      isDeletion,
      touchedDefinedTerm,
      modelRaisedEscalation,
    };
  }

  // No protected-span intersection, no adjacency, not a deletion, no defined-term touch, no model escalation.
  // A "model says safe" hint is STRUCTURALLY IGNORED here — it is never consulted; only WHERE the change lands
  // permits eligibility.
  return {
    decision: 'auto_adopt_eligible',
    reason:
      `AUTO-ADOPT-ELIGIBLE: target [${aStart},${aEnd}) lands wholly in non-protected text, is not a deletion, ` +
      'and edits no defined term — eligibility granted by LOCUS only (no model label authorized it).',
    intersectedSpans,
    isDeletion: false,
    touchedDefinedTerm: false,
    modelRaisedEscalation: false,
  };
}
