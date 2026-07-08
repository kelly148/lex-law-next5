/**
 * audit_events query wrapper — FOLD-GOV-1a (Audit-as-Matter-Record).
 *
 * Ch 35.1 Zod Wall: the ONLY code path that reads audit_events; every row parses
 * through AuditEventRowSchema before returning.
 *
 * APPEND-ONLY: this module intentionally exposes ONLY insert + read. There is no
 * update or delete — the audit record is immutable once written (governance/legal
 * record; retention is permanent per FOLD-GOV-1a defaults).
 *
 * Owner scoping uses ownerScope() (FOLD-AUTH-1 Inc 2 chokepoint) rather than an
 * inline owner-equality filter, so a future per-user sharing layer plugs in one place.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../connection.js';
import { auditEvents } from '../schema.js';
import { ownerScope } from '../ownerScope.js';

/**
 * A minimal executor abstraction so an audit write can be enlisted in the SAME
 * transaction as the state change it records (FOLD-L1-1 / disposition item 5:
 * material attorney-decision events are written transactionally with the state
 * change, OR fail visibly). Both the pooled `db` and a Drizzle `tx` handle satisfy
 * `Pick<typeof db, 'insert'>`. Defaults to the pooled `db`.
 */
type Executor = Pick<typeof db, 'insert'>;
import {
  AuditEventRowSchema,
  type AuditEventRow,
  type AuditEventType,
  type AuditEventActor,
} from '../../../shared/schemas/auditEvents.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseAuditEventRow(raw: unknown, context: { userId: string }): AuditEventRow {
  try {
    return AuditEventRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'AuditEventRowSchema',
          tableName: 'audit_events',
          errorPath: err.errors.map((e) => e.path.join('.')).join(', '),
          errorMessage: err.message,
        },
        { userId: context.userId },
      );
    }
    throw err;
  }
}

/**
 * Append an immutable audit event. The single write path; no update/delete exists.
 *
 * Pass `executor` (a Drizzle `tx` handle) to enlist this audit write in the SAME
 * transaction as the state change it records — so a material attorney decision and
 * its audit row commit together or roll back together (FOLD-L1-1 / disposition item 5).
 * Omit it to write standalone on the pooled connection.
 *
 * This is the FAIL-VISIBLY path: it throws on failure. The best-effort, never-throws
 * variant (recordAuditEvent) is for telemetry/model-output only.
 *
 * FOLD-L1-1 (Fork C) adds the disposition-detail fields (targetType/targetId/action/
 * rationale/scope) so an attorney decision is recorded in this same append-only stream
 * and the disposition-history read-projection can be built over it.
 */
export async function insertAuditEvent(
  data: {
    id?: string;
    userId: string;
    matterId: string;
    documentId?: string | null;
    eventType: AuditEventType;
    actor: AuditEventActor;
    actorModel?: string | null;
    summary: string;
    payload?: unknown;
    reviewSessionId?: string | null;
    sourceSuggestionId?: string | null;
    versionId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    action?: string | null;
    rationale?: string | null;
    scope?: string | null;
  },
  executor: Executor = db,
): Promise<string> {
  const id = data.id ?? uuidv4();
  await executor.insert(auditEvents).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    documentId: data.documentId ?? null,
    eventType: data.eventType,
    actor: data.actor,
    actorModel: data.actorModel ?? null,
    summary: data.summary,
    payload: data.payload ?? null,
    reviewSessionId: data.reviewSessionId ?? null,
    sourceSuggestionId: data.sourceSuggestionId ?? null,
    versionId: data.versionId ?? null,
    targetType: data.targetType ?? null,
    targetId: data.targetId ?? null,
    action: data.action ?? null,
    rationale: data.rationale ?? null,
    scope: data.scope ?? null,
  });
  return id;
}

/**
 * The per-matter audit record, newest first. Owner-scoped via ownerScope().
 */
export async function listAuditEventsForMatter(
  matterId: string,
  userId: string,
): Promise<AuditEventRow[]> {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(ownerScope(auditEvents.userId, userId), eq(auditEvents.matterId, matterId)))
    .orderBy(desc(auditEvents.createdAt));
  return rows.map((r) => parseAuditEventRow(r, { userId }));
}

/**
 * Disposition-history read-projection (FOLD-L1-1 / Fork C). Attorney-decision history
 * is NOT a separate authoritative table — it is the subset of the append-only
 * audit_events stream carrying disposition detail. Owner-scoped via ownerScope().
 * Newest first. Optionally narrowed to a single decision target (targetType+targetId).
 */
export async function listDispositionHistoryForMatter(
  matterId: string,
  userId: string,
  target?: { targetType: string; targetId: string },
): Promise<AuditEventRow[]> {
  const conditions = [
    ownerScope(auditEvents.userId, userId),
    eq(auditEvents.matterId, matterId),
    eq(auditEvents.eventType, 'disposition'),
  ];
  if (target) {
    conditions.push(eq(auditEvents.targetType, target.targetType));
    conditions.push(eq(auditEvents.targetId, target.targetId));
  }
  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(...conditions))
    .orderBy(desc(auditEvents.createdAt));
  return rows.map((r) => parseAuditEventRow(r, { userId }));
}

/**
 * BEST-EFFORT audit write — never throws. Use this from governing flows so the
 * audit record can NEVER break the operation it is recording (e.g. when the
 * audit_events table is not yet migrated on this environment, the write simply
 * no-ops with a telemetry breadcrumb). For the rare path that must observe a
 * write failure, call insertAuditEvent directly.
 */
export async function recordAuditEvent(
  data: Parameters<typeof insertAuditEvent>[0],
): Promise<void> {
  try {
    await insertAuditEvent(data);
  } catch (err) {
    void emitTelemetry(
      'procedure_error',
      {
        procedureName: 'recordAuditEvent',
        errorCode: 'AUDIT_WRITE_FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
      },
      { userId: data.userId },
    );
  }
}

/**
 * DEED-MANUAL-LEGAL-GIFT-1 (G7/G9): was an ATTORNEY-ENTERED verbatim legal recorded for this document version?
 * Reads the append-only audit log for the draft-time G12 event (action='attorney_entered_verbatim' on the
 * version). The export route uses this to render the HONEST D3 posture (no fabricated comparison) and the
 * conspicuous NON-BLOCKING export warning. Owner-scoped via ownerScope() (FOLD-AUTH-1 chokepoint).
 */
export async function versionHasAttorneyEnteredLegal(userId: string, versionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        ownerScope(auditEvents.userId, userId),
        eq(auditEvents.versionId, versionId),
        eq(auditEvents.action, 'attorney_entered_verbatim'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
