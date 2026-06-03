/**
 * Zod schemas for Layer-0 Matter Intake & Analysis — FOLD-L0-1.
 *
 * Ch 35.1 Zod Wall: every read of matter_parties / conflict_checks / conflict_hits /
 * matter_analysis parses through these. Enum literals inlined (repo convention).
 *
 * Triad disposition encoded here: Fork A (conflict severity + disposition + required
 * rationale on blocker clear), Fork B (thin party model), Fork C/F (analysis as internal,
 * categorically NON-SENDABLE work-product).
 */

import { z } from 'zod';

// --- matter_parties (Fork B) ---------------------------------------------------
export const MatterPartyRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  role: z.enum(['client', 'adverse', 'related', 'other']),
  displayName: z.string(),
  normalizedName: z.string(),
  partyType: z.enum(['person', 'entity', 'unknown']),
  source: z.string(),
  aliasOfPartyId: z.string().uuid().nullable(),
  externalIdentityKey: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MatterPartyRow = z.infer<typeof MatterPartyRowSchema>;
export type MatterPartyRole = MatterPartyRow['role'];
export type MatterPartyType = MatterPartyRow['partyType'];

// --- conflict_checks (Fork A) --------------------------------------------------
export const ConflictCheckRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  status: z.enum(['clear', 'hits_pending', 'dispositioned']),
  runAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ConflictCheckRow = z.infer<typeof ConflictCheckRowSchema>;

// --- conflict_hits (Fork A) ----------------------------------------------------
export const ConflictHitRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  checkId: z.string().uuid(),
  matterId: z.string().uuid(),
  matchedMatterId: z.string().uuid(),
  thisPartyId: z.string().uuid().nullable(),
  matchedPartyId: z.string().uuid().nullable(),
  matchBasis: z.string(),
  matchType: z.string(),
  severity: z.enum(['blocker', 'review']),
  disposition: z.enum(['pending', 'cleared', 'screened', 'declined']),
  dispositionRationale: z.string().nullable(),
  dispositionedByEventId: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ConflictHitRow = z.infer<typeof ConflictHitRowSchema>;
export type ConflictHitSeverity = ConflictHitRow['severity'];
export type ConflictHitDisposition = ConflictHitRow['disposition'];

// --- matter_analysis (Fork C/F) ------------------------------------------------
export const MatterAnalysisRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  status: z.enum(['draft', 'locked', 'superseded']),
  assessment: z.unknown().nullable(),
  plan: z.unknown().nullable(),
  openQuestions: z.unknown().nullable(),
  recommendedDocuments: z.unknown().nullable(),
  conflictCheckId: z.string().uuid().nullable(),
  conflictsClearedForPlanning: z.boolean(),
  modelLane: z.enum(['single', 'multi']),
  generatedByJobId: z.string().uuid().nullable(),
  lockedByEventId: z.string().uuid().nullable(),
  lockedAt: z.date().nullable(),
  lockRationale: z.string().nullable(),
  supersededById: z.string().uuid().nullable(),
  // Fork F — categorically NON-SENDABLE by type.
  artifactKind: z.string(),
  outboundEligible: z.boolean(),
  sendabilityRequired: z.boolean(),
  sendabilityStatus: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MatterAnalysisRow = z.infer<typeof MatterAnalysisRowSchema>;

// --- conflicts engine output (pure; Fork A) -----------------------------------
// A computed hit BEFORE persistence: severity + the human-readable matchBasis (WHY).
export const ComputedConflictHitSchema = z.object({
  thisPartyId: z.string(),
  thisPartyName: z.string(),
  thisRole: z.enum(['client', 'adverse', 'related', 'other']),
  matchedMatterId: z.string(),
  matchedPartyId: z.string(),
  matchedRole: z.enum(['client', 'adverse', 'related', 'other']),
  matchType: z.string(),
  severity: z.enum(['blocker', 'review']),
  matchBasis: z.string(),
});
export type ComputedConflictHit = z.infer<typeof ComputedConflictHitSchema>;

/**
 * Fork A false-negative disclosure — the EXACT text the disposition surface (Increment-2
 * UI) MUST show at the moment of clearing, so "cleared" is an informed professional
 * judgment. Exported as the single source of truth (UI imports this; not buried in a doc).
 */
export const CONFLICT_FALSE_NEGATIVE_DISCLOSURE =
  'This conflicts check covers EXACT and NORMALIZED NAME matches across your own matters ONLY. ' +
  'It does NOT detect entity affiliations, fiduciary / beneficial-owner relationships, name ' +
  'variants or aliases, or adverse parties you have not recorded. Clearing a hit is your ' +
  'informed professional judgment, not a system guarantee that no conflict exists.';
