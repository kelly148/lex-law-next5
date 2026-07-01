import { describe, expect, it } from 'vitest';
import { sellerProposalToFields, intoLlcProposalToFields } from '../quickDeedProposalApply.js';

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
