/**
 * FOLD-L0-1 — Layer-0 Matter Intake & Analysis (Increment 1, server core).
 *
 * Heaviest coverage on the ethics-critical PURE conflicts engine (severity rules, role-aware
 * matching, normalization). Plus the lane suggester, Zod walls, the false-negative
 * disclosure constant, and source-audits of the wiring (ownerScope discipline; conflicts
 * check has NO LLM; blocker rationale required; lock-plan conflicts gate; additive
 * migration; router registration; analysis non-sendable type). No-DB style; CI authoritative.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  normalizeName,
  computeConflictHits,
  hasBlocker,
  dispositionNeedsRationale,
  type PartyLite,
} from '../conflicts/engine.js';
import { suggestAnalysisLane } from '../intake/modelLane.js';
import {
  MatterPartyRowSchema,
  ConflictHitRowSchema,
  MatterAnalysisRowSchema,
  CONFLICT_FALSE_NEGATIVE_DISCLOSURE,
} from '../../shared/schemas/layer0.js';

const M1 = '11111111-1111-1111-1111-111111111111';
const M2 = '22222222-2222-2222-2222-222222222222';

function party(p: Partial<PartyLite> & Pick<PartyLite, 'role' | 'displayName' | 'matterId'>): PartyLite {
  return {
    id: p.id ?? `id-${p.displayName}-${p.matterId}`,
    matterId: p.matterId,
    role: p.role,
    displayName: p.displayName,
    normalizedName: p.normalizedName ?? normalizeName(p.displayName),
  };
}

// ---------------------------------------------------------------------------
// normalizeName
// ---------------------------------------------------------------------------
describe('FOLD-L0-1 — normalizeName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeName('  Acme,   Inc. ')).toBe('acme inc');
    expect(normalizeName('ACME INC')).toBe('acme inc');
    expect(normalizeName('Acme, Inc.')).toBe(normalizeName('acme inc'));
  });
  it('different names do not collide', () => {
    expect(normalizeName('Acme Inc')).not.toBe(normalizeName('Beta LLC'));
  });
});

// ---------------------------------------------------------------------------
// computeConflictHits — the ethics-critical core (Fork A)
// ---------------------------------------------------------------------------
describe('FOLD-L0-1 — computeConflictHits severity rules', () => {
  it('client-here / adverse-there => BLOCKER with an explaining matchBasis', () => {
    const here = [party({ role: 'client', displayName: 'Acme Inc', matterId: M1 })];
    const other = [party({ role: 'adverse', displayName: 'Acme Inc', matterId: M2 })];
    const hits = computeConflictHits(here, other);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('blocker');
    expect(hits[0]!.matchBasis).toMatch(/CLIENT in this matter but ADVERSE/);
    expect(hits[0]!.matchedMatterId).toBe(M2);
    expect(hasBlocker(hits)).toBe(true);
  });

  it('adverse-here / client-there => BLOCKER (crossing the other direction)', () => {
    const here = [party({ role: 'adverse', displayName: 'Acme Inc', matterId: M1 })];
    const other = [party({ role: 'client', displayName: 'acme, inc.', matterId: M2 })]; // normalized match
    const hits = computeConflictHits(here, other);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('blocker');
    expect(hits[0]!.matchBasis).toMatch(/ADVERSE in this matter but your CLIENT/);
    expect(hits[0]!.matchType).toBe('party_normalized'); // names differ pre-normalization
  });

  it('same client in two matters (no adverse) => REVIEW', () => {
    const here = [party({ role: 'client', displayName: 'Acme Inc', matterId: M1 })];
    const other = [party({ role: 'client', displayName: 'Acme Inc', matterId: M2 })];
    const hits = computeConflictHits(here, other);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('review');
    expect(hits[0]!.matchType).toBe('party_exact');
    expect(hasBlocker(hits)).toBe(false);
  });

  it('related/other role match => REVIEW (not a blocker)', () => {
    const here = [party({ role: 'related', displayName: 'Acme Inc', matterId: M1 })];
    const other = [party({ role: 'adverse', displayName: 'Acme Inc', matterId: M2 })];
    const hits = computeConflictHits(here, other);
    expect(hits[0]!.severity).toBe('review'); // related is not the client/adverse crossing
  });

  it('no name match => no hits', () => {
    const here = [party({ role: 'client', displayName: 'Acme Inc', matterId: M1 })];
    const other = [party({ role: 'adverse', displayName: 'Beta LLC', matterId: M2 })];
    expect(computeConflictHits(here, other)).toHaveLength(0);
  });

  it('empty normalized name is skipped (no spurious hits)', () => {
    const here = [party({ role: 'client', displayName: '   ', matterId: M1, normalizedName: '' })];
    const other = [party({ role: 'adverse', displayName: '   ', matterId: M2, normalizedName: '' })];
    expect(computeConflictHits(here, other)).toHaveLength(0);
  });

  it('does not match parties within the same matter (caller pre-excludes; engine matches given lists)', () => {
    // The engine matches thisParties × otherParties; the caller passes only OTHER matters.
    const here = [party({ role: 'client', displayName: 'Acme Inc', matterId: M1 })];
    const other: PartyLite[] = []; // no other matters
    expect(computeConflictHits(here, other)).toHaveLength(0);
  });
});

describe('FOLD-L0-1 — dispositionNeedsRationale (Fork A)', () => {
  it('blocker requires a rationale; review does not', () => {
    expect(dispositionNeedsRationale('blocker')).toBe(true);
    expect(dispositionNeedsRationale('review')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// suggestAnalysisLane — Fork E
// ---------------------------------------------------------------------------
describe('FOLD-L0-1 — suggestAnalysisLane (single-lane default, suggest-only)', () => {
  it('defaults to single with no flags', () => {
    expect(suggestAnalysisLane({})).toEqual({ defaultLane: 'single', suggestMulti: false, reason: expect.stringContaining('single-lane default') });
  });
  it('suggests multi for cross-jurisdictional, explainably', () => {
    const s = suggestAnalysisLane({ jurisdictions: ['VA', 'MD'] });
    expect(s.defaultLane).toBe('single');
    expect(s.suggestMulti).toBe(true);
    expect(s.reason).toMatch(/cross-jurisdictional .*VA\+MD/);
  });
  it('suggests multi for high-stakes/novel', () => {
    expect(suggestAnalysisLane({ highStakes: true }).suggestMulti).toBe(true);
    expect(suggestAnalysisLane({ novel: true }).reason).toMatch(/novel/);
  });
});

// ---------------------------------------------------------------------------
// Zod walls + disclosure
// ---------------------------------------------------------------------------
const now = new Date('2026-06-03T00:00:00Z');
describe('FOLD-L0-1 — Zod walls', () => {
  it('MatterPartyRow accepts canonical, rejects bad role', () => {
    const row = { id: '33333333-3333-3333-3333-333333333333', userId: M1, matterId: M1, role: 'client', displayName: 'Acme', normalizedName: 'acme', partyType: 'entity', source: 'attorney', aliasOfPartyId: null, externalIdentityKey: null, createdAt: now, updatedAt: now };
    expect(MatterPartyRowSchema.safeParse(row).success).toBe(true);
    expect(MatterPartyRowSchema.safeParse({ ...row, role: 'plaintiff' }).success).toBe(false);
  });
  it('ConflictHitRow accepts canonical, rejects bad severity/disposition', () => {
    const row = { id: '44444444-4444-4444-4444-444444444444', userId: M1, checkId: '55555555-5555-5555-5555-555555555555', matterId: M1, matchedMatterId: M2, thisPartyId: null, matchedPartyId: null, matchBasis: 'x', matchType: 'party_exact', severity: 'blocker', disposition: 'pending', dispositionRationale: null, dispositionedByEventId: null, createdAt: now, updatedAt: now };
    expect(ConflictHitRowSchema.safeParse(row).success).toBe(true);
    expect(ConflictHitRowSchema.safeParse({ ...row, severity: 'critical' }).success).toBe(false);
    expect(ConflictHitRowSchema.safeParse({ ...row, disposition: 'maybe' }).success).toBe(false);
  });
  it('MatterAnalysisRow carries the non-sendable type flags (Fork F)', () => {
    const row = { id: '66666666-6666-6666-6666-666666666666', userId: M1, matterId: M1, status: 'draft', assessment: null, plan: null, openQuestions: null, recommendedDocuments: null, conflictCheckId: null, conflictsClearedForPlanning: false, modelLane: 'single', generatedByJobId: null, lockedByEventId: null, lockedAt: null, lockRationale: null, supersededById: null, artifactKind: 'matter_analysis', outboundEligible: false, sendabilityRequired: false, sendabilityStatus: 'not_applicable', createdAt: now, updatedAt: now };
    expect(MatterAnalysisRowSchema.safeParse(row).success).toBe(true);
  });
  it('the false-negative disclosure states the exact/normalized-name-only limit', () => {
    expect(CONFLICT_FALSE_NEGATIVE_DISCLOSURE).toMatch(/EXACT and NORMALIZED NAME matches/);
    expect(CONFLICT_FALSE_NEGATIVE_DISCLOSURE).toMatch(/informed professional judgment/);
  });
});

// ---------------------------------------------------------------------------
// Source audits of the wiring
// ---------------------------------------------------------------------------
function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}
describe('FOLD-L0-1 — wiring (source audit)', () => {
  const conflicts = readSrc('../db/queries/conflicts.ts');
  const parties = readSrc('../db/queries/matterParties.ts');
  const analysis = readSrc('../db/queries/matterAnalysis.ts');
  const router = readSrc('../router.ts');
  const migration = readSrc('../db/migrations/0007_fold_l0_1_matter_intake_analysis.sql');
  const runner = readSrc('../../../scripts/apply-prod-migrations.mjs');

  it('conflicts check is deterministic/DB-side — NO LLM import (Fork G)', () => {
    expect(conflicts).not.toMatch(/resolveAdapter|executeCanonicalMutation|llm\//);
    expect(conflicts).toMatch(/computeConflictHits/);
  });
  it('disposing a BLOCKER requires a rationale (Fork A)', () => {
    expect(conflicts).toMatch(/RATIONALE_REQUIRED/);
    expect(conflicts).toMatch(/dispositionNeedsRationale\(hit\.severity\)/);
  });
  it('lock-plan is gated on conflicts checked + dispositioned (Fork A)', () => {
    expect(analysis).toMatch(/CONFLICTS_NOT_CHECKED/);
    expect(analysis).toMatch(/CONFLICTS_UNDISPOSITIONED/);
    expect(analysis).toMatch(/allHitsDispositionedForLatest/);
  });
  it('analysis is created as a non-sendable type (Fork F)', () => {
    expect(analysis).toMatch(/outboundEligible: false/);
    expect(analysis).toMatch(/sendabilityStatus: 'not_applicable'/);
  });
  it('new query layers owner-scope via ownerScope(), never inline eq(table.userId)', () => {
    for (const src of [conflicts, parties, analysis]) {
      expect(src).toMatch(/ownerScope\(/);
      expect(src).not.toMatch(/eq\(\w+\.userId/);
    }
  });
  it('the cross-matter read excludes the current matter (Fork G)', () => {
    expect(parties).toMatch(/listOtherPartiesForOwner/);
    expect(parties).toMatch(/ne\(matterParties\.matterId, excludeMatterId\)/);
  });
  it('migration 0007 is additive and on the pre-deploy allowlist', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS `analysisStatus`/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS `matter_parties`/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS `conflict_hits`/);
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN/i);
    expect(runner).toMatch(/0007_fold_l0_1_matter_intake_analysis\.sql/);
  });
  it('router registers matterIntake', () => {
    expect(router).toMatch(/matterIntake: matterIntakeRouter/);
  });
});
