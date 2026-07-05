/**
 * titleExamDecisions.ts — TITLE-EXAM-1 (T4), the attorney ADOPT/MODIFY/HOLD decision logging for escalated
 * title-exam findings (NC-1).
 *
 * FORK-C (FOLD-L1-1): audit_events is the SINGLE source of truth for attorney DECISIONS. A per-finding
 * disposition writes, in ONE transaction: (a) an audit_events disposition row (the deciding act), and (b) an
 * update to the finding row's escalationState + decisionEventId pointer (operational STATE). No competing
 * decision record; no update/delete of the audit row (a changed disposition is a NEW audit row).
 *
 * DORMANT: nothing calls this unless TITLE_EXAM_ENABLED is ON (default OFF). Owner-scoped via ownerScope().
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../connection.js';
import { titleExamFinding } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { insertAuditEvent } from './auditEvents.js';

/** A tx handle able to insert (for the audit event) AND update (for the finding row). */
type DecisionExecutor = Pick<typeof db, 'insert' | 'update'>;

export type FindingDisposition = 'adopt' | 'modify' | 'hold';

const DISPOSITION_TO_STATE: Record<FindingDisposition, 'adopted' | 'modified' | 'held'> = {
  adopt: 'adopted',
  modify: 'modified',
  hold: 'held',
};

const DISPOSITION_VERB: Record<FindingDisposition, string> = {
  adopt: 'adopted',
  modify: 'adopted with modifications',
  hold: 'held (deferred)',
};

export interface FindingDecisionInput {
  userId: string;
  matterId: string;
  findingId: string;
  disposition: FindingDisposition;
  /** Attorney rationale (provenance; flows to audit_events.rationale). */
  rationale?: string | null;
  /** For a MODIFY, the attorney's adopted language (kept in the audit payload, not silently applied). */
  modifiedText?: string | null;
  /** The exam session id, for the audit payload. */
  sessionId?: string | null;
}

/** Build the audit_events payload for one finding disposition (pure; Fork-C disposition row). */
export function buildFindingDecisionAuditEvent(
  input: FindingDecisionInput & { findingTitle?: string },
): Parameters<typeof insertAuditEvent>[0] {
  return {
    userId: input.userId,
    matterId: input.matterId,
    eventType: 'disposition',
    actor: 'attorney',
    summary: `Title-exam finding ${input.findingId}${input.findingTitle ? ` ("${input.findingTitle}")` : ''} ${DISPOSITION_VERB[input.disposition]} by attorney`,
    targetType: 'title_exam_finding',
    targetId: input.findingId,
    action: input.disposition,
    rationale: input.rationale ?? null,
    scope: 'matter',
    payload: {
      sessionId: input.sessionId ?? null,
      disposition: input.disposition,
      modifiedText: input.disposition === 'modify' ? (input.modifiedText ?? null) : null,
    },
  };
}

/** Write the disposition audit row + update the finding's escalationState + decisionEventId, in ONE tx.
 *  Exported for a mock-tx unit test. */
export async function writeFindingDecisionTx(
  tx: DecisionExecutor,
  input: FindingDecisionInput & { findingTitle?: string },
): Promise<{ decisionEventId: string }> {
  const decisionEventId = await insertAuditEvent(buildFindingDecisionAuditEvent(input), tx);
  await tx
    .update(titleExamFinding)
    .set({
      escalationState: DISPOSITION_TO_STATE[input.disposition],
      decisionEventId,
    })
    .where(and(ownerScope(titleExamFinding.userId, input.userId), eq(titleExamFinding.id, input.findingId)));
  return { decisionEventId };
}

/**
 * Record the attorney's logged ADOPT/MODIFY/HOLD for one escalated finding. Fail-visible (throws on write
 * error) — a title-finding disposition is a material supervision decision that must never be silently dropped.
 * Returns the audit_events id (the decision source of truth) and the resulting finding escalationState.
 */
export async function recordFindingDecision(
  input: FindingDecisionInput & { findingTitle?: string },
): Promise<{ decisionEventId: string; escalationState: 'adopted' | 'modified' | 'held' }> {
  const { decisionEventId } = await db.transaction(async (tx) => writeFindingDecisionTx(tx, input));
  return { decisionEventId, escalationState: DISPOSITION_TO_STATE[input.disposition] };
}
