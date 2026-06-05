/**
 * FOLD-SEND-1 Increment 1 — export-safety data core (Zod Wall) + scope guard.
 *
 * Tests the additive Zod-Wall schemas (the testable core) and the pure export-safety scope guard.
 * The owner-scoped queries + firm-default reads run live (no test DB); they follow the established
 * ownerScope() / isNull(userId) + parse-on-read pattern. No behavior change in Inc 1.
 */

import { describe, it, expect } from 'vitest';
import {
  SendabilityRuleRowSchema,
  JurisdictionRuleRowSchema,
  SendabilityOverrideRowSchema,
  SendabilityEvaluationRowSchema,
  SENDABILITY_CHECK_CATEGORY_VALUES,
} from '../../shared/schemas/sendability.js';
import { isExportSafetyInScope } from '../send/exportSafetyScope.js';

const now = new Date('2026-06-05T00:00:00Z');
const UUID = '11111111-1111-1111-1111-111111111111';
const UUID2 = '22222222-2222-2222-2222-222222222222';

describe('FOLD-SEND-1 Inc1 — Zod Wall schemas', () => {
  it('SendabilityRuleRowSchema: parses a firm-default rule (null userId/documentType) and rejects a bad level', () => {
    const row = { id: UUID, userId: null, category: 'wrong_matter_id', documentType: null, level: 'block', notes: null, createdAt: now, updatedAt: now };
    expect(SendabilityRuleRowSchema.safeParse(row).success).toBe(true);
    expect(SendabilityRuleRowSchema.safeParse({ ...row, userId: UUID2, documentType: 'Durable_poa' }).success).toBe(true);
    expect(SendabilityRuleRowSchema.safeParse({ ...row, level: 'halt' }).success).toBe(false);
    expect(SendabilityRuleRowSchema.safeParse({ ...row, category: 'made_up' }).success).toBe(false);
  });

  it('JurisdictionRuleRowSchema: parses a seeded VA POA notary rule; rejects a bad requirement', () => {
    const row = { id: UUID, userId: null, jurisdiction: 'VA', documentType: 'Durable_poa', requirement: 'notary', sourceTag: 'Va. Code Ann. § 64.2-1603', notes: null, createdAt: now, updatedAt: now };
    expect(JurisdictionRuleRowSchema.safeParse(row).success).toBe(true);
    expect(JurisdictionRuleRowSchema.safeParse({ ...row, requirement: 'fingerprint' }).success).toBe(false);
  });

  it('SendabilityOverrideRowSchema: parses an append-only, content-hash-bound override; rejects a bad reason code', () => {
    const row = { id: UUID, userId: UUID2, matterId: UUID, documentId: UUID, versionId: UUID2, contentHash: 'abc123', category: 'wrong_matter_id', blockPayload: { category: 'wrong_matter_id', summary: 'x' }, reasonCode: 'verified_correct', reasonText: 'confirmed', createdAt: now };
    expect(SendabilityOverrideRowSchema.safeParse(row).success).toBe(true);
    expect(SendabilityOverrideRowSchema.safeParse({ ...row, blockPayload: null }).success).toBe(true); // unknown/nullable
    expect(SendabilityOverrideRowSchema.safeParse({ ...row, reasonCode: 'because' }).success).toBe(false);
  });

  it('SendabilityEvaluationRowSchema: parses a shadow-mode evaluation row; rejects a bad verdict', () => {
    const row = { id: UUID, userId: UUID2, matterId: UUID, documentId: UUID, versionId: UUID2, verdict: 'warn', blocks: [], warnings: [{ category: 'tone' }], llmComponentUsed: true, degraded: 'none', durationMs: 12, enforced: false, createdAt: now };
    expect(SendabilityEvaluationRowSchema.safeParse(row).success).toBe(true);
    expect(SendabilityEvaluationRowSchema.safeParse({ ...row, verdict: 'maybe' }).success).toBe(false);
    expect(SendabilityEvaluationRowSchema.safeParse({ ...row, durationMs: -1 }).success).toBe(false);
    expect(SendabilityEvaluationRowSchema.safeParse({ ...row, degraded: 'broken' }).success).toBe(false);
  });

  it('the v1 BLOCK-capable + deferred categories are all in the category vocabulary', () => {
    for (const c of ['wrong_matter_id', 'stale_baseline', 'missing_required_signer', 'open_execution_item', 'unverified_statute_citation', 'audience_leak']) {
      expect(SENDABILITY_CHECK_CATEGORY_VALUES).toContain(c);
    }
  });
});

describe('FOLD-SEND-1 Inc1 — export-safety scope guard', () => {
  it('in-scope transactional document types pass', () => {
    for (const t of ['Durable_poa', 'durable_poa', 'engagement_letter', 'operating_agreement', 'promissory_note']) {
      expect(isExportSafetyInScope(t)).toBe(true);
    }
  });

  it('settlement/title-class document types are out of scope (separator/case-insensitive)', () => {
    for (const t of ['settlement_agreement', 'Settlement Statement', 'title_commitment', 'ALTA-settlement', 'closing_disclosure', 'warranty_deed', 'escrow_instructions']) {
      expect(isExportSafetyInScope(t)).toBe(false);
    }
  });
});
