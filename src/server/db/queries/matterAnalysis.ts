/**
 * matter_analysis query wrapper — FOLD-L0-1 (Fork C/F + the plan-lock conflicts gate).
 *
 * Ch 35.1 Zod Wall; owner-scoped via ownerScope(). The analysis is internal work-product,
 * categorically NON-SENDABLE by type (Fork F columns set at insert). Plan lock is an
 * EXPLICIT attorney act (audit_events disposition) and is GATED (Fork A): a conflict check
 * must have run and ALL its hits must be dispositioned before a plan can lock. Locking also
 * sets the matter's orthogonal analysisStatus to 'plan_locked' (Fork D).
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc, ne } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../connection.js';
import { matterAnalysis, matters, type MatterAnalysisStatus } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { insertAuditEvent } from './auditEvents.js';
import { allHitsDispositionedForLatest } from './conflicts.js';
import {
  MatterAnalysisRowSchema,
  type MatterAnalysisRow,
} from '../../../shared/schemas/layer0.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseRow(raw: unknown, userId: string): MatterAnalysisRow {
  try {
    return MatterAnalysisRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry('zod_parse_failed', { schemaName: 'MatterAnalysisRowSchema', tableName: 'matter_analysis', errorPath: err.errors[0]?.path.join('.') ?? '', errorMessage: err.errors[0]?.message ?? 'ZodError' }, { userId, matterId: null, documentId: null, jobId: null });
    }
    throw err;
  }
}

/** Set the matter's orthogonal Layer-0 analysisStatus (Fork D), owner-scoped. */
export async function setMatterAnalysisStatus(matterId: string, userId: string, status: MatterAnalysisStatus): Promise<void> {
  await db.update(matters).set({ analysisStatus: status }).where(and(eq(matters.id, matterId), ownerScope(matters.userId, userId)));
}

export async function insertMatterAnalysis(data: {
  id?: string;
  userId: string;
  matterId: string;
  modelLane?: 'single' | 'multi';
  assessment?: unknown;
  plan?: unknown;
  openQuestions?: unknown;
  recommendedDocuments?: unknown;
  generatedByJobId?: string | null;
}): Promise<MatterAnalysisRow> {
  const id = data.id ?? uuidv4();
  await db.insert(matterAnalysis).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    status: 'draft',
    assessment: (data.assessment ?? null) as never,
    plan: (data.plan ?? null) as never,
    openQuestions: (data.openQuestions ?? null) as never,
    recommendedDocuments: (data.recommendedDocuments ?? null) as never,
    modelLane: data.modelLane ?? 'single',
    generatedByJobId: data.generatedByJobId ?? null,
    // Fork F — non-sendable defaults are the DB defaults; set explicitly for clarity.
    artifactKind: 'matter_analysis',
    outboundEligible: false,
    sendabilityRequired: false,
    sendabilityStatus: 'not_applicable',
  });
  // Moving into analysis (Fork D) — only advance from 'none' (don't clobber 'plan_locked').
  await db
    .update(matters)
    .set({ analysisStatus: 'in_analysis' })
    .where(and(eq(matters.id, data.matterId), ownerScope(matters.userId, data.userId), eq(matters.analysisStatus, 'none')));
  const row = await getMatterAnalysisById(id, data.userId);
  if (!row) throw new Error(`insertMatterAnalysis: row not found after insert (id=${id})`);
  return row;
}

export async function getMatterAnalysisById(id: string, userId: string): Promise<MatterAnalysisRow | null> {
  const rows = await db.select().from(matterAnalysis).where(and(eq(matterAnalysis.id, id), ownerScope(matterAnalysis.userId, userId))).limit(1);
  if (rows.length === 0) return null;
  return parseRow(rows[0]!, userId);
}

export async function listAnalysisForMatter(matterId: string, userId: string): Promise<MatterAnalysisRow[]> {
  const rows = await db
    .select()
    .from(matterAnalysis)
    .where(and(ownerScope(matterAnalysis.userId, userId), eq(matterAnalysis.matterId, matterId)))
    .orderBy(desc(matterAnalysis.createdAt));
  return rows.map((r) => parseRow(r, userId));
}

/** Latest non-superseded analysis for a matter. */
export async function getActiveAnalysisForMatter(matterId: string, userId: string): Promise<MatterAnalysisRow | null> {
  const rows = await db
    .select()
    .from(matterAnalysis)
    .where(and(ownerScope(matterAnalysis.userId, userId), eq(matterAnalysis.matterId, matterId), ne(matterAnalysis.status, 'superseded')))
    .orderBy(desc(matterAnalysis.createdAt))
    .limit(1);
  if (rows.length === 0) return null;
  return parseRow(rows[0]!, userId);
}

/**
 * Lock the plan (explicit attorney act). GATED (Fork A): a conflict check must have run and
 * all of its hits must be dispositioned; otherwise throws (the matter is not blocked — a
 * recorded decision is required). Writes the lock + audit transactionally and sets the
 * matter analysisStatus to 'plan_locked' (Fork D).
 */
export async function lockPlan(params: { analysisId: string; userId: string; rationale?: string | null }): Promise<MatterAnalysisRow> {
  const a = await getMatterAnalysisById(params.analysisId, params.userId);
  if (!a) throw new TRPCError({ code: 'NOT_FOUND', message: 'Analysis not found' });
  if (a.status !== 'draft') throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot lock a ${a.status} analysis` });

  const gate = await allHitsDispositionedForLatest(a.matterId, params.userId);
  if (!gate) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CONFLICTS_NOT_CHECKED: run the conflicts check before locking a plan.' });
  if (!gate.ok) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CONFLICTS_UNDISPOSITIONED: every conflict hit must be dispositioned before locking a plan.' });

  const eventId = uuidv4();
  await db.transaction(async (tx) => {
    await insertAuditEvent(
      {
        id: eventId,
        userId: params.userId,
        matterId: a.matterId,
        eventType: 'disposition',
        actor: 'attorney',
        summary: 'Plan locked (Layer-0 plan-only closure)',
        targetType: 'matter_analysis',
        targetId: params.analysisId,
        action: 'lock_plan',
        rationale: params.rationale ?? null,
        scope: 'matter',
      },
      tx,
    );
    await tx
      .update(matterAnalysis)
      .set({
        status: 'locked',
        lockedByEventId: eventId,
        lockedAt: new Date(),
        lockRationale: params.rationale ?? null,
        conflictCheckId: gate.checkId,
        conflictsClearedForPlanning: true,
      })
      .where(and(eq(matterAnalysis.id, params.analysisId), ownerScope(matterAnalysis.userId, params.userId)));
    await tx
      .update(matters)
      .set({ analysisStatus: 'plan_locked' })
      .where(and(eq(matters.id, a.matterId), ownerScope(matters.userId, params.userId)));
  });

  const updated = await getMatterAnalysisById(params.analysisId, params.userId);
  if (!updated) throw new Error('lockPlan: analysis not found after lock');
  return updated;
}

/**
 * Supersede a locked/draft analysis (e.g., reopen). Caller should re-run the conflict
 * check afterward (currency: point-in-time checks go stale once new matters exist).
 */
export async function supersedeAnalysis(params: { analysisId: string; userId: string; supersededById?: string | null }): Promise<void> {
  await db
    .update(matterAnalysis)
    .set({ status: 'superseded', supersededById: params.supersededById ?? null })
    .where(and(eq(matterAnalysis.id, params.analysisId), ownerScope(matterAnalysis.userId, params.userId)));
}
