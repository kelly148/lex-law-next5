/**
 * FOLD-DRAFT-1 Increment 1 — provision_provenance data core (Zod Wall).
 *
 * Tests the additive Zod-Wall schema (the testable core). The owner-scoped queries
 * (insert / list-by-version / list-by-document) run live (no test DB); they follow the
 * established ownerScope() + parse-on-read pattern.
 */

import { describe, it, expect } from 'vitest';
import { ProvisionProvenanceRowSchema } from '../../shared/schemas/provisionProvenance.js';

const BASE_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  matterId: '33333333-3333-3333-3333-333333333333',
  documentId: '44444444-4444-4444-4444-444444444444',
  versionId: '55555555-5555-5555-5555-555555555555',
  orderIndex: 0,
  sectionTitle: 'Recitals',
  originType: 'operative_source' as const,
  originId: '66666666-6666-6666-6666-666666666666',
  originLabel: 'Operative LOI v2',
  recordedBy: 'attorney' as const,
  notes: null,
  createdAt: new Date('2026-06-04T00:00:00Z'),
  updatedAt: new Date('2026-06-04T00:00:00Z'),
};

describe('FOLD-DRAFT-1 Inc1 — ProvisionProvenanceRowSchema', () => {
  it('parses a valid provenance row', () => {
    expect(ProvisionProvenanceRowSchema.safeParse(BASE_ROW).success).toBe(true);
  });

  it('accepts all defined origin types', () => {
    for (const originType of [
      'operative_source',
      'material',
      'adopted_suggestion',
      'template',
      'attorney_authored',
      'model_generated',
      'loi',
    ]) {
      expect(ProvisionProvenanceRowSchema.safeParse({ ...BASE_ROW, originType }).success).toBe(true);
    }
  });

  it('allows a null originId (attorney_authored / model_generated have no source id)', () => {
    const parsed = ProvisionProvenanceRowSchema.parse({
      ...BASE_ROW,
      originType: 'attorney_authored',
      originId: null,
      originLabel: null,
    });
    expect(parsed.originId).toBeNull();
    expect(parsed.recordedBy).toBe('attorney');
  });

  it('rejects an unknown originType', () => {
    expect(ProvisionProvenanceRowSchema.safeParse({ ...BASE_ROW, originType: 'made_up' }).success).toBe(false);
  });

  it('rejects an unknown recordedBy', () => {
    expect(ProvisionProvenanceRowSchema.safeParse({ ...BASE_ROW, recordedBy: 'robot' }).success).toBe(false);
  });

  it('rejects a negative orderIndex', () => {
    expect(ProvisionProvenanceRowSchema.safeParse({ ...BASE_ROW, orderIndex: -1 }).success).toBe(false);
  });
});
