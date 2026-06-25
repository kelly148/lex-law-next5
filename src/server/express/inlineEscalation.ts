/**
 * inlineEscalation.ts — EXPRESS-AUTO-REVIEW-LOOP-1 E3: INLINE NEAR-BOUNDARY ESCALATION.
 *
 * E3 is an ADDITIVE layer that sits ON TOP of the E1 locus gate (locusGate.ts) and the E2 router
 * (adoptRouter.ts). It catches the risky NEAR-MISS early — INLINE, before the regenerate step — instead of
 * letting a borderline edit ride to the end-of-loop ledger. Two deterministic triggers RAISE an inline
 * escalation:
 *
 *  1. NEAR-BOUNDARY (deterministic, locus-based). A suggestion whose target range lands WITHIN a small,
 *     configurable PROXIMITY (NEAR_BOUNDARY_CHARS, default 12) of any protected span — but does NOT intersect
 *     it and is NOT adjacent to it (E1/E2 already escalate intersection + adjacency) — is a near-miss and
 *     escalates inline. Conservative: hugging operative text, even with a sliver of gap, is treated as risky.
 *
 *  2. CONFIDENCE GATE (deterministic over a SUPPLIED classifier RESULT). E3 accepts an OPTIONAL
 *     `classifierSignal { confidence; escalate? }` that the CALLER supplies. If `escalate === true` OR
 *     `confidence < CONFIDENCE_FLOOR` (default 0.85), E3 forces an inline escalation. E3 does NOT produce this
 *     signal — the actual MODEL / LLM dispatch that yields a confidence is DEFERRED TO E6 (fail-closed egress
 *     through the broker). E3 makes NO egress / LLM / network call; it is PURE over its inputs.
 *
 * THE ARCHITECTURAL INVARIANT (the locus-gate ruling, carried into E3): a model can NEVER authorize an
 * auto-adopt. E3 is ADDITIVE-ONLY — it can ONLY RAISE escalations. It NEVER turns an escalate into an
 * auto_adopt, and a "classifier says safe / high confidence" signal NEVER lowers an E1/E2 escalate to adopt.
 * E3's only authority is to ADD an escalation that E1/E2 would not yet have raised; when neither E3 trigger
 * fires, it DEFERS verbatim to the E2 router's verdict (which already can only auto-adopt via
 * locus-eligible ∧ verified Class-A).
 *
 * PURE + deterministic + no-egress + flag-dark. Same input -> same result, byte-identical reason. No LLM, no
 * DB, no dependency, no migration. E3 is NOT wired into any live procedure; the whole Express program is gated
 * by isAutoReviewLoopEnabled() (default OFF), and the loop orchestration (E5) owns the wiring.
 */

import { routeSuggestion, type AdoptRoute, type RoutableSuggestion, type RouteContext, type RouteResult } from './adoptRouter.js';
import type { ProtectedSpan } from './protectedSpans.js';

/**
 * The default near-boundary PROXIMITY band, in characters. A suggestion whose target range comes within this
 * many characters of a protected span (without intersecting or touching it) is a near-miss and escalates
 * inline. Small on purpose: the band is for the genuine near-miss, not a blanket widening of every span.
 * E1/E2 already escalate intersection (gap 0, overlapping) and adjacency (gap 0, touching); E3 covers the
 * (0, NEAR_BOUNDARY_CHARS] open-low / closed-high gap band beyond them.
 */
export const NEAR_BOUNDARY_CHARS = 12;

/**
 * The confidence FLOOR. A SUPPLIED classifier confidence STRICTLY BELOW this floor forces an inline escalation.
 * At or above it (and absent an explicit `escalate` flag), the confidence gate does not fire — the suggestion
 * defers to the E2 router. The classifier signal is supplied by the caller (E6 produces it); E3 only reads it.
 */
export const CONFIDENCE_FLOOR = 0.85;

/**
 * A SUPPLIED classifier result — the ADDITIVE input E3 accepts from the caller. E3 does NOT create this; the
 * model dispatch that produces a confidence is E6's (fail-closed egress through the broker). Mirrors the
 * additive-only nature of the locus gate's model hint: it may RAISE an escalation, never authorize an adopt.
 */
export interface ClassifierSignal {
  /** The classifier's confidence in [0, 1] that the change is safe. BELOW CONFIDENCE_FLOOR -> escalate inline. */
  confidence: number;
  /** An explicit "the classifier wants this escalated" flag. When true -> escalate inline (additive raise). A
   *  false/absent value NEVER lowers an E1/E2 escalate — it only declines to ADD an E3 escalation. */
  escalate?: boolean | undefined;
}

/** The deterministic reason an inline escalation fired (or did not). Stable for audit + E4 ledger. */
export type InlineEscalationReasonCode =
  | 'near_boundary'
  | 'low_confidence'
  | 'classifier_escalate_flag'
  | 'deferred_to_router';

/**
 * The structured INLINE-ESCALATION EVENT — what the attorney sees at the regenerate step (E5/E7 surface it).
 * Pure data; deterministic. Present only when an inline escalation actually fired.
 */
export interface InlineEscalationEvent {
  /** The suggestion's normalized target range that triggered the inline escalation. */
  targetStart: number;
  targetEnd: number;
  /** The reason code (which E3 trigger fired). */
  reasonCode: InlineEscalationReasonCode;
  /** The nearest protected span when the near-boundary trigger fired (label + range + char gap); null otherwise. */
  nearestSpan: { label: ProtectedSpan['label']; start: number; end: number; gap: number } | null;
  /** The supplied classifier confidence when the confidence gate was consulted; null when no signal was given. */
  confidence: number | null;
  /** A stable, human-readable explanation (byte-identical for identical input). */
  message: string;
}

/** E3's terminal recommendation for a single suggestion. ADDITIVE-ONLY: an inline escalation forces 'escalate';
 *  otherwise E3 carries through the E2 router's route verbatim (which itself can only auto_adopt via the gate). */
export interface InlineEscalationResult {
  /** True when an E3 trigger RAISED an inline escalation (near-boundary or the confidence gate). */
  escalateInline: boolean;
  /** The effective route. When escalateInline is true this is ALWAYS 'escalate'. When false it is the E2
   *  router's own route (deferral) — E3 never overrides the router toward adopt, only toward escalate. */
  route: AdoptRoute;
  /** A stable explanation leading with the deciding factor. */
  reason: string;
  /** The structured inline event for E5/E7 surfacing; null when E3 did not raise an inline escalation. */
  event: InlineEscalationEvent | null;
  /** The full E2 router result E3 deferred to / would have produced (for the E4 ledger + the additive proof). */
  route_basis: RouteResult;
}

/** Optional, deterministic inputs for the inline pre-check. */
export interface InlineEscalationOptions {
  /** Override the near-boundary proximity band (defaults to NEAR_BOUNDARY_CHARS). Must be >= 0. */
  nearBoundaryChars?: number | undefined;
  /** Override the confidence floor (defaults to CONFIDENCE_FLOOR). */
  confidenceFloor?: number | undefined;
}

/**
 * The CHAR GAP between two half-open ranges [aS,aE) and [bS,bE): 0 when they intersect OR touch (adjacent),
 * otherwise the positive number of characters strictly between them. Pure + deterministic. A gap of 0 means
 * E1/E2 already handle it (intersection or adjacency); E3 only cares about a STRICTLY POSITIVE gap inside the
 * proximity band.
 */
function charGap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  if (aStart < bEnd && bStart < aEnd) return 0; // overlapping
  if (aEnd < bStart) return bStart - aEnd; // a is entirely before b
  if (bEnd < aStart) return aStart - bEnd; // a is entirely after b
  return 0; // touching (adjacent): aEnd === bStart or bEnd === aStart
}

/**
 * Find the protected span NEAREST the suggestion's target range that sits in the near-boundary band — i.e. the
 * gap is STRICTLY GREATER THAN 0 (not intersecting/adjacent; those are E1/E2's) and AT MOST `band`. Returns the
 * nearest such span (smallest gap, ties broken by catalog order), or null. Pure + deterministic.
 */
function nearestSpanInBand(
  aStart: number,
  aEnd: number,
  spans: readonly ProtectedSpan[],
  band: number,
): { span: ProtectedSpan; gap: number } | null {
  let best: { span: ProtectedSpan; gap: number } | null = null;
  for (const span of spans) {
    const gap = charGap(aStart, aEnd, span.start, span.end);
    if (gap > 0 && gap <= band) {
      if (best === null || gap < best.gap) best = { span, gap };
    }
  }
  return best;
}

/**
 * THE INLINE PRE-CHECK — pure, deterministic, ADDITIVE-ONLY. Decide whether `suggestion` should be escalated
 * INLINE (before regenerate) because it lands NEAR a protected-span boundary or because a SUPPLIED classifier
 * signal flags it low-confidence / escalate. If neither E3 trigger fires, DEFER to the E2 router's verdict.
 *
 * ADDITIVE-ONLY GUARANTEE (asserted in tests): E3 can ONLY add escalations.
 *   - When an E3 trigger fires -> route is ALWAYS 'escalate'.
 *   - When no E3 trigger fires -> route is EXACTLY the E2 router's route. E3 NEVER changes a router 'escalate'
 *     into 'auto_adopt', and a high-confidence / "safe" classifier signal NEVER lowers an E1/E2 escalate.
 * Therefore E3's route is 'auto_adopt' iff the E2 router already routed 'auto_adopt' AND no E3 trigger fired —
 * E3 introduces NO new path to auto_adopt and removes none of E1/E2's escalations.
 *
 * The classifierSignal is SUPPLIED by the caller (E6 produces it via the broker); E3 makes NO model/egress call.
 */
export function inlineEscalate(
  suggestion: RoutableSuggestion,
  ctx: RouteContext,
  classifierSignal?: ClassifierSignal,
  options: InlineEscalationOptions = {},
): InlineEscalationResult {
  // First compute the E2 router's verdict — it is the deferral target AND the additive baseline. E3 never moves
  // this toward adopt; it only ever ADDS an escalation on top of it.
  const route_basis = routeSuggestion(suggestion, ctx);

  const band = options.nearBoundaryChars ?? NEAR_BOUNDARY_CHARS;
  const floor = options.confidenceFloor ?? CONFIDENCE_FLOOR;

  const aStart = Math.min(suggestion.targetStart, suggestion.targetEnd);
  const aEnd = Math.max(suggestion.targetStart, suggestion.targetEnd);

  // ── Trigger 1: NEAR-BOUNDARY (deterministic, locus-based). ──────────────────────────────────────
  const near = nearestSpanInBand(aStart, aEnd, ctx.protectedSpans, band);

  // ── Trigger 2: CONFIDENCE GATE over the SUPPLIED signal (deterministic). ────────────────────────
  const hasSignal = classifierSignal !== undefined;
  const signalEscalate = classifierSignal?.escalate === true;
  const lowConfidence = hasSignal && classifierSignal!.confidence < floor;

  // Inline escalation fires if EITHER trigger fires. The reason leads with the FIRST (highest-priority) firing
  // trigger for a byte-identical explanation: near-boundary, then explicit escalate flag, then low confidence.
  if (near !== null || signalEscalate || lowConfidence) {
    let reasonCode: InlineEscalationReasonCode;
    let message: string;

    if (near !== null) {
      reasonCode = 'near_boundary';
      message =
        `INLINE-ESCALATE (near-boundary): target [${aStart},${aEnd}) is ${near.gap} char(s) from protected span ` +
        `${near.span.label}[${near.span.start},${near.span.end}) — within the ${band}-char proximity band ` +
        '(not intersecting/adjacent — those already escalate). Conservative: a near-miss escalates inline.';
    } else if (signalEscalate) {
      reasonCode = 'classifier_escalate_flag';
      message =
        'INLINE-ESCALATE (classifier escalate flag): a SUPPLIED classifier signal requested escalation ' +
        '(additive raise only — a classifier can never authorize an auto-adopt).';
    } else {
      reasonCode = 'low_confidence';
      message =
        `INLINE-ESCALATE (low confidence): SUPPLIED classifier confidence ${classifierSignal!.confidence} < floor ` +
        `${floor} — escalate inline before regenerate (additive raise only).`;
    }

    const event: InlineEscalationEvent = {
      targetStart: aStart,
      targetEnd: aEnd,
      reasonCode,
      nearestSpan: near !== null ? { label: near.span.label, start: near.span.start, end: near.span.end, gap: near.gap } : null,
      confidence: hasSignal ? classifierSignal!.confidence : null,
      message,
    };

    return {
      escalateInline: true,
      route: 'escalate', // ADDITIVE: an inline escalation is ALWAYS an escalate, never an adopt
      reason: message,
      event,
      route_basis,
    };
  }

  // ── No E3 trigger fired -> DEFER to the E2 router verbatim. ──────────────────────────────────────
  // E3 adds nothing here: the route is EXACTLY the router's (which can only auto_adopt via locus-eligible ∧
  // verified Class-A). A high-confidence / "safe" signal does NOT lower a router escalate — it merely declines
  // to ADD an E3 escalation; if the router already escalated, the route stays 'escalate'.
  return {
    escalateInline: false,
    route: route_basis.route,
    reason:
      `DEFERRED to E2 router (no inline trigger: not within the ${band}-char near-boundary band` +
      `${hasSignal ? `, confidence ${classifierSignal!.confidence} >= floor ${floor}, no escalate flag` : ', no classifier signal supplied'}). ` +
      `Router route: ${route_basis.route}. ${route_basis.reason}`,
    event: null,
    route_basis,
  };
}
