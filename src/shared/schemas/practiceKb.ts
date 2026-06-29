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
  // KB-PROVENANCE-1: optional link from this relied-on authority to a first-class
  // authority_source registry row (the durable firm/jurisdiction citation registry).
  authoritySourceId: z.string().uuid().nullable().optional(),
});
export type LawReliedOnEntry = z.infer<typeof LawReliedOnEntrySchema>;

// --- KNOWLEDGE-BACKBONE-PHASE2 (I1) — conflicts hook (disposition D2) -----------
// Origin-matter conflict metadata captured at graduation so a FUTURE conflicts check (the day a second
// attorney exists) can tell whether a surfaced principle implicates a confidence against a conflicted party.
// Cheap now, impossible to reconstruct retroactively. STORE-ONLY this increment — no conflicts logic runs in I1.
// Non-strict (unknown keys stripped, not rejected) so the field accretes later without breaking old reads.
export const ConflictsHookSchema = z.object({
  originMatterId: z.string().uuid().nullable().optional(),
  originPartyIds: z.array(z.string()).nullable().optional(),
  adverseToPartyIds: z.array(z.string()).nullable().optional(),
  note: z.string().max(1024).nullable().optional(),
});
export type ConflictsHook = z.infer<typeof ConflictsHookSchema>;

// KNOWLEDGE-BACKBONE-PHASE2 (I1) minimal-floor risk classification (mirrors MEMO_RISK_LEVEL_VALUES in schema.ts).
export const MEMO_RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type MemoRiskLevel = (typeof MEMO_RISK_LEVELS)[number];

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
  // KB-PROVENANCE-1 (WHEREAS_KB_CONSTITUTION §8 do-now provenance/currency fields). Migration-added
  // columns -> .nullable().optional() (hard convention: pre-migration reads + legacy fixtures still
  // parse). NOTE: verified_date is intentionally NOT added — it duplicates the existing
  // verifiedThroughDate (currency horizon) + lastVerifiedAt (verification act). supersedes_id is
  // DEFERRED per §8 (and supersededById above already exists).
  effectiveDate: z.string().nullable().optional(), // 'YYYY-MM-DD' — when the stated law became effective
  reviewBy: z.string().nullable().optional(), // 'YYYY-MM-DD' — recheck-by date for currency review
  authoritySnapshotId: z.string().uuid().nullable().optional(), // link to a pinned authority snapshot/source
  negativeTreatmentFlag: z.boolean().nullable().optional(), // overruled/superseded/questioned treatment
  // KNOWLEDGE-BACKBONE-PHASE2 (I1) scope-metadata floor — migration-added (0050) -> .nullable().optional() so
  // pre-migration reads + legacy fixtures still parse. autoApplyEligible is NOT NULL DEFAULT FALSE in the DB;
  // .optional() only covers legacy fixtures missing the column entirely (post-migration it is always a boolean).
  documentType: z.string().nullable().optional(),
  riskLevel: z.enum(MEMO_RISK_LEVELS).nullable().optional(),
  autoApplyEligible: z.boolean().optional(),
  conflictsHook: ConflictsHookSchema.nullable().optional(),
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
  // KNOWLEDGE-BACKBONE-PHASE2 (I1) — additive. kb_events.action is a varchar (NOT a DB ENUM), so appending
  // requires no migration. memo_auto_apply_eligibility_set audits a safety-critical flip (an entry becoming
  // auto-applicable); authority_source_* audit the durable citation-registry lifecycle (create + the §2
  // pinned-pinpoint + checkedBy-signature promotion). All append-only on the kb_events spine.
  'memo_auto_apply_eligibility_set',
  'authority_source_created',
  'authority_source_promoted',
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
