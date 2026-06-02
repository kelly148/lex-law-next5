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
 */
export async function insertAuditEvent(data: {
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
}): Promise<string> {
  const id = data.id ?? uuidv4();
  await db.insert(auditEvents).values({
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
