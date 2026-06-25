/**
 * approvalGate.ts — EXPRESS-AUTO-REVIEW-LOOP-1 E7a: the ATTORNEY-APPROVAL STRUCTURAL INERTNESS guard.
 *
 * E7a is the structural guarantee that an Express loop candidate is NEVER treated as final / sendable /
 * fileable / recordable until the attorney has reviewed the escalations and AFFIRMATIVELY, COMPLETELY approved.
 * It is a PURE PREDICATE DERIVED FROM LOOP STATE (the E5/E4a ExpressLoopResult) — there is NO persistence, NO
 * table, NO column, NO migration, NO egress, NO new dependency here.
 *
 * THE STRUCTURAL INERTNESS (build spec §E7; E8 §5):
 *   - An Express candidate is STRUCTURALLY NON-FINAL by construction: E5 hands back isFinal:false and this guard
 *     re-asserts it — there is NO code path in this module by which an Express candidate becomes final/sendable.
 *   - The attorney CANNOT mark the candidate ready (`canApprove === false`) while there is any unresolved
 *     escalation, or the loop hit the round cap with escalations still pending. The candidate is inert until
 *     EVERY escalation has an explicit attorney disposition.
 *   - recordAttorneyApproval returns approved ONLY when EVERY escalation carries an explicit attorney decision
 *     (adopt | reject). Silence / a missing decision / a default / an implicit "OK" is NEVER an approval —
 *     a single un-dispositioned escalation keeps the candidate inert.
 *
 * THE SPLIT (the durable attestation is the DEFERRED, migration-gated E7b — NOT this increment):
 *   - E7a (THIS module) is the IN-MEMORY STRUCTURAL PREDICATE ONLY: pure functions over the loop result + the
 *     attorney's in-memory decisions. No persistence — it does NOT record or store the approval anywhere.
 *   - E7b (DEFERRED) is the DURABLE APPROVAL ATTESTATION record (who/when/which escalations) persisted to the
 *     DB. If anything here is tempted to WRITE the approval — a table, a row, a query, a migration — that is
 *     E7b; STOP and surface it. This module only COMPUTES whether approval is structurally possible/complete.
 *
 * PURE + deterministic + no-egress + flag-dark. Same inputs -> byte-identical result. Flag-dark with the rest
 * of Express (AUTO_REVIEW_LOOP_ENABLED default OFF); nothing here is wired into a live procedure in E7a.
 */

import type { ExpressLoopResult } from './reviewLoop.js';
import type { LedgerEntry } from './decisionLedger.js';

// ── the attorney's explicit per-escalation decision ────────────────────────────────────────────────────

/**
 * The ONLY two affirmative dispositions an attorney can take on an escalation. Both are EXPLICIT acts — there is
 * deliberately NO 'pending' / 'default' / 'skip' member, because the absence of a decision is NOT a decision and
 * must never count toward approval. (An escalation with no entry in the decisions map is un-dispositioned.)
 */
export type AttorneyDecision = 'adopt' | 'reject';

/**
 * The attorney's in-memory dispositions, keyed by the escalation's stable ledger-entry id (LedgerEntry.id). A
 * map (not a list) so a missing key is unambiguously "no decision was made for this escalation". Pure data —
 * E7a never persists it; the caller holds it in memory while the attorney triages.
 */
export type AttorneyDecisions = Readonly<Record<string, AttorneyDecision>>;

// ── the structural approval evaluation (pure predicate over loop state) ─────────────────────────────────

/** The structural approval posture of an Express candidate, derived purely from the loop result. */
export interface ExpressApprovalEvaluation {
  /**
   * Whether the attorney is STRUCTURALLY PERMITTED to mark the candidate ready. FALSE while any escalation is
   * unresolved or the loop hit the round cap with escalations pending. This is the can't-finalize-yet gate —
   * it does NOT itself approve anything (recordAttorneyApproval does that, and only on a COMPLETE decision set).
   */
  canApprove: boolean;
  /**
   * Always false. An Express candidate is structurally non-final — there is no value of the loop state that
   * makes this true. Re-asserted here so a consumer reading the guard (not just the loop result) sees the
   * structural truth in one place.
   */
  isFinal: false;
  /** Plain-English reasons the candidate cannot yet be approved (empty iff canApprove is true). */
  blockingReasons: string[];
  /** The unresolved escalations, risk-ranked (the attorney's triage view) — every escalation in the result. */
  unresolvedEscalations: LedgerEntry[];
}

/**
 * EVALUATE the structural approval posture of an Express loop result. PURE over the result — no persistence,
 * no egress, no mutation of the input.
 *
 * RULES (build spec §E7):
 *   - The candidate is structurally non-final (isFinal:false) regardless of state.
 *   - canApprove is FALSE while there is ANY unresolved escalation. Every escalation in the result is, by
 *     construction, unresolved at evaluation time — the loop surfaces escalations precisely BECAUSE no
 *     attorney has dispositioned them; the only way to resolve them is recordAttorneyApproval with a complete
 *     decision set. So canApprove === (no escalations exist).
 *   - The round-cap-with-pending-escalations case is called out as its own blocking reason (the loop stopped
 *     for efficiency, NOT because the work was approved — convergence/cap is NEVER an approval signal).
 *
 * The escalations are taken straight from the loop result's risk-ranked `escalations` (E4a byRisk over the
 * 'escalate' entries), so the triage order is the deterministic E4a order.
 */
export function evaluateExpressApproval(loopResult: ExpressLoopResult): ExpressApprovalEvaluation {
  // The unresolved escalations ARE the loop's surfaced escalations (risk-ranked); copy defensively so a
  // consumer can never mutate the loop result through this view.
  const unresolvedEscalations: LedgerEntry[] = loopResult.escalations.slice();

  const blockingReasons: string[] = [];

  if (unresolvedEscalations.length > 0) {
    blockingReasons.push(
      `${unresolvedEscalations.length} escalation(s) require an explicit attorney decision (adopt or reject) ` +
        'before this draft can proceed. Silence, timeout, or loop-completion is not approval.',
    );
    // The cap-with-pending case: the loop stopped because it hit the round cap, NOT because the candidate was
    // accepted. Surface it explicitly so a "the loop finished" reading can never be mistaken for "approved".
    if (loopResult.hitCap) {
      blockingReasons.push(
        'The loop stopped at the round cap with escalations still pending — reaching the cap is an efficiency ' +
          'limit, never a quality or approval signal. Each pending escalation still needs an attorney decision.',
      );
    }
  }

  const canApprove = unresolvedEscalations.length === 0;

  return {
    canApprove,
    isFinal: false,
    blockingReasons,
    unresolvedEscalations,
  };
}

// ── the affirmative, COMPLETE attorney sign-off (pure; no persistence) ──────────────────────────────────

/** The result of an attempted attorney sign-off over a loop result + the attorney's explicit decisions. */
export interface AttorneyApprovalResult {
  /**
   * TRUE only when EVERY escalation in the loop result carries an explicit attorney decision (adopt | reject).
   * A single missing / un-dispositioned escalation -> false. There is NO implicit or default approval path.
   */
  approved: boolean;
  /** Plain-English reason for the outcome (why approval did or did not complete). */
  reason: string;
  /** The ledger-entry ids of escalations still missing an explicit decision (empty iff approved is true). */
  undispositionedEscalationIds: string[];
}

/**
 * RECORD (compute, NOT persist) the attorney's affirmative sign-off over an Express loop result. PURE — it does
 * NOT write anything anywhere; it ONLY decides whether the supplied decisions constitute a COMPLETE, explicit
 * sign-off. (The durable attestation record is the DEFERRED E7b; this function never touches a DB.)
 *
 * approved === true REQUIRES that EVERY escalation in the loop result has an explicit AttorneyDecision in
 * `attorneyDecisions`. Specifically:
 *   - every escalation id is a key in the decisions map, AND
 *   - each mapped value is exactly 'adopt' or 'reject' (a defensive check — a malformed value is treated as
 *     no decision, never as an implicit approval).
 * A missing key for any escalation -> NOT approved (the un-dispositioned ids are returned). This is the
 * structural inertness: no code path yields a "final/sendable" Express candidate without this complete,
 * affirmative, per-escalation attorney sign-off. The empty-escalations case approves (there is nothing left to
 * disposition) — but note evaluateExpressApproval already reports canApprove there; this function is the act.
 */
export function recordAttorneyApproval(
  loopResult: ExpressLoopResult,
  attorneyDecisions: AttorneyDecisions,
): AttorneyApprovalResult {
  const escalations = loopResult.escalations;

  // Find every escalation that lacks an EXPLICIT, valid decision. A missing key, or any value that is not
  // exactly 'adopt'/'reject', counts as un-dispositioned — never as an implicit approval.
  const undispositionedEscalationIds: string[] = [];
  for (const esc of escalations) {
    const decision = Object.prototype.hasOwnProperty.call(attorneyDecisions, esc.id)
      ? attorneyDecisions[esc.id]
      : undefined;
    if (decision !== 'adopt' && decision !== 'reject') {
      undispositionedEscalationIds.push(esc.id);
    }
  }

  if (undispositionedEscalationIds.length > 0) {
    return {
      approved: false,
      reason:
        `${undispositionedEscalationIds.length} of ${escalations.length} escalation(s) lack an explicit ` +
        'attorney decision. Approval requires an affirmative adopt-or-reject on EVERY escalation; a missing ' +
        'decision is never an implicit approval.',
      undispositionedEscalationIds,
    };
  }

  return {
    approved: true,
    reason:
      escalations.length === 0
        ? 'No escalations were raised; the attorney has affirmatively signed off. (The candidate remains a ' +
          'non-final Express candidate until a durable approval attestation is recorded — deferred E7b.)'
        : `All ${escalations.length} escalation(s) carry an explicit attorney decision (adopt or reject); ` +
          'the attorney has affirmatively, completely signed off.',
    undispositionedEscalationIds: [],
  };
}
