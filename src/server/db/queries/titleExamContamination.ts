/**
 * titleExamContamination.ts — TITLE-EXAM-1 (T5), the attorney IMPORT / DO-NOT-IMPORT resolution logging for
 * NC-7 contamination-flagged seed findings.
 *
 * FORK-C: the import decision is a logged attorney act — one audit_events disposition row + an update to the
 * finding's importJustification / importResolved / seedContaminationFlag (the block clears), in ONE tx. The
 * validation (import requires a non-empty justification) is the pure contaminationGuard.resolveImport.
 *
 * DORMANT unless TITLE_EXAM_ENABLED is ON. Owner-scoped via ownerScope().
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../connection.js';
import { titleExamFinding } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { insertAuditEvent } from './auditEvents.js';
import { resolveImport, type ImportDecision } from '../../titleExam/contaminationGuard.js';

type DecisionExecutor = Pick<typeof db, 'insert' | 'update'>;

export interface ImportResolutionInput {
  userId: string;
  matterId: string;
  findingId: string;
  sessionId?: string | null;
  decision: ImportDecision;
  /** Required (non-empty) for 'import'; optional context for 'do_not_import'. */
  justification?: string | null;
  findingTitle?: string;
}

/** Build the audit_events payload for one import resolution (pure; Fork-C disposition row). */
export function buildImportResolutionAuditEvent(
  input: ImportResolutionInput & { resolvedJustification: string },
): Parameters<typeof insertAuditEvent>[0] {
  return {
    userId: input.userId,
    matterId: input.matterId,
    eventType: 'disposition',
    actor: 'attorney',
    summary: `Title-exam seed finding ${input.findingId}${input.findingTitle ? ` ("${input.findingTitle}")` : ''} ${input.decision === 'import' ? 'imported (justified)' : 'marked do-not-import'} by attorney`,
    targetType: 'title_exam_finding',
    targetId: input.findingId,
    action: input.decision,
    rationale: input.resolvedJustification,
    scope: 'matter',
    payload: { sessionId: input.sessionId ?? null, decision: input.decision },
  };
}

/** Validate + write the import resolution audit row + clear the finding's contamination block, in ONE tx.
 *  Exported for a mock-tx unit test. Throws (via resolveImport) if 'import' lacks a justification. */
export async function writeImportResolutionTx(
  tx: DecisionExecutor,
  input: ImportResolutionInput,
): Promise<{ decisionEventId: string; importJustification: string }> {
  const resolution = resolveImport(input.decision, input.justification);
  const decisionEventId = await insertAuditEvent(
    buildImportResolutionAuditEvent({ ...input, resolvedJustification: resolution.importJustification }),
    tx,
  );
  await tx
    .update(titleExamFinding)
    .set({
      importJustification: resolution.importJustification,
      importResolved: true,
      seedContaminationFlag: false,
      decisionEventId,
    })
    .where(and(ownerScope(titleExamFinding.userId, input.userId), eq(titleExamFinding.id, input.findingId)));
  return { decisionEventId, importJustification: resolution.importJustification };
}

/**
 * Record the attorney's import / do-not-import resolution for a contamination-flagged seed finding.
 * Fail-visible. Returns the audit_events id (decision source of truth) and the recorded justification.
 */
export async function recordImportResolution(
  input: ImportResolutionInput,
): Promise<{ decisionEventId: string; importJustification: string }> {
  return db.transaction(async (tx) => writeImportResolutionTx(tx, input));
}
