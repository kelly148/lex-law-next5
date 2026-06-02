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
  ]),
  actor: z.enum(['model', 'attorney', 'system']),
  actorModel: z.string().nullable(),
  summary: z.string(),
  payload: z.unknown().nullable(),
  reviewSessionId: z.string().uuid().nullable(),
  sourceSuggestionId: z.string().nullable(),
  versionId: z.string().uuid().nullable(),
  createdAt: z.date(),
});

export type AuditEventRow = z.infer<typeof AuditEventRowSchema>;
export type AuditEventType = AuditEventRow['eventType'];
export type AuditEventActor = AuditEventRow['actor'];
