/**
 * DEED-MANUAL-LEGAL-GIFT-1 — tRPC-input WIRING test. Verifies the attorney-entered legal + G3 affirmation thread
 * from the validated gift input shape (toGiftDeedInput) through buildGiftDraft to the assembler gate end-to-end.
 */
import { describe, it, expect } from 'vitest';
import { toGiftDeedInput, buildGiftDraft } from '../procedures/deedDraftAgent.js';

// A tax-only packet → the extracted legal is absent, so the paste path is exercised.
const TAX_ONLY = [{ id: 'mat-tax', textContent: 'REAL ESTATE ASSESSMENT\nParcel No: 7298-44-1201\nTotal Assessed Value: $588,400.00' }];
const PASTED = 'Lot 9, Block A, WILLOW GLEN, as recorded in Deed Book 4412 at Page 118, among the Land Records of Prince William County, Virginia.';
const base = {
  grantors: [{ name: 'Marcus T. Ellison' }],
  grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantor's daughter" }],
  fileNumber: '36-2026-7777',
  granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
  locality: 'Prince William County',
  derivationReference: 'in Deed Book 5500 at Page 12',
};

describe('DEED-MANUAL-LEGAL-GIFT-1 — input wiring end-to-end', () => {
  it('an AFFIRMED paste threads through to an attorney_entered draft', () => {
    const gift = toGiftDeedInput({
      ...base,
      legalDescription: PASTED,
      legalDescriptionSource: 'DB 4412 PG 118',
      legalDescriptionAffirmation: { verbatimFromSource: true, responsibleForAccuracy: true, describesSubjectProperty: true, affirmedAt: '2026-07-07T00:00:00Z' },
    });
    expect(gift.legalDescription).toBe(PASTED);
    expect(gift.legalDescriptionAffirmation?.describesSubjectProperty).toBe(true);
    const { draft } = buildGiftDraft(TAX_ONLY, gift);
    expect(draft.legalDescriptionProvenance).toBe('attorney_entered');
    expect(draft.verbatimLegalUsed).toBe(PASTED);
    expect(draft.attorneyEnteredLegalPendingVerification).toBe(true);
    expect(draft.legalDescriptionSource).toBe('DB 4412 PG 118');
  });

  it('a paste WITHOUT the affirmation is not used (placeholder stays)', () => {
    const gift = toGiftDeedInput({ ...base, legalDescription: PASTED });
    const { draft } = buildGiftDraft(TAX_ONLY, gift);
    expect(draft.legalDescriptionProvenance).toBeNull();
    expect(draft.verbatimLegalUsed).toBeNull();
    expect(draft.warnings).toContain('legal_paste_unaffirmed');
  });

  it('no paste → byte-for-byte the prior behavior (placeholder, no provenance)', () => {
    const gift = toGiftDeedInput({ ...base });
    const { draft } = buildGiftDraft(TAX_ONLY, gift);
    expect(draft.legalDescriptionProvenance).toBeNull();
    expect(draft.attorneyEnteredLegalPendingVerification).toBe(false);
  });
});
