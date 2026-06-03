/**
 * Zod schemas for the Practice Knowledge Base — FOLD-KB-1 (Increment 1 data core).
 *
 * Ch 35.1 Zod Wall: every read of pa_instruction_profiles / practice_memos parses through
 * these. Enum literals inlined (repo convention); the varchar domains mirror the
 * MEMO_*_VALUES consts in schema.ts.
 *
 * Triad disposition (PROCEED WITH NAMED CHANGES) encoded here: discrete verificationStatus
 * SEPARATE from lastVerifiedAt (Fork C); structured lawReliedOn (Fork C); privilege ×
 * abstraction with an attorney attestation event (Fork B/G); the memo access gate is
 * abstraction-required (Fork B/F — see server/practiceKb/gate.ts).
 */

import { z } from 'zod';

// --- pa_instruction_profiles (Fork E) -----------------------------------------
export const PaInstructionProfileRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  paKey: z.string(),
  title: z.string(),
  body: z.string(),
  version: z.string(),
  active: z.boolean(),
  supersededById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type PaInstructionProfileRow = z.infer<typeof PaInstructionProfileRowSchema>;

// --- practice_memos: structured authorities relied on (Fork C) -----------------
// REQUIRED at capture for any memo that states a legal conclusion (enforced in the
// procedure layer) — an un-sourced conclusion memo is uncheckable forever.
export const LawReliedOnEntrySchema = z.object({
  jurisdiction: z.string(),
  citationOrSource: z.string(),
  sourceType: z.string(), // e.g. 'statute' | 'regulation' | 'case' | 'secondary' | 'internal_memo'
  effectiveDate: z.string().nullable().optional(),
  ref: z.string().nullable().optional(),
});
export type LawReliedOnEntry = z.infer<typeof LawReliedOnEntrySchema>;

// --- practice_memos (Fork A/B/C/G) --------------------------------------------
export const PracticeMemoRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  originMatterId: z.string().uuid().nullable(),
  sourceAnalysisId: z.string().uuid().nullable(),
  sourceDocumentId: z.string().uuid().nullable(),
  title: z.string(),
  body: z.string(),
  practiceArea: z.string().nullable(),
  jurisdiction: z.string().nullable(),
  lawReliedOn: z.array(LawReliedOnEntrySchema).nullable(),
  topicTags: z.array(z.string()).nullable(),
  writtenOn: z.date().nullable(),
  // Currency — discrete status SEPARATE from the timestamp (never age-derived).
  verificationStatus: z.enum([
    'unverified',
    'attorney_verified_current',
    'stale',
    'superseded',
    'not_legal_authority',
  ]),
  lastVerifiedAt: z.date().nullable(),
  verifiedThroughDate: z.date().nullable(),
  verificationMethod: z.string().nullable(),
  verificationNote: z.string().nullable(),
  // Privilege / abstraction.
  privilegeTag: z.enum(['client_confidential', 'abstracted', 'public']),
  abstractionStatus: z.enum(['raw', 'abstracted']),
  abstractionAttestedByEventId: z.string().uuid().nullable(),
  abstractedAt: z.date().nullable(),
  abstractedBy: z.enum(['attorney', 'system_assisted_attorney']).nullable(),
  reuseScope: z.enum(['matter_only', 'firm_wide']),
  abstractedFromMemoId: z.string().uuid().nullable(),
  supersededById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type PracticeMemoRow = z.infer<typeof PracticeMemoRowSchema>;
export type MemoVerificationStatus = PracticeMemoRow['verificationStatus'];
export type MemoPrivilegeTag = PracticeMemoRow['privilegeTag'];
export type MemoAbstractionStatus = PracticeMemoRow['abstractionStatus'];
export type MemoReuseScope = PracticeMemoRow['reuseScope'];

// --- kb_adoptions (Fork A; Increment 2) ----------------------------------------
// Durable, matter-scoped provenance of a memo pulled into a matter / work product.
export const KbAdoptionRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid().nullable(),
  kbMemoId: z.string().uuid(),
  kbMemoUpdatedAtAtAdoption: z.date().nullable(),
  verificationStatusAtAdoption: z.string(),
  lastVerifiedAtAtAdoption: z.date().nullable(),
  kbDerived: z.boolean(),
  currencyVerifiedForOutbound: z.boolean(),
  adoptedByEventId: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type KbAdoptionRow = z.infer<typeof KbAdoptionRowSchema>;

// --- kb_events (Increment 3) — firm-level KB audit trail (append-only) ----------
export const KbEventRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().uuid(),
  summary: z.string(),
  rationale: z.string().nullable(),
  payload: z.unknown().nullable(),
  createdAt: z.date(),
});
export type KbEventRow = z.infer<typeof KbEventRowSchema>;

// --- memo access gate decision (Fork B/F; server/practiceKb/gate.ts) -----------
export const MemoAccessDecisionSchema = z.object({
  allowed: z.boolean(),
  crossMatter: z.boolean(),
  reason: z.enum([
    'origin_matter',          // same matter as origin — allowed
    'firm_level',             // originMatterId null (not client-derived) — allowed
    'firm_wide_abstracted',   // cross-matter, firm_wide AND abstracted — allowed
    'blocked_matter_only',    // cross-matter, scope matter_only — blocked
    'blocked_not_abstracted', // cross-matter, firm_wide but raw — blocked (defense)
  ]),
});
export type MemoAccessDecision = z.infer<typeof MemoAccessDecisionSchema>;

/**
 * The high-risk KB attorney acts that MUST be audited (FOLD-KB-1 named change). Wired into
 * audit_events in Increment 2. `pa_profile_loaded_for_job` is recorded when a profile is
 * auto-loaded into a generation job (R11 version captured at job creation). Candidate
 * surfacing is intentionally NOT in this list (noise).
 */
export const KB_AUDIT_ACTIONS = [
  'memo_created',
  'memo_abstracted',
  'memo_promoted_to_reuse',
  'memo_invoked_into_matter',
  'memo_adopted_into_matter',
  'memo_marked_reverified',
  'memo_superseded',
  'pa_profile_activated',
  'pa_profile_loaded_for_job',
] as const;
export type KbAuditAction = (typeof KB_AUDIT_ACTIONS)[number];

/**
 * The disclosure shown AT the adoption surface (Increment 3 UI) and carried as the
 * KB-derived caution. Single source of truth (UI imports this; not buried in a doc).
 */
export const KB_DERIVED_DISCLOSURE =
  'This content is drawn from an internal practice memo, not a current source of law. ' +
  'It accelerates your analysis; it is NOT verified as current. Before any of it reaches a ' +
  'client or counterparty document, re-verify the authorities it relies on against current ' +
  'law. Adopting it records that this work product drew on unverified knowledge-base content.';
