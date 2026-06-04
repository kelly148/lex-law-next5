/**
 * FOLD-DRAFT-1 / LDD Increment 1 — ldd_key_term data core (Zod Wall).
 *
 * Tests the additive Zod-Wall schema (the testable core). The owner-scoped queries
 * (insert / list-by-version / list-by-document) run live (no test DB); they follow the
 * established ownerScope() + parse-on-read pattern (mirrors provision_provenance).
 */

import { describe, it, expect } from 'vitest';
import { LddKeyTermRowSchema } from '../../shared/schemas/lddKeyTerm.js';

const BASE_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  matterId: '33333333-3333-3333-3333-333333333333',
  documentId: '44444444-4444-4444-4444-444444444444',
  versionId: '55555555-5555-5555-5555-555555555555',
  termLabel: 'Governing Law',
  expectedValue: 'Commonwealth of Virginia',
  sourceType: 'loi' as const,
  sourceId: '66666666-6666-6666-6666-666666666666',
  notes: null,
  recordedBy: 'attorney' as const,
  createdAt: new Date('2026-06-04T00:00:00Z'),
  updatedAt: new Date('2026-06-04T00:00:00Z'),
};

describe('FOLD-DRAFT-1 LDD Inc1 — LddKeyTermRowSchema', () => {
  it('parses a valid key-term row', () => {
    expect(LddKeyTermRowSchema.safeParse(BASE_ROW).success).toBe(true);
  });

  it('accepts all defined source types', () => {
    for (const sourceType of ['loi', 'operative_source', 'material', 'attorney_specified']) {
      expect(LddKeyTermRowSchema.safeParse({ ...BASE_ROW, sourceType }).success).toBe(true);
    }
  });

  it('allows a null sourceId (attorney_specified has no concrete source id)', () => {
    const parsed = LddKeyTermRowSchema.parse({
      ...BASE_ROW,
      sourceType: 'attorney_specified',
      sourceId: null,
    });
    expect(parsed.sourceId).toBeNull();
    expect(parsed.recordedBy).toBe('attorney');
  });

  it('preserves the term label and expected value verbatim', () => {
    const parsed = LddKeyTermRowSchema.parse({ ...BASE_ROW, termLabel: 'Purchase Price', expectedValue: '$1,200,000' });
    expect(parsed.termLabel).toBe('Purchase Price');
    expect(parsed.expectedValue).toBe('$1,200,000');
  });

  it('rejects an unknown sourceType', () => {
    expect(LddKeyTermRowSchema.safeParse({ ...BASE_ROW, sourceType: 'made_up' }).success).toBe(false);
  });

  it('rejects an unknown recordedBy', () => {
    expect(LddKeyTermRowSchema.safeParse({ ...BASE_ROW, recordedBy: 'robot' }).success).toBe(false);
  });

  it('rejects a non-string expectedValue', () => {
    expect(LddKeyTermRowSchema.safeParse({ ...BASE_ROW, expectedValue: 123 }).success).toBe(false);
  });

  it('rejects a row missing the required termLabel', () => {
    const { termLabel, ...rest } = BASE_ROW;
    expect(termLabel).toBeTypeOf('string'); // the fixture had it; rest omits it
    expect(LddKeyTermRowSchema.safeParse(rest).success).toBe(false);
  });
});
