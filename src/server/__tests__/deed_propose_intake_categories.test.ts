/**
 * EXPRESS-FANOUT-1 — category-aware "describe the deal" parse (deedProposeIntakeCategories).
 *
 * Two layers, mirroring the Gift proposeIntake tests: (1) the PURE per-category validators
 * (fail-closed normalization; the model proposes routine fields only, never the attorney-verbatim
 * ones); (2) the string-content contract (the broker returns structured output as a STRING, so the
 * validator must coerce it — and .strict() must still reject a smuggled forbidden field).
 */
import { describe, expect, it } from 'vitest';
import {
  validateProposeSellerSideOutput,
  ProposeSellerSideOutputSchema,
} from '../deed/deedProposeIntakeCategories.js';

describe('EXPRESS-FANOUT-1 seller-side proposeIntake (pure: fail-closed normalization)', () => {
  it('a well-formed proposal normalizes to status:proposed with the routine fields', () => {
    const r = validateProposeSellerSideOutput({
      grantees: [{ name: 'Marcus T. Bell' }, { name: 'Renee Bell' }],
      warrantyType: 'General Warranty',
      consideration: '$450,000.00',
      confident: true,
    });
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('expected proposed');
    expect(r.proposal.grantees).toEqual([{ name: 'Marcus T. Bell' }, { name: 'Renee Bell' }]);
    expect(r.proposal.warrantyType).toBe('General Warranty');
    expect(r.proposal.consideration).toBe('$450,000.00');
  });

  it('CONTRACT: a JSON STRING (the broker content shape) parses to status:proposed', () => {
    const payload = JSON.stringify({ grantees: [{ name: 'A. Buyer' }], confident: true });
    expect(validateProposeSellerSideOutput(payload).status).toBe('proposed');
  });

  it('CONTRACT: a markdown-fenced JSON string still parses (fence-stripped)', () => {
    const payload = '```json\n' + JSON.stringify({ grantees: [{ name: 'A. Buyer' }], confident: true }) + '\n```';
    expect(validateProposeSellerSideOutput(payload).status).toBe('proposed');
  });

  it('CONTRACT: a non-JSON string fails closed → needs_clarification', () => {
    expect(validateProposeSellerSideOutput('the buyer is my client').status).toBe('needs_clarification');
  });

  it('low confidence (model confident=false) → needs_clarification, NO proposal', () => {
    const r = validateProposeSellerSideOutput({
      grantees: [{ name: 'A. Buyer' }],
      confident: false,
      clarifyingQuestions: ['Which entity is buying — the LLC or the individuals?'],
    });
    expect(r.status).toBe('needs_clarification');
    if (r.status !== 'needs_clarification') throw new Error('expected needs_clarification');
    expect(r.questions).toContain('Which entity is buying — the LLC or the individuals?');
  });

  it('a warrantyType that is NOT a recognized option → needs_clarification (never passed through)', () => {
    const r = validateProposeSellerSideOutput({ grantees: [{ name: 'A. Buyer' }], warrantyType: 'Super Warranty' });
    expect(r.status).toBe('needs_clarification');
    if (r.status !== 'needs_clarification') throw new Error('expected needs_clarification');
    expect(r.questions.join(' ')).toMatch(/not a recognized option/i);
  });

  it('no grantees → needs_clarification (a conveyance needs at least one named buyer)', () => {
    expect(validateProposeSellerSideOutput({ grantees: [], confident: true }).status).toBe('needs_clarification');
  });

  it('SAFETY: .strict() rejects a model-authored legal description or vesting recital → needs_clarification', () => {
    // A smuggled forbidden field must NOT pass — the attorney-verbatim recital / extraction-only legal is
    // never accepted from the model.
    expect(
      validateProposeSellerSideOutput({ grantees: [{ name: 'A. Buyer' }], legalDescription: 'Lot 5, Block C...' }).status,
    ).toBe('needs_clarification');
    expect(
      validateProposeSellerSideOutput({ grantees: [{ name: 'A. Buyer' }], vestingRecital: 'BEING the same property...' })
        .status,
    ).toBe('needs_clarification');
  });

  it('SAFETY: the proposal carries NO legal / vesting-recital field', () => {
    const r = validateProposeSellerSideOutput({ grantees: [{ name: 'A. Buyer' }], confident: true });
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('expected proposed');
    const keys = Object.keys(r.proposal);
    expect(keys).not.toContain('legalDescription');
    expect(keys).not.toContain('vestingRecital');
  });

  it('a benign grantor echo is accepted + ignored (grantor is extraction / prior-deed, never the model)', () => {
    const r = validateProposeSellerSideOutput({
      grantees: [{ name: 'A. Buyer' }],
      grantors: [{ name: 'Prior Owner' }],
      confident: true,
    });
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('expected proposed');
    expect(Object.keys(r.proposal)).not.toContain('grantors');
  });

  it('the schema is strict (rejects unknown keys at the type level)', () => {
    expect(ProposeSellerSideOutputSchema.safeParse({ grantees: [], nope: 1 }).success).toBe(false);
  });
});
