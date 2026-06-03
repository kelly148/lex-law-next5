/**
 * Matter-State read contract — FOLD-L1-1 (Layer-1 Matter-State Engine).
 *
 * The typed answer returned by the `matterState.get` read surface. The engine REPORTS
 * state; it never decides (engine-reports-never-decides). This module defines the shape
 * only — composition + the owner/integrity invariant live in the server matterState
 * service (src/server/matterState/), and parsing happens there through these schemas.
 *
 * Three explicit modes (operator disposition item 1), discriminated by `mode`:
 *   summary       — matter header + counts + safe-to-send posture + operative document.
 *                   Lightweight; no full bodies.
 *   full          — every composed row (locked decisions, adoptions, open items, source
 *                   authorities, the audit/matter record, documents). "full raises the
 *                   stake" for the integrity invariant.
 *   model_context — the CURATED package FOLD-L1-2 will consume (NOT raw full state):
 *                   active locked decisions, carried adoptions, open blockers/substantive,
 *                   matter-level items, operative sources, safe-to-send.
 *
 * NOTE: L1-1 is data model + read contract ONLY — there is no injection of this package
 * into model calls yet (that is FOLD-L1-2).
 */

import { z } from 'zod';
import { LockedDecisionRowSchema, AdoptLedgerRowSchema } from './phase4b.js';
import { OpenItemRowSchema } from './openItems.js';
import { SourceAuthorityRowSchema } from './sourceAuthority.js';
import { AuditEventRowSchema } from './auditEvents.js';

export const MATTER_STATE_MODES = ['summary', 'full', 'model_context'] as const;
export type MatterStateMode = (typeof MATTER_STATE_MODES)[number];

// --- shared building blocks ------------------------------------------------

export const MatterIdentitySchema = z.object({
  matterId: z.string().uuid(),
  title: z.string(),
  clientName: z.string().nullable(),
  practiceArea: z.string().nullable(),
  phase: z.enum(['intake', 'drafting', 'complete']),
  archivedAt: z.date().nullable(),
});
export type MatterIdentity = z.infer<typeof MatterIdentitySchema>;

export const OperativeDocumentSchema = z.object({
  documentId: z.string().uuid(),
  title: z.string(),
  workflowState: z.enum([
    'drafting',
    'substantively_accepted',
    'finalizing',
    'complete',
    'archived',
  ]),
  currentVersionId: z.string().uuid().nullable(),
  currentVersionNumber: z.number().int().nonnegative().nullable(),
});
export type OperativeDocument = z.infer<typeof OperativeDocumentSchema>;

// safe-to-send: surfaced as STATE, derived from open BLOCKER-severity open_items — no
// LLM call in the read path. 'unknown' is reserved for when the open-item registry has
// not been populated (advisory, MR-CAL-8C remains the real-time classifier elsewhere).
export const SafeToSendSchema = z.object({
  posture: z.enum(['clear', 'blocked', 'unknown']),
  openBlockerCount: z.number().int().nonnegative(),
  derivedFrom: z.literal('open_items'),
});
export type SafeToSend = z.infer<typeof SafeToSendSchema>;

export const MatterStateCountsSchema = z.object({
  lockedDecisionsActive: z.number().int().nonnegative(),
  adoptionsActive: z.number().int().nonnegative(),
  adoptionsUnresolved: z.number().int().nonnegative(),
  openItemsOpen: z.number().int().nonnegative(),
  openBlockers: z.number().int().nonnegative(),
  sourceAuthorities: z.number().int().nonnegative(),
  auditEvents: z.number().int().nonnegative(),
});
export type MatterStateCounts = z.infer<typeof MatterStateCountsSchema>;

// curated, prompt-ready projections used by model_context (NOT raw rows)
export const CuratedLockedDecisionSchema = z.object({
  id: z.string().uuid(),
  summary: z.string(),
  rationale: z.string().nullable(),
  origin: z.enum(['declined', 'adopted']),
});

export const CuratedAdoptionSchema = z.object({
  id: z.string().uuid(),
  adoptedText: z.string(),
  disposition: z.enum(['adopted_verbatim', 'adopted_modified']),
  status: z.enum(['active', 'superseded', 'resolved', 'unresolved']),
});

export const CuratedOpenItemSchema = z.object({
  id: z.string().uuid(),
  category: z.string(),
  severity: z.enum(['blocker', 'substantive', 'polish']),
  summary: z.string(),
  scope: z.enum(['matter', 'document']),
});

export const CuratedSourceSchema = z.object({
  id: z.string().uuid(),
  subjectType: z.enum(['material', 'document', 'version']),
  subjectId: z.string().uuid(),
  authorityOrigin: z.enum([
    'operative',
    'counterparty',
    'firm',
    'client',
    'model_derived',
    'reference',
  ]),
  lifecycle: z.enum(['current_draft', 'operative', 'superseded']),
  label: z.string().nullable(),
});

// --- the three mode shapes --------------------------------------------------

export const MatterStateSummarySchema = z.object({
  mode: z.literal('summary'),
  matter: MatterIdentitySchema,
  operativeDocument: OperativeDocumentSchema.nullable(),
  counts: MatterStateCountsSchema,
  safeToSend: SafeToSendSchema,
});
export type MatterStateSummary = z.infer<typeof MatterStateSummarySchema>;

export const MatterStateFullSchema = z.object({
  mode: z.literal('full'),
  matter: MatterIdentitySchema,
  operativeDocument: OperativeDocumentSchema.nullable(),
  counts: MatterStateCountsSchema,
  safeToSend: SafeToSendSchema,
  documents: z.array(OperativeDocumentSchema),
  lockedDecisions: z.array(LockedDecisionRowSchema),
  adoptions: z.array(AdoptLedgerRowSchema),
  openItems: z.array(OpenItemRowSchema),
  sourceAuthorities: z.array(SourceAuthorityRowSchema),
  auditEvents: z.array(AuditEventRowSchema),
});
export type MatterStateFull = z.infer<typeof MatterStateFullSchema>;

export const MatterStateModelContextSchema = z.object({
  mode: z.literal('model_context'),
  matter: MatterIdentitySchema,
  operativeDocument: OperativeDocumentSchema.nullable(),
  safeToSend: SafeToSendSchema,
  activeLockedDecisions: z.array(CuratedLockedDecisionSchema),
  carriedAdoptions: z.array(CuratedAdoptionSchema),
  openBlockers: z.array(CuratedOpenItemSchema),
  openSubstantive: z.array(CuratedOpenItemSchema),
  matterLevelItems: z.array(CuratedOpenItemSchema),
  operativeSources: z.array(CuratedSourceSchema),
});
export type MatterStateModelContext = z.infer<typeof MatterStateModelContextSchema>;

export const MatterStateSchema = z.discriminatedUnion('mode', [
  MatterStateSummarySchema,
  MatterStateFullSchema,
  MatterStateModelContextSchema,
]);
export type MatterState = z.infer<typeof MatterStateSchema>;

// ---------------------------------------------------------------------------
// FOLD-L1-5 — matter-state dashboard read contract
// ---------------------------------------------------------------------------
// The inspectable dashboard surface: the full matter state (state summary,
// source-authority/baseline, decision log via auditEvents, open-items/blockers,
// sendability) PLUS the model-context-packet preview (the exact L1-2 block + its
// structured model_context). One read backs the whole dashboard.

export const MatterStateDashboardSchema = z.object({
  full: MatterStateFullSchema,
  modelContext: MatterStateModelContextSchema,
  /** The exact "## Matter State" block L1-2 injects — previewed verbatim. */
  modelContextPacket: z.string(),
});
export type MatterStateDashboard = z.infer<typeof MatterStateDashboardSchema>;
