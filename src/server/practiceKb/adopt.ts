/**
 * Adopt a practice memo into a matter / work product — FOLD-KB-1 Increment 2 (Fork A).
 *
 * This is the EXPLICIT attorney "authorize-use" act (the egress moment). It runs the
 * abstraction-required access gate, then transactionally: records durable provenance
 * (kb_adoptions), writes a fail-visible audit_events disposition on the TARGET matter, and —
 * when the adopted memo is not attorney-verified-current and a document is named — sets the
 * durable documents.drewOnUnverifiedKb flag that SURVIVES versioning (FOLD-SEND-1 reads it).
 *
 * Enforcement is at the ARTIFACT/MATTER level, not by tracking memo text through the model.
 */

import { TRPCError } from '@trpc/server';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { getPracticeMemoById } from '../db/queries/practiceMemos.js';
import { insertKbAdoption } from '../db/queries/kbAdoptions.js';
import { setDrewOnUnverifiedKb } from '../db/queries/documents.js';
import { insertAuditEvent } from '../db/queries/auditEvents.js';
import { evaluateMemoAccess } from './gate.js';
import type { MemoAccessDecision } from '../../shared/schemas/practiceKb.js';

export interface AdoptMemoResult {
  decision: MemoAccessDecision;
  adoptionId: string;
  drewOnUnverifiedKb: boolean;
}

/**
 * Adopt a memo into a target matter (optionally a specific document). Owner-scoped.
 * Throws NOT_FOUND if the memo is not owned; throws FORBIDDEN (KB_MEMO_ACCESS_BLOCKED) if
 * the access gate denies (a raw / matter_only memo cannot cross into another matter).
 */
export async function adoptMemoIntoMatter(params: {
  memoId: string;
  targetMatterId: string;
  userId: string;
  documentId?: string | null;
  rationale?: string | null;
}): Promise<AdoptMemoResult> {
  const memo = await getPracticeMemoById(params.memoId, params.userId);
  if (!memo) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Practice memo not found' });
  }

  const decision = evaluateMemoAccess({
    memo: { originMatterId: memo.originMatterId, reuseScope: memo.reuseScope, abstractionStatus: memo.abstractionStatus },
    targetMatterId: params.targetMatterId,
  });
  if (!decision.allowed) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `KB_MEMO_ACCESS_BLOCKED: ${decision.reason}` });
  }

  // "Unverified" for outbound purposes = anything not attorney-verified-current.
  const isVerifiedCurrent = memo.verificationStatus === 'attorney_verified_current';
  const drewOnUnverifiedKb = !isVerifiedCurrent;
  const documentId = params.documentId ?? null;
  const eventId = uuidv4();
  const adoptionId = uuidv4();

  await db.transaction(async (tx) => {
    await insertAuditEvent(
      {
        id: eventId,
        userId: params.userId,
        matterId: params.targetMatterId,
        documentId,
        eventType: 'disposition',
        actor: 'attorney',
        summary: `Adopted practice memo "${memo.title}" into matter`,
        targetType: 'practice_memo',
        targetId: memo.id,
        action: 'memo_adopted_into_matter',
        rationale: params.rationale ?? null,
        scope: 'matter',
        payload: {
          crossMatter: decision.crossMatter,
          reason: decision.reason,
          verificationStatusAtAdoption: memo.verificationStatus,
          drewOnUnverifiedKb,
        },
      },
      tx,
    );
    await insertKbAdoption(
      {
        userId: params.userId,
        matterId: params.targetMatterId,
        documentId,
        kbMemoId: memo.id,
        kbMemoUpdatedAtAtAdoption: memo.updatedAt,
        verificationStatusAtAdoption: memo.verificationStatus,
        lastVerifiedAtAtAdoption: memo.lastVerifiedAt,
        currencyVerifiedForOutbound: isVerifiedCurrent,
        adoptedByEventId: eventId,
      },
      tx,
    );
    // Durable artifact-level flag — only ever latched TRUE, only when a document is named.
    if (documentId && drewOnUnverifiedKb) {
      await setDrewOnUnverifiedKb(documentId, params.userId, tx);
    }
  });

  return { decision, adoptionId, drewOnUnverifiedKb };
}
