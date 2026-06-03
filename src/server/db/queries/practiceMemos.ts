/**
 * practice_memos query wrapper — FOLD-KB-1 (Increment 1: insert + owner-scoped reads).
 *
 * Ch 35.1 Zod Wall; owner-scoped via ownerScope(). CAPTURE IS ALWAYS THE MOST-PRIVATE
 * POSTURE (Fork G): a newly filed memo is client_confidential / raw / matter_only /
 * unverified — the insert does not accept a less-private posture. Abstraction, promotion to
 * firm-wide reuse, and re-verification are explicit, audited attorney acts added in
 * Increment 2 (they require an audit_events disposition). The cross-matter access gate lives
 * in server/practiceKb/gate.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../connection.js';
import { practiceMemos } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  PracticeMemoRowSchema,
  type PracticeMemoRow,
  type LawReliedOnEntry,
} from '../../../shared/schemas/practiceKb.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseRow(raw: unknown, userId: string): PracticeMemoRow {
  try {
    return PracticeMemoRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry('zod_parse_failed', { schemaName: 'PracticeMemoRowSchema', tableName: 'practice_memos', errorPath: err.errors[0]?.path.join('.') ?? '', errorMessage: err.errors[0]?.message ?? 'ZodError' }, { userId, matterId: null, documentId: null, jobId: null });
    }
    throw err;
  }
}

/**
 * File a new practice memo. ALWAYS captured most-private (client_confidential / raw /
 * matter_only / unverified) — promotion is a separate gated act. The procedure layer
 * (Increment 2) additionally requires lawReliedOn + jurisdiction for a conclusion memo.
 */
export async function insertPracticeMemo(data: {
  id?: string;
  userId: string;
  originMatterId?: string | null;
  sourceAnalysisId?: string | null;
  sourceDocumentId?: string | null;
  title: string;
  body: string;
  practiceArea?: string | null;
  jurisdiction?: string | null;
  lawReliedOn?: LawReliedOnEntry[] | null;
  topicTags?: string[] | null;
  writtenOn?: Date | null;
}): Promise<PracticeMemoRow> {
  const id = data.id ?? uuidv4();
  await db.insert(practiceMemos).values({
    id,
    userId: data.userId,
    originMatterId: data.originMatterId ?? null,
    sourceAnalysisId: data.sourceAnalysisId ?? null,
    sourceDocumentId: data.sourceDocumentId ?? null,
    title: data.title,
    body: data.body,
    practiceArea: data.practiceArea ?? null,
    jurisdiction: data.jurisdiction ?? null,
    lawReliedOn: (data.lawReliedOn ?? null) as never,
    topicTags: (data.topicTags ?? null) as never,
    writtenOn: data.writtenOn ?? null,
    // Most-private posture — never overridable at capture (Fork G).
    verificationStatus: 'unverified',
    privilegeTag: 'client_confidential',
    abstractionStatus: 'raw',
    reuseScope: 'matter_only',
  });
  const row = await getPracticeMemoById(id, data.userId);
  if (!row) throw new Error(`insertPracticeMemo: row not found after insert (id=${id})`);
  return row;
}

export async function getPracticeMemoById(id: string, userId: string): Promise<PracticeMemoRow | null> {
  const rows = await db.select().from(practiceMemos).where(and(eq(practiceMemos.id, id), ownerScope(practiceMemos.userId, userId))).limit(1);
  if (rows.length === 0) return null;
  return parseRow(rows[0]!, userId);
}

/** Memos derived from a specific origin matter (owner-scoped). */
export async function listMemosForOriginMatter(originMatterId: string, userId: string): Promise<PracticeMemoRow[]> {
  const rows = await db
    .select()
    .from(practiceMemos)
    .where(and(ownerScope(practiceMemos.userId, userId), eq(practiceMemos.originMatterId, originMatterId)))
    .orderBy(desc(practiceMemos.createdAt));
  return rows.map((r) => parseRow(r, userId));
}

/**
 * Firm-wide reusable memos (owner-scoped): reuseScope='firm_wide' AND abstractionStatus=
 * 'abstracted'. The gate (server/practiceKb/gate.ts) is the authoritative cross-matter
 * decision; this read pre-filters to the only memos that can cross a matter boundary.
 */
export async function listFirmWideReusableMemos(userId: string): Promise<PracticeMemoRow[]> {
  const rows = await db
    .select()
    .from(practiceMemos)
    .where(and(ownerScope(practiceMemos.userId, userId), eq(practiceMemos.reuseScope, 'firm_wide'), eq(practiceMemos.abstractionStatus, 'abstracted')))
    .orderBy(desc(practiceMemos.createdAt));
  return rows.map((r) => parseRow(r, userId));
}

/** All memos for the owner (owner-scoped), newest first. */
export async function listMemosForOwner(userId: string): Promise<PracticeMemoRow[]> {
  const rows = await db
    .select()
    .from(practiceMemos)
    .where(ownerScope(practiceMemos.userId, userId))
    .orderBy(desc(practiceMemos.createdAt));
  return rows.map((r) => parseRow(r, userId));
}
