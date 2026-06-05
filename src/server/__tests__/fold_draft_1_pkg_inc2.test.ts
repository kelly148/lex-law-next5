/**
 * FOLD-DRAFT-1 / package Increment 2 — completeness engine + itemType/refId invariant.
 *
 * Both units are PURE (no DB, no LLM), so they are exercised directly. The tRPC router
 * (record / listForMatter / getClosureCheck) runs live (no test DB) and follows the established
 * owner-checked + audited pattern.
 */

import { describe, it, expect } from 'vitest';
import { computeClosure, type ClosureItemInput } from '../draft/closureCheck.js';
import { validateClosurePackageItemRef, itemRequiresRef } from '../draft/closurePackageRules.js';
import type { ClosurePackageItemType } from '../../shared/schemas/closurePackage.js';

const item = (
  id: string,
  label: string,
  requirement: 'required' | 'optional',
  status: 'present' | 'missing' | 'not_applicable',
): ClosureItemInput => ({ id, label, requirement, status });

describe('FOLD-DRAFT-1 package Inc2 — computeClosure (advisory completeness)', () => {
  it('is complete when every required item is present', () => {
    const r = computeClosure([
      item('a', 'Executed POA', 'required', 'present'),
      item('b', 'Cover letter', 'optional', 'missing'),
    ]);
    expect(r.complete).toBe(true);
    expect(r.requiredTotal).toBe(1);
    expect(r.requiredPresent).toBe(1);
    expect(r.requiredMissing).toBe(0);
    expect(r.missingLabels).toEqual([]);
  });

  it('is incomplete when a required item is missing, and lists it (order-stable)', () => {
    const r = computeClosure([
      item('a', 'Executed POA', 'required', 'missing'),
      item('b', 'Notary block', 'required', 'present'),
      item('c', 'Witness signature', 'required', 'missing'),
    ]);
    expect(r.complete).toBe(false);
    expect(r.requiredMissing).toBe(2);
    expect(r.missingLabels).toEqual(['Executed POA', 'Witness signature']);
  });

  it('treats a not_applicable required item as resolved (not a blocker)', () => {
    const r = computeClosure([item('a', 'Spousal consent', 'required', 'not_applicable')]);
    expect(r.complete).toBe(true);
    expect(r.requiredMissing).toBe(0);
    expect(r.requiredPresent).toBe(0); // n/a is not counted as present, but it does not block
  });

  it('optional items never block completeness', () => {
    const r = computeClosure([
      item('a', 'Required doc', 'required', 'present'),
      item('b', 'Optional memo', 'optional', 'missing'),
    ]);
    expect(r.complete).toBe(true);
    expect(r.total).toBe(2);
  });

  it('an empty package is vacuously complete', () => {
    const r = computeClosure([]);
    expect(r).toEqual({
      total: 0,
      requiredTotal: 0,
      requiredPresent: 0,
      requiredMissing: 0,
      complete: true,
      missingLabels: [],
    });
  });
});

describe('FOLD-DRAFT-1 package Inc2 — validateClosurePackageItemRef (itemType/refId invariant)', () => {
  it('requires a refId for artifact-referencing types', () => {
    for (const itemType of ['document', 'material', 'source'] as ClosurePackageItemType[]) {
      expect(itemRequiresRef(itemType)).toBe(true);
      expect(validateClosurePackageItemRef(itemType, null).ok).toBe(false);
      expect(validateClosurePackageItemRef(itemType, '   ').ok).toBe(false); // blank treated as absent
      expect(validateClosurePackageItemRef(itemType, 'doc-1').ok).toBe(true);
    }
  });

  it('forbids a refId for a checklist item', () => {
    expect(itemRequiresRef('checklist')).toBe(false);
    expect(validateClosurePackageItemRef('checklist', null).ok).toBe(true);
    expect(validateClosurePackageItemRef('checklist', 'doc-1').ok).toBe(false);
  });
});
