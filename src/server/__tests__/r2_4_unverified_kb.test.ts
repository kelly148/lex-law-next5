/**
 * R2 #4 — unverified-KB-flag-at-override (warn-only) + the NO-MIGRATION guard.
 *
 * The draft drew on an unverified KB memo (documents.drewOnUnverifiedKb, KB-1) -> a WARN sendability
 * finding (category 'unverified_kb'), surfaced in the export-safety panel at the override moment.
 * WARN-ONLY / ENGINE-ONLY by conscious interim choice: the category lives in the shared engine
 * vocabulary but NOT in the schema.ts mysqlEnum, so it is never persisted to
 * sendability_rule.category / sendability_override.category -> no DB migration. The guard below pins
 * that asymmetry so the no-migration invariant can't silently break: if someone adds it to the DB
 * enum (e.g. to make it block-with-override at the flag flip), this test fails and forces the
 * migration to be handled consciously. See STATE for the interim-posture record.
 */
import { describe, it, expect } from 'vitest';
import { SENDABILITY_CHECK_CATEGORY_VALUES as SHARED_VOCAB } from '../../shared/schemas/sendability.js';
import { SENDABILITY_CHECK_CATEGORY_VALUES as DB_ENUM } from '../db/schema.js';
import { evaluateSendability, type SendabilityContext } from '../send/sendabilityEngine.js';

const CLEAN: SendabilityContext = {
  documentId: 'd', versionId: 'v', matterId: 'm', documentType: 'Durable_poa', inScope: true,
  matterResolved: true, matterArchived: false, documentMatterLinkOk: true,
  hasAdoptions: false, currentIsLastAdopted: true, drewOnUnverifiedKb: false,
  jurisdictionRequirements: [], openExecutionItemCount: 0, packageComplete: null, degraded: [],
};

describe('R2 #4 — unverified_kb is ENGINE-ONLY (no-migration guard)', () => {
  it('is in the shared engine vocabulary but NOT in the DB mysqlEnum', () => {
    expect(SHARED_VOCAB).toContain('unverified_kb'); // the engine can emit the finding
    // NEVER reaches sendability_rule.category / sendability_override.category -> no migration needed.
    expect(DB_ENUM as readonly string[]).not.toContain('unverified_kb');
  });
});

describe('R2 #4 — unverified_kb WARN finding', () => {
  it('drewOnUnverifiedKb=true -> a WARN finding (never a block; fail-to-warn)', () => {
    const r = evaluateSendability({ ...CLEAN, drewOnUnverifiedKb: true }, []);
    expect(r.verdict).toBe('warn');
    expect(r.warnings.some((w) => w.category === 'unverified_kb')).toBe(true);
    expect(r.blocks.some((b) => b.category === 'unverified_kb')).toBe(false);
  });

  it('drewOnUnverifiedKb=false -> no unverified_kb finding', () => {
    const r = evaluateSendability({ ...CLEAN, drewOnUnverifiedKb: false }, []);
    expect(r.warnings.some((w) => w.category === 'unverified_kb')).toBe(false);
    expect(r.verdict).toBe('pass');
  });
});
