/**
 * Zod schemas for the FOLD-SEND-1 "export safety / outbound readiness" data core (Increment 1).
 *
 * Ch 35.1 Zod Wall: every read of these tables parses through these schemas.
 *
 * FOLD-SEND-1 upgrades sendability from an advisory LLM classifier to a DETERMINISTIC
 * block/warn/pass gate (triad-reviewed: docs/reviews/FOLD-SEND-1_disposition.md). Increment 1 is
 * the DATA CORE only — tables + schemas + idempotent firm-default seeds; NO behavior change,
 * nothing wired to export, flag SENDABILITY_GATE_ENABLED default OFF.
 *
 * Four tables:
 *  - sendability_rule        — which deterministic checks are enabled + at what level (block/warn/off);
 *                              owner-null = firm default; no config UI in v1 (seeded).
 *  - jurisdiction_rule       — document-type-scoped, source-tagged execution formalities (idempotent
 *                              seeds; scope-guarded so settlement/title formalities are excluded).
 *  - sendability_override    — APPEND-ONLY record of an attorney overriding a block; bound to the
 *                              exact documentId + versionId + contentHash; snapshots the block payload;
 *                              structured reason-code + free text; supersedes on version change.
 *  - sendability_evaluation  — APPEND-ONLY log of every gate evaluation (incl. shadow mode): verdict,
 *                              blocks[], warnings[], LLM-component flag, duration, degradation.
 *
 * The user-facing name is "export safety / outbound readiness"; the legacy `sendability_*` code name
 * is kept where churn isn't worth it (per disposition).
 */

import { z } from 'zod';

// Deterministic + warn categories the gate can surface. v1 BLOCK-capable: wrong_matter_id only
// (per disposition); stale_baseline + missing_required_signer/open_execution_item are WARN in v1;
// unverified_statute_citation + audience_leak are DEFERRED (warn-only via the LLM/advisory layer).
export const SENDABILITY_CHECK_CATEGORY_VALUES = [
  'wrong_matter_id',
  'stale_baseline',
  'missing_required_signer',
  'open_execution_item',
  'unverified_statute_citation',
  'tone',
  'package_completeness',
  'low_confidence_match',
  'audience_leak',
] as const;

export const SENDABILITY_RULE_LEVEL_VALUES = ['block', 'warn', 'off'] as const;
export const SENDABILITY_VERDICT_VALUES = ['block', 'warn', 'pass'] as const;
export const SENDABILITY_DEGRADATION_VALUES = ['none', 'partial', 'error'] as const;
export const SENDABILITY_OVERRIDE_REASON_VALUES = [
  'verified_correct',
  'intentional_choice',
  'will_correct_before_send',
  'not_applicable',
  'other',
] as const;
export const JURISDICTION_REQUIREMENT_VALUES = [
  'notary',
  'two_witnesses',
  'self_proving_affidavit',
  'signer_capacity_recital',
] as const;

// ── sendability_rule (owner-null = firm default; no config UI v1) ──────────────
export const SendabilityRuleRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(), // NULL = firm default
  category: z.enum(SENDABILITY_CHECK_CATEGORY_VALUES),
  documentType: z.string().nullable(), // NULL = all document types
  level: z.enum(SENDABILITY_RULE_LEVEL_VALUES),
  notes: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ── jurisdiction_rule (document-type-scoped + source-tagged; scope-guarded) ────
export const JurisdictionRuleRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(), // NULL = firm default
  jurisdiction: z.string(), // e.g. 'VA', 'MD'
  documentType: z.string(), // e.g. 'Durable_poa' — scope-guarded (no settlement/title)
  requirement: z.enum(JURISDICTION_REQUIREMENT_VALUES),
  sourceTag: z.string(), // the authority for the rule, e.g. 'Va. Code § 64.2-1603'
  notes: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ── sendability_override (APPEND-ONLY; content-hash-bound; supersedes on version change) ──
export const SendabilityOverrideRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  // Bound to the exact content at override time; a new version/content invalidates it (the export
  // check simply won't find a matching override) -> "supersedes on version change".
  contentHash: z.string(),
  category: z.enum(SENDABILITY_CHECK_CATEGORY_VALUES),
  // Full snapshot of the block payload at override time (what the attorney actually overrode).
  blockPayload: z.unknown(),
  reasonCode: z.enum(SENDABILITY_OVERRIDE_REASON_VALUES),
  reasonText: z.string().nullable(),
  createdAt: z.date(),
});

// ── sendability_evaluation (APPEND-ONLY log; incl. shadow mode) ────────────────
export const SendabilityEvaluationRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  verdict: z.enum(SENDABILITY_VERDICT_VALUES),
  blocks: z.array(z.unknown()), // [{category, level, summary, ...}] — engine output (Inc 2)
  warnings: z.array(z.unknown()),
  // True when the advisory LLM warn-layer contributed (deterministic blocks are always LLM-free).
  llmComponentUsed: z.boolean(),
  // 'error' => a check could not run (fail-to-WARN, not fail-to-block).
  degraded: z.enum(SENDABILITY_DEGRADATION_VALUES),
  durationMs: z.number().int().nonnegative(),
  // Whether this evaluation was enforced or shadow-only (flag OFF => shadow).
  enforced: z.boolean(),
  createdAt: z.date(),
});

export type SendabilityRuleRow = z.infer<typeof SendabilityRuleRowSchema>;
export type JurisdictionRuleRow = z.infer<typeof JurisdictionRuleRowSchema>;
export type SendabilityOverrideRow = z.infer<typeof SendabilityOverrideRowSchema>;
export type SendabilityEvaluationRow = z.infer<typeof SendabilityEvaluationRowSchema>;
export type SendabilityCheckCategory = (typeof SENDABILITY_CHECK_CATEGORY_VALUES)[number];
export type SendabilityRuleLevel = (typeof SENDABILITY_RULE_LEVEL_VALUES)[number];
export type SendabilityVerdict = (typeof SENDABILITY_VERDICT_VALUES)[number];
export type SendabilityOverrideReason = (typeof SENDABILITY_OVERRIDE_REASON_VALUES)[number];
export type JurisdictionRequirement = (typeof JURISDICTION_REQUIREMENT_VALUES)[number];
