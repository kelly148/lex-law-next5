/**
 * Zod schema for the posture_provenance table — CHAT-UI-1 W2 (PROVENANCE-LEDGER-1).
 *
 * Ch 35.1 Zod Wall: every read of posture_provenance parses through this schema. Append-only,
 * tamper-evident audit ledger for the posture-confirm discipline (distinct from audit_events and
 * telemetry_events). Enum literals are inlined here (repo convention, mirroring AuditEventRowSchema);
 * the Drizzle column enums live in schema.ts (POSTURE_PROVENANCE_*_VALUES).
 */
import { z } from 'zod';

const RECIPIENT = z.enum([
  'internal_client',
  'co_counsel_agent',
  'neutral_third_party',
  'regulator_court',
  'adverse',
  'public',
]);

const ISSUER_CAPACITY = z.enum(['counsel', 'principal']);

/** The triple as stored in the priorTriple JSON column (mirrors the shared Posture type). */
export const PostureTripleSchema = z.object({
  issuer: z.object({
    entity: z.string(),
    capacity: ISSUER_CAPACITY,
    display: z.string().optional(),
  }),
  privilege: z.boolean().nullable(),
  recipient: RECIPIENT,
});

export const CoherenceFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['HARD', 'SOFT']),
  summary: z.string(),
  rationale: z.string(),
});

export const PostureProvenanceRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid().nullable(),
  seq: z.number().int().nonnegative(),
  eventClass: z.enum(['meaningful_accept', 'dirty_confirmed']),
  act: z.enum([
    'lock',
    'tier_source',
    'disposition',
    'send',
    'matter_identity',
    'issuer',
    'privilege',
    'recipient',
  ]),
  actor: z.string(),
  sliderPosition: z.string(),
  triggerSource: z.string(),
  confirmedAt: z.string(),
  issuerEntity: z.string().nullable(),
  issuerCapacity: ISSUER_CAPACITY.nullable(),
  issuerDisplay: z.string().nullable(),
  privilege: z.enum(['privileged', 'not_privileged', 'undetermined']).nullable(),
  recipient: RECIPIENT.nullable(),
  priorTriple: PostureTripleSchema.nullable(),
  verdictSeverity: z.enum(['hard', 'soft', 'none']),
  findings: z.array(CoherenceFindingSchema),
  prevHash: z.string(),
  entryHash: z.string(),
  createdAt: z.date(),
});

export type PostureProvenanceRow = z.infer<typeof PostureProvenanceRowSchema>;
