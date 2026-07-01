import { describe, expect, it } from 'vitest';
import {
  sellerProposalToFields,
  intoLlcProposalToFields,
  outOfLlcProposalToFields,
  todProposalToFields,
  confirmationProposalToFields,
  intoTrustProposalToFields,
} from '../quickDeedProposalApply.js';

describe('EXPRESS-FANOUT-1 sellerProposalToFields (client apply mapping)', () => {
  it('maps the routine fields (buyer grantees, warranty, price) onto form updates', () => {
    const f = sellerProposalToFields({
      grantees: [{ name: 'Marcus T. Bell', relationship: 'buyer' }, { name: 'Renee Bell' }],
      warrantyType: 'General Warranty',
      consideration: '$450,000.00',
    });
    expect(f.grantees).toEqual([
      { name: 'Marcus T. Bell', descriptor: 'buyer' },
      { name: 'Renee Bell', descriptor: '' },
    ]);
    expect(f.warrantyType).toBe('General Warranty');
    expect(f.considerationFigs).toBe('$450,000.00');
  });

  it('an empty proposal maps to no field updates', () => {
    expect(sellerProposalToFields({})).toEqual({});
  });

  it('SAFETY: only the three routine fields are ever produced — never a vesting recital or legal description', () => {
    // Even a proposal object carrying forbidden verbatim keys yields ONLY routine form fields; the mapper has
    // no path that reads or emits vestingRecital / legalDescription.
    const rogue = {
      grantees: [{ name: 'A. Buyer' }],
      warrantyType: 'General Warranty',
      consideration: '$1.00',
      vestingRecital: 'BEING the same property conveyed...',
      legalDescription: 'Lot 1, Block C...',
      tenancy: 'as tenants by the entirety',
    } as unknown as Parameters<typeof sellerProposalToFields>[0];
    const f = sellerProposalToFields(rogue);
    expect(Object.keys(f).sort()).toEqual(['considerationFigs', 'grantees', 'warrantyType']);
  });
});

describe('EXPRESS-FANOUT-1 intoLlcProposalToFields (client apply mapping)', () => {
  it('maps the LLC name, grantor(s), and price; marital status defaults to unmarried (attorney field)', () => {
    const f = intoLlcProposalToFields({
      granteeLlc: 'Ridgeline Holdings',
      grantors: [{ name: 'Dana Ortiz' }],
      consideration: '$10.00',
    });
    expect(f.granteeLlc).toBe('Ridgeline Holdings');
    expect(f.grantors).toEqual([{ name: 'Dana Ortiz', maritalStatus: 'unmarried' }]);
    expect(f.consideration).toBe('$10.00');
  });

  it('an empty proposal maps to no field updates', () => {
    expect(intoLlcProposalToFields({})).toEqual({});
  });

  it('SAFETY: only the routine fields are produced — never the derivation, subject-to, notary, or legal', () => {
    const rogue = {
      granteeLlc: 'Acme',
      grantors: [{ name: 'A' }],
      consideration: '$1.00',
      derivationOfTitle: 'For derivation see Deed Book...',
      subjectTo: 'subject to covenants...',
      notaryLocality: 'CITY OF ALEXANDRIA',
      legalDescription: 'Lot 1, Block C...',
    } as unknown as Parameters<typeof intoLlcProposalToFields>[0];
    const f = intoLlcProposalToFields(rogue);
    expect(Object.keys(f).sort()).toEqual(['consideration', 'granteeLlc', 'grantors']);
  });
});

describe('EXPRESS-FANOUT-1 outOfLlcProposalToFields', () => {
  it('maps members (signature title blank), price, file no., execution date', () => {
    const f = outOfLlcProposalToFields({ members: [{ name: 'Dana Ortiz' }], consideration: '$10.00', fileNumber: '41-2026-1', executionMonth: 'July', executionYear: '2026' });
    expect(f.members).toEqual([{ name: 'Dana Ortiz', signatureTitle: '' }]);
    expect(f.consideration).toBe('$10.00');
    expect(f.executionYear).toBe('2026');
  });
  it('SAFETY: never the return-to, notary, derivation-instrument number, or legal', () => {
    const rogue = { members: [{ name: 'A' }], returnTo: { company: 'X' }, notaryLocality: 'Y', derivationInstrumentNumber: '1', legalDescription: 'Lot 1' } as unknown as Parameters<typeof outOfLlcProposalToFields>[0];
    expect(Object.keys(outOfLlcProposalToFields(rogue))).toEqual(['members']);
  });
});

describe('EXPRESS-FANOUT-1 todProposalToFields', () => {
  it('maps beneficiaries → persons + vesting', () => {
    const f = todProposalToFields({ beneficiaries: [{ name: 'Ivy Chen' }, { name: 'Noah Chen' }], vesting: 'joint tenants with survivorship' });
    expect(f.persons).toEqual(['Ivy Chen', 'Noah Chen']);
    expect(f.beneficiaryVesting).toMatch(/survivorship/);
  });
  it('SAFETY: never the revocation block, the transferor capacity, the being recital, or legal', () => {
    const rogue = { beneficiaries: [{ name: 'A' }], revocationBlock: '...', transferor: { capacity: 'x' }, beingRecital: 'BEING...', legalDescription: 'Lot 1' } as unknown as Parameters<typeof todProposalToFields>[0];
    expect(Object.keys(todProposalToFields(rogue))).toEqual(['persons']);
  });
});

describe('EXPRESS-FANOUT-1 confirmationProposalToFields (archetype only)', () => {
  it('maps a valid archetype only', () => {
    expect(confirmationProposalToFields({ archetype: 'C1-a-survivorship' })).toEqual({ archetype: 'C1-a-survivorship' });
    expect(confirmationProposalToFields({ archetype: 'C1-b-testate-devise' })).toEqual({ archetype: 'C1-b-testate-devise' });
  });
  it('an invalid/absent archetype maps to nothing', () => {
    expect(confirmationProposalToFields({ archetype: 'C9-nope' })).toEqual({});
    expect(confirmationProposalToFields({})).toEqual({});
  });
  it('SAFETY: never any chain-of-title fact — only the archetype', () => {
    const rogue = { archetype: 'C1-a-survivorship', decedent: 'Jane', originalGrantors: ['X'], vestingDeedDate: '2001', legalDescription: 'Lot 1' } as unknown as Parameters<typeof confirmationProposalToFields>[0];
    expect(Object.keys(confirmationProposalToFields(rogue))).toEqual(['archetype']);
  });
});

describe('EXPRESS-FANOUT-1 intoTrustProposalToFields (trusteesRecital never carried)', () => {
  it('maps exemplar (normalized), grantor names, marital status, held-as, structure', () => {
    const f = intoTrustProposalToFields({
      exemplar: 'a',
      grantors: [{ name: 'Harold Whitmore' }, { name: 'Nadia Whitmore' }],
      grantorMaritalStatus: 'a married couple',
      heldAs: 'tenants_by_entirety',
      trustStructure: 'single_joint_trust',
    });
    expect(f.exemplar).toBe('A');
    expect(f.grantors).toEqual(['Harold Whitmore', 'Nadia Whitmore']);
    expect(f.trustStructure).toBe('single_joint_trust');
  });
  it('an invalid exemplar is dropped (never guessed)', () => {
    expect(intoTrustProposalToFields({ exemplar: 'Z', grantors: [{ name: 'A' }] })).toEqual({ grantors: ['A'] });
  });
  it('SAFETY (CRITICAL): never the trusteesRecital, being recital, derivation, or legal', () => {
    const rogue = {
      exemplar: 'A',
      grantors: [{ name: 'A' }],
      trusteesRecital: 'X and Y, Trustees of THE ... TRUST',
      beingRecital: 'BEING...',
      derivation: 'For derivation...',
      legalDescription: 'Lot 1, Block C...',
    } as unknown as Parameters<typeof intoTrustProposalToFields>[0];
    expect(Object.keys(intoTrustProposalToFields(rogue)).sort()).toEqual(['exemplar', 'grantors']);
  });
});
