/**
 * Zod schema for the audit_events table — FOLD-GOV-1a (Audit-as-Matter-Record).
 *
 * Ch 35.1 Zod Wall: every read of audit_events parses through this schema.
 * Append-only governance record (distinct from telemetry_events).
 *
 * Enum literals are inlined here (repo convention, mirroring AdoptLedgerRowSchema);
 * the Drizzle column enums live in schema.ts (AUDIT_EVENT_TYPE_VALUES / _ACTOR_VALUES).
 */

import { z } from 'zod';

export const AuditEventRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid().nullable(),
  eventType: z.enum([
    'model_output',
    'adopted',
    'rejected',
    'locked',
    'unlocked',
    'sent',
    'withheld',
    'authority_verified',
    'judgment_required',
    // FOLD-L1-1 (Fork C): attorney decision recorded in the same append-only stream.
    'disposition',
  ]),
  actor: z.enum(['model', 'attorney', 'system']),
  actorModel: z.string().nullable(),
  summary: z.string(),
  payload: z.unknown().nullable(),
  reviewSessionId: z.string().uuid().nullable(),
  sourceSuggestionId: z.string().nullable(),
  versionId: z.string().uuid().nullable(),
  // FOLD-L1-1 (Fork C) — disposition-detail columns. ADDITIVE and back-compatible:
  // .nullable().optional() so both a post-migration row (key present, value null) AND a
  // pre-migration read / legacy fixture (key absent) parse. targetId is a row id (not
  // always a UUID-typed column); scope/action/targetType are short free strings.
  targetType: z.string().nullable().optional(),
  targetId: z.string().nullable().optional(),
  action: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  createdAt: z.date(),
});

export type AuditEventRow = z.infer<typeof AuditEventRowSchema>;
export type AuditEventType = AuditEventRow['eventType'];
export type AuditEventActor = AuditEventRow['actor'];
