/**
 * FOLD-ORCH-1 Increment 3a — orchestration persistence layer.
 *
 * Tests the PURE divergent-open-item construction (Fork E, content-preserving) and the additive
 * Zod-Wall changes (adopt_ledger.confirmationMode — the per-item CONFIRMATION MODE never flattened
 * to "adopted"; open_items.detail — the content-preserving divergent payload). The DB writes
 * (insertAdoptLedgerEntry confirmationMode, registerDivergentOpenItem) run live, not in unit tests
 * (no test DB).
 */

import { describe, it, expect } from 'vitest';
import {
  mapOrchSeverityToOpenItemSeverity,
  buildDivergentOpenItem,
  divergentOpenItemRegistration,
} from '../orchestration/divergentOpenItem.js';
import { DivergentOpenItemSchema, type OrchestrationGroup } from '../../shared/schemas/orchestration.js';
import { AdoptLedgerRowSchema } from '../../shared/schemas/phase4b.js';
import { OpenItemRowSchema } from '../../shared/schemas/openItems.js';

function group(over: Partial<OrchestrationGroup> = {}): OrchestrationGroup {
  return {
    issueId: 'i1',
    severity: 'SUBSTANTIVE',
    reviewerMembers: ['claude', 'gpt'],
    divergent: true,
    positions: [
      { reviewerRole: 'claude', suggestionId: 'c1', position: 'Add a cap.', severity: 'SUBSTANTIVE', rationaleExcerpt: null },
      { reviewerRole: 'gpt', suggestionId: 'g1', position: 'No cap needed.', severity: 'STRUCTURAL', rationaleExcerpt: null },
    ],
    evaluatorSynthesis: 'Reviewers split on whether to add a liability cap.',
    ...over,
  };
}

// ============================================================
// A. mapOrchSeverityToOpenItemSeverity
// ============================================================
describe('FOLD-ORCH-1 Inc3a — mapOrchSeverityToOpenItemSeverity', () => {
  it('BLOCKER -> blocker (send-blocking)', () => {
    expect(mapOrchSeverityToOpenItemSeverity('BLOCKER')).toBe('blocker');
    expect(mapOrchSeverityToOpenItemSeverity('blocker')).toBe('blocker'); // case-insensitive
  });
  it('PRECISION/POLISH -> polish', () => {
    expect(mapOrchSeverityToOpenItemSeverity('PRECISION')).toBe('polish');
    expect(mapOrchSeverityToOpenItemSeverity('POLISH')).toBe('polish');
  });
  it('SUBSTANTIVE/STRUCTURAL -> substantive', () => {
    expect(mapOrchSeverityToOpenItemSeverity('SUBSTANTIVE')).toBe('substantive');
    expect(mapOrchSeverityToOpenItemSeverity('STRUCTURAL')).toBe('substantive');
  });
  it('unknown/empty -> substantive (never silently downgraded)', () => {
    expect(mapOrchSeverityToOpenItemSeverity('')).toBe('substantive');
    expect(mapOrchSeverityToOpenItemSeverity('weird')).toBe('substantive');
  });
});

// ============================================================
// B. buildDivergentOpenItem — content-preserving
// ============================================================
describe('FOLD-ORCH-1 Inc3a — buildDivergentOpenItem', () => {
  it('uses the evaluator synthesis as the issue summary and preserves positions', () => {
    const built = buildDivergentOpenItem(group(), 'sess-1');
    expect(built.issueSummary).toContain('liability cap');
    expect(built.positions).toHaveLength(2);
    expect(built.evaluatorSynthesis).toContain('split');
    expect(built.sourceReviewSessionId).toBe('sess-1');
    expect(DivergentOpenItemSchema.safeParse(built).success).toBe(true);
  });

  it('falls back to a derived summary when there is no synthesis', () => {
    const built = buildDivergentOpenItem(group({ evaluatorSynthesis: null }), 'sess-1');
    expect(built.issueSummary).toContain('i1');
    expect(built.evaluatorSynthesis).toBeNull();
  });

  it('preserves positions even when the group has none (empty array, not undefined)', () => {
    const built = buildDivergentOpenItem(group({ positions: undefined }), 'sess-1');
    expect(built.positions).toEqual([]);
    expect(DivergentOpenItemSchema.safeParse(built).success).toBe(true);
  });
});

// ============================================================
// C. divergentOpenItemRegistration — the registration projection
// ============================================================
describe('FOLD-ORCH-1 Inc3a — divergentOpenItemRegistration', () => {
  it('composes severity + summary + detail', () => {
    const reg = divergentOpenItemRegistration(group({ severity: 'BLOCKER' }), 'sess-1');
    expect(reg.severity).toBe('blocker');
    expect(reg.summary).toBe(reg.detail.issueSummary);
    expect(reg.detail.positions).toHaveLength(2);
  });
});

// ============================================================
// D. Zod Wall — adopt_ledger.confirmationMode (additive)
// ============================================================
const BASE_LEDGER = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  documentId: '33333333-3333-3333-3333-333333333333',
  matterId: '44444444-4444-4444-4444-444444444444',
  sourceSuggestionId: 'c1',
  sourceReviewerRole: 'claude',
  sourceIterationNumber: 1,
  reviewSessionId: '55555555-5555-5555-5555-555555555555',
  disposition: 'adopted_verbatim' as const,
  originalText: 'x',
  adoptedText: 'x',
  adoptedIntoVersionId: '66666666-6666-6666-6666-666666666666',
  producedVersionId: null,
  status: 'unresolved' as const,
  statusSource: 'auto' as const,
  createdAt: new Date('2026-06-04T00:00:00Z'),
  updatedAt: new Date('2026-06-04T00:00:00Z'),
};

describe('FOLD-ORCH-1 Inc3a — adopt_ledger.confirmationMode Zod Wall', () => {
  it('parses WITHOUT confirmationMode (back-compat / pre-ORCH rows)', () => {
    expect(AdoptLedgerRowSchema.safeParse(BASE_LEDGER).success).toBe(true);
  });
  it('parses with a valid confirmationMode', () => {
    const parsed = AdoptLedgerRowSchema.parse({
      ...BASE_LEDGER,
      confirmationMode: 'bulk_acknowledged_low_severity_convergent',
    });
    expect(parsed.confirmationMode).toBe('bulk_acknowledged_low_severity_convergent');
  });
  it('parses with confirmationMode = null', () => {
    expect(AdoptLedgerRowSchema.safeParse({ ...BASE_LEDGER, confirmationMode: null }).success).toBe(true);
  });
  it('rejects an invalid confirmationMode', () => {
    expect(AdoptLedgerRowSchema.safeParse({ ...BASE_LEDGER, confirmationMode: 'adopted' }).success).toBe(false);
  });
});

// ============================================================
// E. Zod Wall — open_items.detail (additive)
// ============================================================
const BASE_OPEN_ITEM = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  matterId: '44444444-4444-4444-4444-444444444444',
  documentId: null,
  category: 'divergent_reviewer_feedback',
  severity: 'substantive' as const,
  summary: 'Reviewers disagree.',
  status: 'open' as const,
  statusSource: 'auto' as const,
  origin: 'orchestration',
  confidence: null,
  requiresAttorneyConfirmation: true,
  sourceSuggestionId: null,
  reviewSessionId: null,
  versionId: null,
  lastSeenAt: null,
  resolvedByEventId: null,
  resolutionRationale: null,
  createdAt: new Date('2026-06-04T00:00:00Z'),
  updatedAt: new Date('2026-06-04T00:00:00Z'),
};

describe('FOLD-ORCH-1 Inc3a — open_items.detail Zod Wall', () => {
  it('parses WITHOUT detail (back-compat / non-orchestration rows)', () => {
    expect(OpenItemRowSchema.safeParse(BASE_OPEN_ITEM).success).toBe(true);
  });
  it('parses with a content-preserving detail payload', () => {
    const detail = buildDivergentOpenItem(group(), 'sess-1');
    const parsed = OpenItemRowSchema.parse({ ...BASE_OPEN_ITEM, detail });
    expect(parsed.detail).toBeTruthy();
  });
  it('parses with detail = null', () => {
    expect(OpenItemRowSchema.safeParse({ ...BASE_OPEN_ITEM, detail: null }).success).toBe(true);
  });
});
