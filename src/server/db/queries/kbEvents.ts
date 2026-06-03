/**
 * kb_events query wrapper — FOLD-KB-1 Increment 3 (firm-level KB audit trail).
 *
 * Ch 35.1 Zod Wall; owner-scoped via ownerScope(). APPEND-ONLY: insert + read only (no
 * update/delete) — the firm-level KB record is immutable once written. Enlistable in a
 * transaction so an attorney act and its audit row commit together (or fail visibly), the
 * same pattern as audit_events.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../connection.js';
import { kbEvents } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { KbEventRowSchema, type KbEventRow, type KbAuditAction } from '../../../shared/schemas/practiceKb.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

type Executor = Pick<typeof db, 'insert'>;

function parseRow(raw: unknown, userId: string): KbEventRow {
  try {
    return KbEventRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry('zod_parse_failed', { schemaName: 'KbEventRowSchema', tableName: 'kb_events', errorPath: err.errors[0]?.path.join('.') ?? '', errorMessage: err.errors[0]?.message ?? 'ZodError' }, { userId, matterId: null, documentId: null, jobId: null });
    }
    throw err;
  }
}

/** Append an immutable firm-level KB audit event. Fail-visible (throws). */
export async function insertKbEvent(
  data: {
    id?: string;
    userId: string;
    action: KbAuditAction;
    targetType: 'practice_memo' | 'pa_instruction_profile';
    targetId: string;
    summary: string;
    rationale?: string | null;
    payload?: unknown;
  },
  executor: Executor = db,
): Promise<string> {
  const id = data.id ?? uuidv4();
  await executor.insert(kbEvents).values({
    id,
    userId: data.userId,
    action: data.action,
    targetType: data.targetType,
    targetId: data.targetId,
    summary: data.summary,
    rationale: data.rationale ?? null,
    payload: (data.payload ?? null) as never,
  });
  return id;
}

/**
 * BEST-EFFORT firm-level KB audit write — never throws. Use from the LLM-dispatch chokepoint
 * (pa_profile_loaded_for_job) so the audit record can NEVER break the model call it records.
 */
export async function recordKbEvent(data: Parameters<typeof insertKbEvent>[0]): Promise<void> {
  try {
    await insertKbEvent(data);
  } catch (err) {
    void emitTelemetry(
      'procedure_error',
      { procedureName: 'recordKbEvent', errorCode: 'KB_EVENT_WRITE_FAILED', errorMessage: err instanceof Error ? err.message : String(err) },
      { userId: data.userId, matterId: null, documentId: null, jobId: null },
    );
  }
}

export async function listKbEventsForOwner(userId: string): Promise<KbEventRow[]> {
  const rows = await db
    .select()
    .from(kbEvents)
    .where(ownerScope(kbEvents.userId, userId))
    .orderBy(desc(kbEvents.createdAt));
  return rows.map((r) => parseRow(r, userId));
}

export async function listKbEventsForTarget(targetType: string, targetId: string, userId: string): Promise<KbEventRow[]> {
  const rows = await db
    .select()
    .from(kbEvents)
    .where(and(ownerScope(kbEvents.userId, userId), eq(kbEvents.targetType, targetType), eq(kbEvents.targetId, targetId)))
    .orderBy(desc(kbEvents.createdAt));
  return rows.map((r) => parseRow(r, userId));
}
