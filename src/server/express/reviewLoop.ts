/**
 * reviewLoop.ts — EXPRESS-AUTO-REVIEW-LOOP-1 E5: the BOUNDED ANTI-DRIFT LOOP ORCHESTRATOR.
 *
 * E5 is the control flow that ties E1–E4a together into the auto-review loop:
 *
 *     review  ->  route (adopt Class-A / escalate the rest)  ->  regenerate  ->  repeat
 *
 * bounded to <=2 rounds by default (HARD CAP 3 enforced in code), RE-FEEDING THE ORIGINAL MATERIALS each pass
 * (anti-drift — the loop NEVER compounds on the drifting candidate; every regenerate starts from the original
 * materials + the cumulative adopted set), and ESCALATING ANY SAME-SPAN RE-TOUCH across rounds (anti-ping-pong /
 * anti-laundering, via the E2 immutability tracker). It hands back a NON-FINAL candidate + the full E4a ledger.
 *
 * THE CRITICAL SCOPE BOUNDARY — E5 IS DETERMINISTIC AND NO-EGRESS:
 *   The actual reviewer dispatch (producing suggestions) and the regenerate dispatch (producing a new draft) are
 *   INJECTED as function PORTS. E5 builds the control flow + bounding + anti-drift + ledger/tracker ownership;
 *   the real egress-backed implementations are wired in E6 (fail-closed egress through the broker). So E5 makes
 *   NO egress / LLM / network / DB call itself — the loop is PURE / DETERMINISTIC over its injected `reviewPort`
 *   + `regeneratePort`. Tests inject deterministic mock ports. If anything here is tempted to call a model or a
 *   broker, that is E6, not E5 — STOP.
 *
 * OWNERSHIP: E5 owns exactly ONE immutability tracker (E2) and exactly ONE decision ledger (E4a) per loop run,
 * and threads them through every pass — the loop is the single mutable-state owner the E2/E4a docs describe.
 *
 * INVARIANTS:
 *   - HARD CAP: the round counter NEVER exceeds min(maxRounds ?? 2, HARD_CAP=3). maxRounds is clamped to the
 *     hard cap; a larger value is ignored (the cap is an absolute code ceiling, not operator-raisable here).
 *   - ANTI-DRIFT: every regenerate is called with the ORIGINAL materials + the CUMULATIVE adopted set — never
 *     the prior candidate. The reviewer always reviews the CURRENT candidate, but the candidate is rebuilt from
 *     the original each round, so instruction-drift is catchable and the loop cannot compound on a drift.
 *   - SAME-SPAN RE-TOUCH: a span escalated in a prior round forces escalate now — enforced by the E2
 *     immutability tracker (routeWithImmutability), recorded in the ledger.
 *   - CONVERGENCE-STOP: a no-adopt round stops the loop (efficiency only — NEVER a quality/approval signal).
 *   - NON-FINAL: the returned candidate is explicitly labeled non-final; E7 enforces the can't-finalize guard.
 *
 * Flag-dark with the rest of Express (isAutoReviewLoopEnabled, default OFF). E5 is NOT wired into any live
 * procedure in this increment — it owns the loop control flow only; E6 supplies the egress-backed ports and the
 * live wiring. No migration, no new dependency, no egress.
 */

import {
  routeWithImmutability,
  createImmutabilityTracker,
  type RoutableSuggestion,
  type RouteContext,
  type RouteResult,
  type ImmutabilityTracker,
} from './adoptRouter.js';
import { inlineEscalate, type ClassifierSignal, type InlineEscalationResult } from './inlineEscalation.js';
import {
  createDecisionLedger,
  buildRedline,
  type DecisionLedger,
  type LedgerEntry,
  type DecisionRecord,
  type Redline,
} from './decisionLedger.js';
import { buildProtectedSpans, buildDeedProtectedSpans, type ProtectedSpan, type DocumentType } from './protectedSpans.js';

// ── the absolute hard cap ────────────────────────────────────────────────────────────────────────────

/**
 * The ABSOLUTE round ceiling, enforced in code. The loop NEVER runs more rounds than this — not even if a
 * caller passes maxRounds larger. This is the build-spec ruling: "<=2 rounds default, hard cap <=3 in code,
 * NOT operator-raisable past the cap without its own decision". Raising it past 3 is a separate load-bearing
 * decision; this constant is the code ceiling, and clampRounds() ignores any larger maxRounds.
 */
export const HARD_CAP_ROUNDS = 3;

/** The default round budget when the caller does not specify one. */
export const DEFAULT_MAX_ROUNDS = 2;

/**
 * Clamp a requested round budget to the absolute ceiling. min(requested, HARD_CAP), with a floor of 1 (a loop
 * always runs at least one review pass). A larger `requested` is IGNORED — the hard cap wins. Pure.
 */
export function clampRounds(requested: number | undefined): number {
  const want = requested ?? DEFAULT_MAX_ROUNDS;
  // A NaN / non-positive request is nonsense -> degrade to the default. A LARGE request (including +Infinity)
  // is a "too many rounds" ask -> it clamps to the hard cap (never exceeds it). Either way Math.min below is the
  // absolute ceiling, so even a degraded default can never exceed the cap.
  const sane = Number.isNaN(want) || want < 1 ? DEFAULT_MAX_ROUNDS : Math.floor(want);
  // Math.floor(+Infinity) === +Infinity; Math.min(+Infinity, HARD_CAP_ROUNDS) === HARD_CAP_ROUNDS — clamps.
  return Math.min(sane, HARD_CAP_ROUNDS);
}

// ── the injected PORTS (E6 supplies egress-backed versions; E5 never calls a model itself) ────────────

/**
 * One auto-adopted change, as the loop accumulates it across rounds. The CUMULATIVE list of these is what the
 * regenerate port receives (alongside the ORIGINAL materials) so the next candidate is rebuilt from the
 * original + the adopted set — never by mutating the prior candidate (anti-drift). Pure data.
 */
export interface AdoptedChange {
  /** The round this change was adopted in. */
  round: number;
  /** The ledger entry id of the adopting decision (audit linkage to the E4a ledger). */
  ledgerId: string;
  /** The exact text the adopted suggestion replaced, at its located offset in that round's candidate. */
  beforeText: string;
  /** The exact text the adopted suggestion put there. */
  afterText: string;
  /** The normalized char offset of the change in that round's candidate (start). */
  offsetStart: number;
  /** The normalized char offset of the change (exclusive end of the before range). */
  offsetEnd: number;
}

/**
 * Context the ports + the loop carry per pass. Pure data — the loop forwards it to the ports; E6's egress-backed
 * ports may read matter/model routing from it, but E5 treats it opaquely (never inspects it for a decision).
 */
export interface LoopContext {
  documentType: DocumentType;
  /** Any opaque per-matter/per-loop context the egress-backed ports (E6) need. E5 forwards it untouched. */
  [key: string]: unknown;
}

/**
 * THE REVIEW PORT (injected). Given the CURRENT candidate text + the loop context, produce this pass's reviewer
 * suggestions. INJECTED — E5 calls it but never implements the dispatch; E6 supplies the egress-backed version
 * (fail-closed through the broker). The loop treats the result as pure data: a readonly list of routable
 * suggestions. (Each suggestion may carry an optional classifierSignal for E3's inline confidence gate.)
 */
export type ReviewPort = (
  candidateText: string,
  ctx: LoopContext,
) => readonly LoopSuggestion[] | Promise<readonly LoopSuggestion[]>;

/**
 * THE REGENERATE PORT (injected). Given the ORIGINAL MATERIALS + the CUMULATIVE adopted set + the loop context,
 * produce the NEXT candidate draft. INJECTED — E5 calls it but never implements the dispatch; E6 supplies the
 * egress-backed version. ANTI-DRIFT CONTRACT (enforced by E5's call site, asserted in tests): the loop ALWAYS
 * passes the UNCHANGED original materials here — never the prior candidate — so the regenerate rebuilds from the
 * source, and the loop can never compound on a drifting draft.
 */
export type RegeneratePort = (
  originalMaterials: string,
  adoptedChanges: readonly AdoptedChange[],
  ctx: LoopContext,
) => string | Promise<string>;

/**
 * A reviewer suggestion as the LOOP sees it: a routable suggestion (E2) optionally carrying an E3 classifier
 * signal (the additive confidence/escalate hint E6 will produce). The loop routes each through E2 immutability +
 * E3 inline escalation. Pure data.
 */
export interface LoopSuggestion extends RoutableSuggestion {
  /** The optional E3 classifier signal (additive — can only RAISE an inline escalation, never authorize adopt). */
  classifierSignal?: ClassifierSignal | undefined;
}

// ── the loop parameters + result ──────────────────────────────────────────────────────────────────────

/** Everything runExpressLoop needs. Pure inputs + the two injected ports. */
export interface ExpressLoopParams {
  documentType: DocumentType;
  /** The v1 candidate the loop starts from (round 1 reviews THIS). */
  originalText: string;
  /**
   * The ORIGINAL materials/instruction the regenerate port re-feeds EACH round (anti-drift). This is the
   * immutable source the next candidate is rebuilt from — distinct from the (drifting) candidate. In many cases
   * originalMaterials and originalText differ (materials = the questionnaire/instruction; originalText = the
   * first draft); the loop keeps them separate precisely so regenerate never sees the prior candidate.
   */
  originalMaterials: string;
  /** The injected reviewer-dispatch port (E6 supplies the egress-backed version). */
  reviewPort: ReviewPort;
  /** The injected regenerate-dispatch port (E6 supplies the egress-backed version). */
  regeneratePort: RegeneratePort;
  /**
   * The protected-span catalog for the document. OPTIONAL: when omitted, the loop derives it per round from the
   * current candidate via buildProtectedSpans(documentType, candidate) — but a caller that already has the
   * authoritative catalog may pass it. (Passing a fixed catalog also lets a test pin offsets.)
   */
  protectedSpans?: readonly ProtectedSpan[] | undefined;
  /**
   * G10 (DEED-MANUAL-LEGAL-GIFT-1): the attorney-entered VERBATIM legal, when the deed carries one. Registered as
   * a first-class locked `legal_description` span each round (in addition to the recognizer pass) so an Express
   * revise/regenerate pass can NEVER touch it — the model-never-authors red line. Optional; absent = no extra
   * lock (behavior unchanged). Ignored when `protectedSpans` is pinned by the caller.
   */
  attorneyEnteredLegal?: string | null | undefined;
  /** Optional defined-term list, forwarded to the E1 locus gate each round. */
  definedTerms?: readonly string[] | undefined;
  /** The requested round budget. Clamped to [1, HARD_CAP_ROUNDS]; a larger value is ignored. Default 2. */
  maxRounds?: number | undefined;
  /** Optional opaque loop context forwarded verbatim to the injected ports (E6 reads matter/model routing). */
  context?: Record<string, unknown> | undefined;
}

/** A per-round summary (audit + the E8 round-cap-adherence report metric). Pure data. */
export interface RoundSummary {
  round: number;
  /** How many suggestions the review port returned this round. */
  suggestionCount: number;
  /** How many auto-adopted this round. */
  adoptedCount: number;
  /** How many escalated this round (gate / immutability / inline). */
  escalatedCount: number;
  /** True when this round produced NO adopt (the convergence-stop condition — efficiency only). */
  noAdopt: boolean;
  /** Whether the loop regenerated after this round (true) or stopped here (false: converged or hit the cap). */
  regenerated: boolean;
}

/** The terminal result of a bounded loop run. The candidate is NON-FINAL by construction. */
export interface ExpressLoopResult {
  /** The latest candidate draft. NON-FINAL — E7 enforces the can't-finalize/send/record guard; E5 only labels. */
  candidate: string;
  /** Explicit, structural non-final marker. Always true — E5 never produces a final/sendable artifact. */
  isFinal: false;
  /** The number of review rounds actually executed (1..clampRounds(maxRounds)). */
  rounds: number;
  /** True when the loop stopped because a round produced NO adopt (converged) rather than hitting the cap.
   *  CONVERGENCE IS EFFICIENCY ONLY — it is NEVER a quality / approval signal (build spec §E5). */
  converged: boolean;
  /** True when the loop stopped because it reached the (clamped) round cap with adopts still flowing. */
  hitCap: boolean;
  /** The full E4a decision ledger — every decision across every round (adopted, escalated, immutability-forced). */
  ledger: DecisionLedger;
  /** The unresolved escalations, risk-ranked (the attorney's triage view — every escalation across all rounds). */
  escalations: LedgerEntry[];
  /** The cumulative adopted set the regenerate port was fed (audit of what actually changed). */
  adopted: AdoptedChange[];
  /** The cumulative v1(originalText)->candidate redline (total drift at a glance), via E4a buildRedline. */
  redline: Redline;
  /** Per-round summaries (round-cap adherence + convergence-stop audit). */
  roundSummaries: RoundSummary[];
}

// ── the orchestrator ───────────────────────────────────────────────────────────────────────────────────

/**
 * RUN the bounded anti-drift auto-review loop. DETERMINISTIC over the injected ports — E5 itself makes NO
 * egress / LLM / network / DB call; all I/O is the two injected ports (mocked in tests, egress-backed in E6).
 *
 * ASYNC (E6-widened): the ports may be synchronous OR return a Promise — the real E6 ReviewPort dispatches
 * through the egress broker (async), so runExpressLoop is async and `await`s each port. This is a NON-behavioral
 * signature widening: the loop logic, ordering, ledger, anti-drift, immutability, and convergence/cap rules are
 * UNCHANGED — a synchronous port awaits to the same value, so every prior assertion holds (tests add `await`).
 *
 * THE PER-ROUND ALGORITHM (round = 1 .. cap, where cap = clampRounds(maxRounds), an absolute ceiling of 3):
 *   1. REVIEW: call reviewPort on the CURRENT candidate -> this pass's suggestions.
 *   2. ROUTE EACH suggestion:
 *        a. route it through routeWithImmutability (E2) — the SAME tracker is threaded across rounds, so a span
 *           escalated in a prior round is FORCED to escalate now (same-span re-touch / anti-laundering);
 *        b. additionally run inlineEscalate (E3) with the suggestion's optional classifierSignal — an inline
 *           near-boundary / low-confidence escalation can only ADD an escalation (never authorize an adopt);
 *        c. the EFFECTIVE route is auto_adopt ONLY when BOTH E2 routed auto_adopt AND E3 did not escalate inline;
 *           otherwise escalate;
 *        d. RECORD the decision in the E4a ledger (every suggestion, every round, adopted or escalated);
 *        e. an auto_adopt accumulates into the cumulative adopted set.
 *   3. CONVERGENCE: if NO suggestion auto-adopted this round -> STOP (converged — efficiency only).
 *   4. CAP: if this was the last permitted round -> STOP (hit cap).
 *   5. REGENERATE (anti-drift): otherwise call regeneratePort with the ORIGINAL MATERIALS + the CUMULATIVE
 *      adopted set (NEVER the prior candidate) -> the next candidate; continue to the next round.
 *
 * The candidate is handed back NON-FINAL (isFinal:false) with the full ledger, the risk-ranked escalations, the
 * cumulative adopted set, and the v1->candidate redline.
 */
export async function runExpressLoop(params: ExpressLoopParams): Promise<ExpressLoopResult> {
  const cap = clampRounds(params.maxRounds);

  // E5 owns exactly ONE tracker + ONE ledger per loop, threaded through every pass (the single mutable state).
  const tracker: ImmutabilityTracker = createImmutabilityTracker();
  const ledger: DecisionLedger = createDecisionLedger();

  const ctx: LoopContext = { documentType: params.documentType, ...(params.context ?? {}) };

  // The cumulative adopted set — what the regenerate port is fed alongside the ORIGINAL materials (anti-drift).
  const adopted: AdoptedChange[] = [];
  const roundSummaries: RoundSummary[] = [];

  let candidate = params.originalText;
  let roundsRun = 0;
  let converged = false;
  let hitCap = false;

  for (let round = 1; round <= cap; round++) {
    roundsRun = round;

    // 1) REVIEW the CURRENT candidate (the reviewer always sees the latest draft). `await` so an egress-backed
    //    (async) ReviewPort works identically to a synchronous mock; a DocumentEgressBlockedError thrown by the
    //    E6 port propagates out of runExpressLoop (the loop halts; the caller maps it to a blocked result).
    const suggestions = await params.reviewPort(candidate, ctx);

    // The protected-span catalog for THIS round's candidate (caller-supplied or derived per round).
    const protectedSpans =
      params.protectedSpans ?? deriveProtectedSpans(params.documentType, candidate, params.attorneyEnteredLegal);
    const routeCtx: RouteContext = {
      protectedSpans,
      documentText: candidate,
      definedTerms: params.definedTerms,
    };

    let adoptedThisRound = 0;
    let escalatedThisRound = 0;

    // 2) ROUTE each suggestion (E2 immutability + E3 inline), recording every decision in the ledger.
    for (const suggestion of suggestions) {
      const { effectiveRoute, routeBasis, inline } = routeOne(suggestion, tracker, routeCtx);

      const record: DecisionRecord = {
        round,
        route: effectiveRoute,
        locus: routeBasis.locus,
        classA: routeBasis.classA,
        immutabilityForced: routeBasis.immutabilityForced,
        inlineEvent: inline.event,
        beforeText: suggestion.beforeText ?? '',
        afterText: suggestion.afterText ?? '',
        offsetStart: Math.min(suggestion.targetStart, suggestion.targetEnd),
        offsetEnd: Math.max(suggestion.targetStart, suggestion.targetEnd),
        isDeletion: suggestion.isDeletion,
      };
      const entry = ledger.record(record);

      if (effectiveRoute === 'auto_adopt') {
        adoptedThisRound++;
        adopted.push({
          round,
          ledgerId: entry.id,
          beforeText: record.beforeText,
          afterText: record.afterText,
          offsetStart: record.offsetStart,
          offsetEnd: record.offsetEnd,
        });
      } else {
        escalatedThisRound++;
      }
    }

    const noAdopt = adoptedThisRound === 0;

    // 3) CONVERGENCE — a no-adopt round stops the loop (efficiency only, NEVER an approval signal).
    if (noAdopt) {
      converged = true;
      roundSummaries.push({
        round,
        suggestionCount: suggestions.length,
        adoptedCount: adoptedThisRound,
        escalatedCount: escalatedThisRound,
        noAdopt: true,
        regenerated: false,
      });
      break;
    }

    // 4) CAP — if this was the last permitted round, STOP without regenerating again.
    if (round === cap) {
      hitCap = true;
      roundSummaries.push({
        round,
        suggestionCount: suggestions.length,
        adoptedCount: adoptedThisRound,
        escalatedCount: escalatedThisRound,
        noAdopt: false,
        regenerated: false,
      });
      break;
    }

    // 5) REGENERATE (ANTI-DRIFT) — rebuild the next candidate from the ORIGINAL MATERIALS + the cumulative
    //    adopted set. The prior candidate is NEVER passed — the loop cannot compound on a drift.
    candidate = await params.regeneratePort(params.originalMaterials, adopted.slice(), ctx);
    roundSummaries.push({
      round,
      suggestionCount: suggestions.length,
      adoptedCount: adoptedThisRound,
      escalatedCount: escalatedThisRound,
      noAdopt: false,
      regenerated: true,
    });
  }

  const escalations = ledger.byRisk().filter((e) => e.route === 'escalate');
  const redline = buildRedline(params.originalText, candidate);

  return {
    candidate,
    isFinal: false,
    rounds: roundsRun,
    converged,
    hitCap,
    ledger,
    escalations,
    adopted,
    redline,
    roundSummaries,
  };
}

// ── per-suggestion routing (E2 immutability + E3 inline, combined ADDITIVELY toward escalate) ──────────

/** The combined per-suggestion routing outcome the loop records. */
interface RoutedOne {
  /** auto_adopt ONLY when E2 routed auto_adopt AND E3 raised no inline escalation; otherwise escalate. */
  effectiveRoute: RouteResult['route'];
  /** The E2 route result (locus + classA + immutabilityForced) — the audit basis recorded in the ledger. */
  routeBasis: RouteResult;
  /** The E3 inline result (its event is recorded in the ledger when one fired). */
  inline: InlineEscalationResult;
}

/**
 * Route ONE suggestion through E2 (with the shared immutability tracker) and E3 (inline), combining them
 * ADDITIVELY TOWARD ESCALATE. The single path to auto_adopt is: E2 routeWithImmutability === 'auto_adopt' AND
 * E3 inlineEscalate did NOT raise an inline escalation. Any escalation on either side -> escalate. Neither layer
 * can move an escalate toward adopt (E2 is the gate; E3 is additive-only). Pure over its inputs + the tracker.
 *
 * NOTE: routeWithImmutability is what MUTATES the tracker (records the escalation so a later round's same-span
 * re-touch is forced to escalate). We call it FIRST so the tracker is updated even when E3 would also escalate.
 */
function routeOne(
  suggestion: LoopSuggestion,
  tracker: ImmutabilityTracker,
  ctx: RouteContext,
): RoutedOne {
  // E2 — the gate + immutability tracker (this is the call that updates the tracker on an escalate).
  const routeBasis = routeWithImmutability(suggestion, tracker, ctx);

  // E3 — additive inline near-boundary / confidence escalation over the SAME ctx + the suggestion's signal.
  const inline = inlineEscalate(suggestion, ctx, suggestion.classifierSignal);

  const effectiveRoute: RouteResult['route'] =
    routeBasis.route === 'auto_adopt' && !inline.escalateInline ? 'auto_adopt' : 'escalate';

  return { effectiveRoute, routeBasis, inline };
}

// ── protected-span derivation (per round, when the caller does not pin a catalog) ──────────────────────

/**
 * Derive the protected-span catalog for a round's candidate (when the caller does not pin a fixed catalog).
 * A tiny, explicit indirection so the loop's per-round catalog source is named and a future doc-type override
 * slots here. Pure — just the deterministic E1 recognizer pass over the candidate text.
 */
function deriveProtectedSpans(
  documentType: DocumentType,
  candidate: string,
  attorneyEnteredLegal?: string | null,
): readonly ProtectedSpan[] {
  // G10: for a deed carrying an attorney-entered VERBATIM legal, register that exact legal as a locked
  // legal_description span IN ADDITION to the recognizer pass — the operator-re-ratified red line the model
  // (revise/regenerate) can never touch. Absent an attorney-entered legal, this is byte-identical to the pass.
  if (documentType === 'deed' && (attorneyEnteredLegal ?? '').trim().length > 0) {
    return buildDeedProtectedSpans(candidate, attorneyEnteredLegal);
  }
  return buildProtectedSpans(documentType, candidate);
}
