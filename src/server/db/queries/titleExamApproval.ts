/**
 * titleExamApproval.ts — TITLE-EXAM-1 (T6), the durable Approve-for-Client-Delivery attestation (NC-3).
 *
 * Records the attorney's distinct, logged Approve-for-Client-Delivery act: in ONE transaction, (a) an
 * audit_events approval row (Fork-C — the deciding act, the decision source of truth) and (b) the durable
 * attestation row (operational STATE + the version-lock hash + a pointer to the audit row). Client-facing
 * artifacts are generated (in clientDelivery.ts) ONLY from the approved, version-locked memo behind this act.
 * There is NO send path — the artifacts are drafts the attorney transports.
 *
 * DORMANT unless TITLE_EXAM_ENABLED is ON. Owner-scoped reads route through ownerScope().
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../connection.js';
import { titleExamClientDeliveryApproval, type TitleExamClientDeliveryApproval } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { insertAuditEvent } from './auditEvents.js';
import { buildMemoVersionHash, type ClientDeliveryApproval } from '../../titleExam/clientDelivery.js';

type Executor = Pick<typeof db, 'insert'>;

export interface RecordClientDeliveryApprovalInput {
  userId: string;
  matterId: string;
  sessionId: string;
  documentId?: string | null;
  /** The exact approved memo text — hashed for the NC-3b version-lock. */
  approvedMemoText: string;
  approval: ClientDeliveryApproval;
}

/** Build the audit_events payload for the Approve-for-Client-Delivery act (pure; Fork-C disposition row). */
export function buildClientDeliveryApprovalAuditEvent(
  input: RecordClientDeliveryApprovalInput & { memoVersionHash: string },
): Parameters<typeof insertAuditEvent>[0] {
  return {
    userId: input.userId,
    matterId: input.matterId,
    documentId: input.documentId ?? null,
    eventType: 'disposition',
    actor: 'attorney',
    summary: `Title-exam memo approved for client delivery (hat: ${input.approval.hat}; recipient: ${input.approval.recipientClass}; posture: ${input.approval.posture})`,
    targetType: 'title_exam_client_delivery',
    targetId: input.sessionId,
    action: 'approve_for_client_delivery',
    rationale: `advice-permitted: ${input.approval.advicePermitted}; caveats: ${input.approval.caveats.length}; exclusions: ${input.approval.exclusions.length}`,
    scope: 'matter',
    payload: {
      hat: input.approval.hat,
      recipientClass: input.approval.recipientClass,
      posture: input.approval.posture,
      advicePermitted: input.approval.advicePermitted,
      caveats: input.approval.caveats,
      exclusions: input.approval.exclusions,
      memoVersionHash: input.memoVersionHash,
    },
  };
}

/** Write the approval audit row + the durable attestation row, in ONE tx. Exported for a mock-tx unit test. */
export async function writeClientDeliveryApprovalTx(
  tx: Executor,
  input: RecordClientDeliveryApprovalInput & { attestationId: string; memoVersionHash: string },
): Promise<{ approvalEventId: string }> {
  const approvalEventId = await insertAuditEvent(
    buildClientDeliveryApprovalAuditEvent(input),
    tx,
  );
  await tx.insert(titleExamClientDeliveryApproval).values({
    id: input.attestationId,
    sessionId: input.sessionId,
    userId: input.userId,
    matterId: input.matterId,
    attorneyUserId: input.approval.attorneyUserId,
    memoVersionHash: input.memoVersionHash,
    hat: input.approval.hat,
    recipientClass: input.approval.recipientClass,
    posture: input.approval.posture,
    advicePermitted: input.approval.advicePermitted,
    caveats: input.approval.caveats,
    exclusions: input.approval.exclusions,
    approvalEventId,
  });
  return { approvalEventId };
}

/**
 * Record one Approve-for-Client-Delivery act. Fail-visible. Returns the attestation id, the audit_events
 * approval id (decision source of truth), and the version-lock hash the client artifacts must be generated
 * against.
 */
export async function recordClientDeliveryApproval(
  input: RecordClientDeliveryApprovalInput,
): Promise<{ attestationId: string; approvalEventId: string; memoVersionHash: string }> {
  const memoVersionHash = buildMemoVersionHash(input.approvedMemoText);
  const attestationId = uuidv4();
  const { approvalEventId } = await db.transaction(async (tx) =>
    writeClientDeliveryApprovalTx(tx, { ...input, attestationId, memoVersionHash }),
  );
  return { attestationId, approvalEventId, memoVersionHash };
}

/** The matter's client-delivery approvals, owner-scoped, newest first. */
export async function listClientDeliveryApprovalsForMatter(
  matterId: string,
  userId: string,
): Promise<TitleExamClientDeliveryApproval[]> {
  return db
    .select()
    .from(titleExamClientDeliveryApproval)
    .where(
      and(
        ownerScope(titleExamClientDeliveryApproval.userId, userId),
        eq(titleExamClientDeliveryApproval.matterId, matterId),
      ),
    )
    .orderBy(desc(titleExamClientDeliveryApproval.createdAt));
}
