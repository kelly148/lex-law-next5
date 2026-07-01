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
  validateProposeIntoLlcOutput,
  validateProposeOutOfLlcOutput,
  validateProposeTodOutput,
  validateProposeConfirmationOutput,
  validateProposeIntoTrustOutput,
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

describe('EXPRESS-FANOUT-1 into-LLC proposeIntake (pure: fail-closed normalization)', () => {
  it('a well-formed proposal → proposed with the bare LLC name (no designator authored)', () => {
    const r = validateProposeIntoLlcOutput({
      granteeLlc: 'Ridgeline Holdings',
      grantors: [{ name: 'Dana Ortiz' }],
      consideration: '$10.00',
      confident: true,
    });
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('expected proposed');
    expect(r.proposal.granteeLlc).toBe('Ridgeline Holdings');
    expect(r.proposal.grantors).toEqual([{ name: 'Dana Ortiz' }]);
  });

  it('CONTRACT: a JSON string parses; a non-JSON string fails closed', () => {
    expect(validateProposeIntoLlcOutput(JSON.stringify({ granteeLlc: 'Acme Homes', confident: true })).status).toBe('proposed');
    expect(validateProposeIntoLlcOutput('transfer to my LLC').status).toBe('needs_clarification');
  });

  it('no destination LLC named → needs_clarification', () => {
    expect(validateProposeIntoLlcOutput({ grantors: [{ name: 'Dana Ortiz' }], confident: true }).status).toBe('needs_clarification');
  });

  it('SAFETY: .strict() rejects a smuggled legal description / derivation → needs_clarification', () => {
    expect(validateProposeIntoLlcOutput({ granteeLlc: 'Acme', legalDescription: 'Lot 1...' }).status).toBe('needs_clarification');
    expect(validateProposeIntoLlcOutput({ granteeLlc: 'Acme', derivationOfTitle: 'BEING...' }).status).toBe('needs_clarification');
  });
});

describe('EXPRESS-FANOUT-1 out-of-LLC proposeIntake (pure: fail-closed normalization)', () => {
  it('a well-formed proposal → proposed with signing members + details', () => {
    const r = validateProposeOutOfLlcOutput({
      members: [{ name: 'Dana Ortiz' }, { name: 'Sam Package' }],
      consideration: '$10.00',
      executionMonth: 'June',
      executionYear: '2026',
      confident: true,
    });
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('expected proposed');
    expect(r.proposal.members).toEqual([{ name: 'Dana Ortiz' }, { name: 'Sam Package' }]);
    expect(r.proposal.executionYear).toBe('2026');
  });

  it('CONTRACT: a JSON string parses; low confidence fails closed', () => {
    expect(validateProposeOutOfLlcOutput(JSON.stringify({ members: [{ name: 'A' }], confident: true })).status).toBe('proposed');
    expect(validateProposeOutOfLlcOutput({ members: [{ name: 'A' }], confident: false }).status).toBe('needs_clarification');
  });

  it('SAFETY: .strict() rejects a smuggled return-to / notary / legal field → needs_clarification', () => {
    expect(validateProposeOutOfLlcOutput({ members: [{ name: 'A' }], returnTo: { company: 'X' } }).status).toBe('needs_clarification');
    expect(validateProposeOutOfLlcOutput({ members: [{ name: 'A' }], legalDescription: 'Lot 1...' }).status).toBe('needs_clarification');
  });
});

describe('EXPRESS-FANOUT-1 TOD proposeIntake (pure: fail-closed normalization)', () => {
  it('a well-formed proposal → proposed with beneficiaries + vesting', () => {
    const r = validateProposeTodOutput({
      beneficiaries: [{ name: 'Ivy Chen', relationship: 'daughter' }],
      vesting: 'as joint tenants with the right of survivorship',
      confident: true,
    });
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('expected proposed');
    expect(r.proposal.beneficiaries).toEqual([{ name: 'Ivy Chen', relationship: 'daughter' }]);
    expect(r.proposal.vesting).toMatch(/survivorship/);
  });

  it('CONTRACT + fail-closed: JSON string parses; no beneficiaries → needs_clarification', () => {
    expect(validateProposeTodOutput(JSON.stringify({ beneficiaries: [{ name: 'A' }], confident: true })).status).toBe('proposed');
    expect(validateProposeTodOutput({ beneficiaries: [], confident: true }).status).toBe('needs_clarification');
  });

  it('SAFETY: .strict() rejects a model-authored revocation block / legal → needs_clarification', () => {
    expect(validateProposeTodOutput({ beneficiaries: [{ name: 'A' }], revocationBlock: 'This TOD deed may be revoked...' }).status).toBe('needs_clarification');
    expect(validateProposeTodOutput({ beneficiaries: [{ name: 'A' }], legalDescription: 'Lot 1...' }).status).toBe('needs_clarification');
  });
});

describe('EXPRESS-FANOUT-1 confirmation proposeIntake (STRICTEST: archetype only)', () => {
  it('proposes ONLY a valid archetype', () => {
    const r = validateProposeConfirmationOutput({ archetype: 'C1-a-survivorship', confident: true });
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('expected proposed');
    expect(r.proposal).toEqual({ archetype: 'C1-a-survivorship' });
  });

  it('an absent or invalid archetype → needs_clarification', () => {
    expect(validateProposeConfirmationOutput({ confident: true }).status).toBe('needs_clarification');
    expect(validateProposeConfirmationOutput({ archetype: 'C9-nonsense', confident: true }).status).toBe('needs_clarification');
  });

  it('SAFETY: .strict() rejects ANY chain-of-title fact (the chain is 100% attorney-entered)', () => {
    // A model attempting to propose any chain link must be rejected outright.
    expect(validateProposeConfirmationOutput({ archetype: 'C1-a-survivorship', decedent: 'Jane Doe' }).status).toBe('needs_clarification');
    expect(validateProposeConfirmationOutput({ archetype: 'C1-b-testate-devise', originalGrantors: ['X'], vestingDeedDate: '2001-01-01' }).status).toBe('needs_clarification');
    expect(validateProposeConfirmationOutput({ archetype: 'C1-a-survivorship', legalDescription: 'Lot 1...' }).status).toBe('needs_clarification');
  });
});

describe('EXPRESS-FANOUT-1 into-trust proposeIntake (CRITICAL: trusteesRecital never proposable)', () => {
  it('proposes routine fields (exemplar, grantors, structure) — never a trustees recital', () => {
    const r = validateProposeIntoTrustOutput({
      exemplar: 'A',
      grantors: [{ name: 'Harold Vance' }, { name: 'Nadia Vance' }],
      grantorMaritalStatus: 'married',
      trustStructure: 'joint revocable living trust',
      confident: true,
    });
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('expected proposed');
    expect(r.proposal.exemplar).toBe('A');
    expect(r.proposal.grantors).toEqual([{ name: 'Harold Vance' }, { name: 'Nadia Vance' }]);
    expect(Object.keys(r.proposal)).not.toContain('trusteesRecital');
  });

  it('CONTRACT + fail-closed: JSON string parses; an empty/nothing proposal → needs_clarification', () => {
    expect(validateProposeIntoTrustOutput(JSON.stringify({ exemplar: 'B', confident: true })).status).toBe('proposed');
    expect(validateProposeIntoTrustOutput({ confident: true }).status).toBe('needs_clarification');
  });

  it('an invalid exemplar → needs_clarification', () => {
    expect(validateProposeIntoTrustOutput({ exemplar: 'Z', confident: true }).status).toBe('needs_clarification');
  });

  it('SAFETY (CRITICAL): .strict() rejects a model-authored trusteesRecital / beingRecital / legal → needs_clarification', () => {
    expect(
      validateProposeIntoTrustOutput({ exemplar: 'A', trusteesRecital: 'The Grantors transfer to X and Y, Trustees...' }).status,
    ).toBe('needs_clarification');
    expect(validateProposeIntoTrustOutput({ exemplar: 'A', beingRecital: { priorConveyance: '...' } }).status).toBe('needs_clarification');
    expect(validateProposeIntoTrustOutput({ exemplar: 'A', legalDescription: 'Lot 1...' }).status).toBe('needs_clarification');
  });
});
