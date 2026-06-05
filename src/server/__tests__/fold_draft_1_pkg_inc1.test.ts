/**
 * FOLD-DRAFT-1 / package Increment 1 — closure_package_item data core (Zod Wall).
 *
 * Tests the additive Zod-Wall schema (the testable core). The owner-scoped queries
 * (insert / list-by-matter / list-by-package) run live (no test DB); they follow the
 * established ownerScope() + parse-on-read pattern.
 */

import { describe, it, expect } from 'vitest';
import { ClosurePackageItemRowSchema } from '../../shared/schemas/closurePackage.js';

const BASE_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  matterId: '33333333-3333-3333-3333-333333333333',
  packageName: 'Closing Binder',
  itemType: 'document' as const,
  refId: '44444444-4444-4444-4444-444444444444',
  label: 'Executed Durable POA',
  requirement: 'required' as const,
  status: 'present' as const,
  notes: null,
  recordedBy: 'attorney' as const,
  createdAt: new Date('2026-06-04T00:00:00Z'),
  updatedAt: new Date('2026-06-04T00:00:00Z'),
};

describe('FOLD-DRAFT-1 package Inc1 — ClosurePackageItemRowSchema', () => {
  it('parses a valid closure-package item', () => {
    expect(ClosurePackageItemRowSchema.safeParse(BASE_ROW).success).toBe(true);
  });

  it('accepts all defined item types', () => {
    for (const itemType of ['document', 'material', 'source', 'checklist']) {
      expect(ClosurePackageItemRowSchema.safeParse({ ...BASE_ROW, itemType }).success).toBe(true);
    }
  });

  it('accepts all defined requirement + status values', () => {
    for (const requirement of ['required', 'optional']) {
      expect(ClosurePackageItemRowSchema.safeParse({ ...BASE_ROW, requirement }).success).toBe(true);
    }
    for (const status of ['present', 'missing', 'not_applicable']) {
      expect(ClosurePackageItemRowSchema.safeParse({ ...BASE_ROW, status }).success).toBe(true);
    }
  });

  it('allows a null refId (a checklist item has no concrete ref)', () => {
    const parsed = ClosurePackageItemRowSchema.parse({
      ...BASE_ROW,
      itemType: 'checklist',
      refId: null,
      label: 'Confirm notary commission current',
    });
    expect(parsed.refId).toBeNull();
    expect(parsed.itemType).toBe('checklist');
  });

  it('rejects an unknown itemType', () => {
    expect(ClosurePackageItemRowSchema.safeParse({ ...BASE_ROW, itemType: 'made_up' }).success).toBe(false);
  });

  it('rejects an unknown requirement', () => {
    expect(ClosurePackageItemRowSchema.safeParse({ ...BASE_ROW, requirement: 'maybe' }).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(ClosurePackageItemRowSchema.safeParse({ ...BASE_ROW, status: 'partial' }).success).toBe(false);
  });

  it('rejects a row missing the required label', () => {
    const { label, ...rest } = BASE_ROW;
    expect(label).toBeTypeOf('string'); // the fixture had it; rest omits it
    expect(ClosurePackageItemRowSchema.safeParse(rest).success).toBe(false);
  });
});
