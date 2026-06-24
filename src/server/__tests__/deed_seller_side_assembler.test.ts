/**
 * deed_seller_side_assembler.test.ts — DEED-DRAFT-AGENT-1 seller-side assembler acceptance bar.
 *
 * The grounded fixture pack (synthetic data, REAL Mason structure). Methodology mandate (the OCR-B1 lesson):
 *  - EXACT-string equality only — no substring `.test()`/`includes()` on rendered values.
 *  - Full body asserted by exact equality under NORMALIZED whitespace; every party/granting/tenancy/legal/
 *    vesting/signature/venue component asserted by EXACT equality on the rendered part.
 *  - NEG-1..6 must FAIL the deterministic lint / fail closed. Estate branch renders only the grounded path.
 */

import { describe, it, expect } from 'vitest';
import {
  assembleSellerSideDeed,
  NAME_BLEED_RE,
  type SellerSideDeedInput,
} from '../deed/deedSellerSideAssembler.js';
import {
  checkAnnotationLeak,
  checkFormatLints,
  checkRequiredParties,
  checkLegalDescription,
} from '../deed/deedDraftGates.js';

/** Mirror the gate's whitespace normalization for the full-body exact match. */
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Build the expected full body from GROUND-TRUTH pieces (hand-derived literals + verbatim legal/vesting),
 *  independent of the assembler's rendering functions. */
function expectedBody(o: {
  fileNumber: string; granteeAddress: string; titleInsurer: string; taxId: string;
  considerationFigs: string; assessedValue: string;
  parties: string; granting: string; legal: string; vesting: string;
  signature: string; venue: string; signers: string; returnTo: string;
}): string {
  return [
    `Prepared by: Kelly Satterwhite, Esq. VSB# 91049\nThe Mason Law Firm, PLC\nFile Number: ${o.fileNumber}\nGrantee's Address: ${o.granteeAddress}\nTitle Insurer: ${o.titleInsurer}\nTax I.D. Number: ${o.taxId}\nConsideration: ${o.considerationFigs}\nAssessed Value: ${o.assessedValue}`,
    `THIS DEED, made this _____ day of ____________, 20___, ${o.parties}`,
    'Witnesseth, that:',
    o.granting,
    o.legal,
    o.vesting,
    'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
    'WITNESS the following signatures and seals:',
    o.signature,
    `COMMONWEALTH OF VIRGINIA\n${o.venue}`,
    `The foregoing instrument was subscribed and sworn before me this _____ day of ____________, 20___, by ${o.signers}.`,
    `______________________________\nNotary Public's signature\nNotary registration number: ______________\nMy commission expires:\nAfter recording return to:\n${o.returnTo}`,
  ].join('\n\n');
}

// ── GOLD-A — single unmarried -> single unmarried, condo (DB/PG style) ─────────
const GOLD_A_LEGAL =
  'Condominium Unit 4120-C Brighton House Square, Brighton House Condominium, and the limited common elements appurtenant thereto, established by condominium instruments recorded March 5, 1986, in Deed Book 6100 at Page 0455, and any and all subsequent amendments recorded thereto among the land records of Fairfax County, Virginia.';
const GOLD_A_VESTING =
  'Being the same property conveyed to Helena Voss, sole owner, fee simple, as per deed dated 04/12/2015 and recorded 04/20/2015 in Deed Book 24010 at Page 0712, among the land records of Fairfax County, Virginia.';
const GOLD_A: SellerSideDeedInput = {
  warrantyType: 'General Warranty',
  fileNumber: '26-00091-K / 36-2026-5301',
  granteeAddress: '4120-C Brighton House Square\nAlexandria, VA 22310',
  titleInsurer: 'Chicago Title Insurance Company',
  taxId: '0911-09204120C',
  considerationFigs: '$438,000.00',
  amountWords: 'FOUR HUNDRED THIRTY EIGHT THOUSAND AND 00/100',
  assessedValue: '$421,300.00',
  grantors: [{ name: 'Helena VOSS', descriptor: 'unmarried' }],
  grantees: [{ name: 'Tomas REYES', descriptor: 'unmarried' }],
  tenancy: 'as sole owner',
  county: 'Fairfax',
  legalDescription: GOLD_A_LEGAL,
  vestingRecital: GOLD_A_VESTING,
  venue: 'CITY OF ALEXANDRIA',
  returnTo: 'Old Dominion Settlements\n7010 Little River Turnpike\nSuite 220\nAnnandale, VA 22003',
};

// ── GOLD-B — married couple -> sole owner, SFH ─────────────────────────────────
const GOLD_B_LEGAL =
  'Lot 412, Section 9, CEDAR RUN ESTATES, as the same appears duly dedicated, platted and recorded in Deed Book 5990 at Page 0204, among the Land Records of Fairfax County, Virginia.';
const GOLD_B_VESTING =
  'Being the same property conveyed to Marcus T. Ellison and Priya Ellison, husband and wife, by virtue of a Deed from Gregory Hale, married, dated June 3, 2020 and recorded June 8, 2020, among the Land Records of Fairfax County, Virginia, in Deed Book 25800 at Page 0631.';
const GOLD_B: SellerSideDeedInput = {
  warrantyType: 'General Warranty',
  fileNumber: 'CTN-MC-130044 / 36-2026-6312',
  granteeAddress: '8254 Burning Forest Court\nSpringfield, VA 22153',
  titleInsurer: 'FIRST AMERICAN TITLE INSURANCE COMPANY',
  taxId: '0983-04-0412',
  considerationFigs: '$548,000.00',
  amountWords: 'FIVE HUNDRED FORTY EIGHT THOUSAND AND 00/100',
  assessedValue: '$531,400.00',
  grantors: [{ name: 'Marcus T. ELLISON' }, { name: 'Priya ELLISON' }],
  grantorDescriptor: 'a married couple',
  grantees: [{ name: 'Daniel WONG' }],
  tenancy: 'as sole owner',
  county: 'Fairfax',
  legalDescription: GOLD_B_LEGAL,
  vestingRecital: GOLD_B_VESTING,
  venue: 'COUNTY OF FAIRFAX',
  returnTo: 'Community Title Network, LLC\n6257-A Old Dominion Drive\nMc Lean, VA 22101',
};

// ── GOLD-C — testate estate executor (a/k/a) -> TBE married couple, SFH ─────────
const GOLD_C_LEGAL =
  'Lot 88, Section 2, OAKTON GLEN, as the same duly dedicated, platted and recorded in Deed Book 2410, at Page 0099, among the land records of Fairfax County, Virginia.';
const GOLD_C_VESTING =
  'BEING the same property conveyed unto Raymond Earl Whitfield by Deed dated March 3, 2004, and recorded on March 9, 2004 in Deed Book 16002, at page 0310, among the aforesaid land records.  Raymond Earl Whitfield departed this life testate on or about January 8, 2026, and his Last Will and Testament was duly admitted to probate, see FI-2026-0000412. Dana Rae Whitfield a/k/a Dana R. Whitfield duly qualified as Executor for the Estate of Raymond Earl Whitfield with full powers to sell and convey the subject real property on behalf of the Estate.';
const GOLD_C: SellerSideDeedInput = {
  warrantyType: 'General Warranty',
  fileNumber: '2026-512-SR VA / 36-2026-6701',
  granteeAddress: '8801 Oakton Glen Drive\nVienna, VA 22182',
  titleInsurer: 'STEWART TITLE GUARANTY COMPANY',
  taxId: '0471-02-0088',
  considerationFigs: '$815,000.00',
  amountWords: 'EIGHT HUNDRED FIFTEEN THOUSAND AND 00/100',
  assessedValue: '$690,200.00',
  grantors: [{ name: 'Dana Rae WHITFIELD', variants: ['Dana Rae Whitfield', 'Dana R. Whitfield'], capacity: 'Executor of Estate of Raymond Earl Whitfield' }],
  grantees: [{ name: 'Carla MENDEZ' }, { name: 'Luis MENDEZ' }],
  granteeDescriptor: 'a married couple',
  tenancy: 'as tenants by the entirety with the full common law right of survivorship',
  county: 'Fairfax',
  powerOfSale: true,
  legalDescription: GOLD_C_LEGAL,
  vestingRecital: GOLD_C_VESTING,
  venue: 'CITY OF ALEXANDRIA',
  returnTo: 'SR Title LLC\n12505 Park Potomac Avenue, 5th Floor\nPotomac, MD 20854',
};

// ── GOLD-D — married couple w/ name-change -> unmarried, condo (instrument-# style) ──
const GOLD_D_LEGAL =
  'Condominium Unit 14, Phase 2, RIVERMONT COMMONS CONDOMINIUM, as established under and subject to the Declaration (including the Bylaws attached thereto) recorded as Instrument No. 201906120044100 and Plat at Instrument No. 201906120044101, and any and all amendments thereto, among the Land Records of Prince William County, Virginia, and any and all subsequent amendments thereto.\nTOGETHER WITH an undivided interest in the common elements appurtenant to the unit as contained and/or described in the aforesaid Declaration and/or amendments.';
const GOLD_D_VESTING =
  'AND BEING the same property conveyed unto Owen Park and Jenna Park by virtue of a General Warranty Deed granted by Courtney Vance dated April 15, 2021 and recorded on April 15, 2021 as Instrument No. 202104150051220 among the Land Records of Prince William County, Virginia.';
const GOLD_D: SellerSideDeedInput = {
  warrantyType: 'General Warranty',
  fileNumber: 'C26-08-21RVT / 36-2026-6790',
  granteeAddress: '13990 Rivermont Commons Way\nGainesville, VA 20155',
  titleInsurer: 'Commonwealth Land Title Insurance Company',
  taxId: '7397-55-4410.02',
  considerationFigs: '$529,000.00',
  amountWords: 'FIVE HUNDRED TWENTY NINE THOUSAND AND 00/100',
  assessedValue: '$488,900.00',
  grantors: [{ name: 'Owen PARK' }, { name: 'Jenna PARK', formerlyOfRecord: 'Jenna LIANG' }],
  grantorDescriptor: 'a married couple',
  grantees: [{ name: 'Sofia OKAFOR', descriptor: 'unmarried' }],
  tenancy: 'as sole owner',
  county: 'Prince William',
  legalDescription: GOLD_D_LEGAL,
  vestingRecital: GOLD_D_VESTING,
  venue: 'CITY OF ALEXANDRIA',
  returnTo: 'Ekko Title\n14245K Centreville Square\nCentreville, VA 20121',
};

describe('seller-side assembler — GOLDEN fixtures (exact)', () => {
  it('GOLD-A: single unmarried -> single unmarried, condo (DB/PG)', () => {
    const d = assembleSellerSideDeed(GOLD_A);
    expect(d.failedClosed).toBe(false);
    const parts = d.parts!;
    const parties = 'by and between Helena VOSS, unmarried, (the "Grantor"), and Tomas REYES, unmarried, (the "Grantee"),';
    const granting =
      'For and in consideration of the sum of FOUR HUNDRED THIRTY EIGHT THOUSAND AND 00/100 DOLLARS ($438,000.00), and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantor does hereby grant, bargain, sell and convey, with General Warranty and English Covenants of title, unto the said Grantee, in fee simple, as sole owner, all of the following parcel of real property, with improvements thereon, located in Fairfax County, Commonwealth of Virginia, to wit:';
    const signature = '______________________________\nHelena VOSS';
    expect(parts.partiesClause).toBe(parties);
    expect(parts.grantingClause).toBe(granting);
    expect(parts.grantorLabel).toBe('Grantor');
    expect(parts.granteeLabel).toBe('Grantee');
    expect(parts.tenancy).toBe('as sole owner');
    expect(parts.legalBlock).toBe(GOLD_A_LEGAL); // verbatim, untruncated
    expect(parts.vestingRecital).toBe(GOLD_A_VESTING);
    expect(parts.signatureBlock).toBe(signature);
    expect(parts.venue).toBe('CITY OF ALEXANDRIA');
    expect(parts.signers).toBe('Helena VOSS');
    // header newline structure asserted EXACTLY (the whitespace-collapsing full-body norm() would not catch it)
    expect(parts.headerBlock).toBe(
      'Prepared by: Kelly Satterwhite, Esq. VSB# 91049\nThe Mason Law Firm, PLC\nFile Number: 26-00091-K / 36-2026-5301\nGrantee\'s Address: 4120-C Brighton House Square\nAlexandria, VA 22310\nTitle Insurer: Chicago Title Insurance Company\nTax I.D. Number: 0911-09204120C\nConsideration: $438,000.00\nAssessed Value: $421,300.00',
    );
    expect(d.recordableFloorOk).toBe(true);
    expect(norm(d.text)).toBe(
      norm(expectedBody({
        fileNumber: GOLD_A.fileNumber, granteeAddress: GOLD_A.granteeAddress, titleInsurer: GOLD_A.titleInsurer,
        taxId: GOLD_A.taxId, considerationFigs: GOLD_A.considerationFigs, assessedValue: GOLD_A.assessedValue,
        parties, granting, legal: GOLD_A_LEGAL, vesting: GOLD_A_VESTING, signature, venue: 'CITY OF ALEXANDRIA',
        signers: 'Helena VOSS', returnTo: GOLD_A.returnTo,
      })),
    );
  });

  it('GOLD-B: married couple -> sole owner, SFH (count agreement Grantors do / Grantee)', () => {
    const d = assembleSellerSideDeed(GOLD_B);
    expect(d.failedClosed).toBe(false);
    const parts = d.parts!;
    const parties = 'by and between Marcus T. ELLISON and Priya ELLISON, a married couple, (the "Grantors"), and Daniel WONG, (the "Grantee"),';
    const granting =
      'For and in consideration of the sum of FIVE HUNDRED FORTY EIGHT THOUSAND AND 00/100 DOLLARS ($548,000.00), and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantors do hereby grant, bargain, sell and convey, with General Warranty and English Covenants of title, unto the said Grantee, in fee simple, as sole owner, all of the following parcel of real property, with improvements thereon, located in Fairfax County, Commonwealth of Virginia, to wit:';
    const signature = '______________________________\nMarcus T. ELLISON\n\n______________________________\nPriya ELLISON';
    expect(parts.partiesClause).toBe(parties);
    expect(parts.grantingClause).toBe(granting);
    expect(parts.grantorLabel).toBe('Grantors');
    expect(parts.granteeLabel).toBe('Grantee');
    expect(parts.signatureBlock).toBe(signature);
    expect(parts.signers).toBe('Marcus T. ELLISON and Priya ELLISON');
    expect(parts.venue).toBe('COUNTY OF FAIRFAX');
    expect(parts.legalBlock).toBe(GOLD_B_LEGAL);
    expect(parts.vestingRecital).toBe(GOLD_B_VESTING); // "Deed from" (NOT "form") — NEG-3 correct form
    expect(d.recordableFloorOk).toBe(true);
    expect(norm(d.text)).toBe(
      norm(expectedBody({
        fileNumber: GOLD_B.fileNumber, granteeAddress: GOLD_B.granteeAddress, titleInsurer: GOLD_B.titleInsurer,
        taxId: GOLD_B.taxId, considerationFigs: GOLD_B.considerationFigs, assessedValue: GOLD_B.assessedValue,
        parties, granting, legal: GOLD_B_LEGAL, vesting: GOLD_B_VESTING, signature, venue: 'COUNTY OF FAIRFAX',
        signers: 'Marcus T. ELLISON and Priya ELLISON', returnTo: GOLD_B.returnTo,
      })),
    );
  });

  it('GOLD-C: testate executor (a/k/a) -> TBE couple (estate signature block + full powers)', () => {
    const d = assembleSellerSideDeed(GOLD_C);
    expect(d.failedClosed).toBe(false);
    expect(d.sellerType).toBe('estate');
    const parts = d.parts!;
    const parties = 'by and between Dana Rae WHITFIELD, a/k/a Dana R. Whitfield, Executor of Estate of Raymond Earl Whitfield, (the "Grantor"), and Carla MENDEZ and Luis MENDEZ, a married couple, (the "Grantees"),';
    const granting =
      'For and in consideration of the sum of EIGHT HUNDRED FIFTEEN THOUSAND AND 00/100 DOLLARS ($815,000.00), and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantor does hereby grant, bargain, sell and convey, with General Warranty and English Covenants of title, unto the said Grantees, in fee simple, as tenants by the entirety with the full common law right of survivorship, all of the following parcel of real property, with improvements thereon, located in Fairfax County, Commonwealth of Virginia, to wit:';
    const signature = 'The Estate of Raymond Earl Whitfield\n\nBy:______________________________\n     Dana Rae WHITFIELD, a/k/a Dana R. Whitfield, Executor';
    expect(parts.partiesClause).toBe(parties);
    expect(parts.grantingClause).toBe(granting);
    expect(parts.grantorLabel).toBe('Grantor');
    expect(parts.granteeLabel).toBe('Grantees');
    expect(parts.tenancy).toBe('as tenants by the entirety with the full common law right of survivorship');
    expect(parts.signatureBlock).toBe(signature);
    expect(parts.signers).toBe('Dana Rae WHITFIELD, a/k/a Dana R. Whitfield, Executor of Estate of Raymond Earl Whitfield');
    expect(parts.venue).toBe('CITY OF ALEXANDRIA');
    expect(parts.legalBlock).toBe(GOLD_C_LEGAL);
    expect(parts.vestingRecital).toBe(GOLD_C_VESTING); // "with full powers" (NOT "will") — NEG-2 correct form
    expect(d.recordableFloorOk).toBe(true);
    expect(norm(d.text)).toBe(
      norm(expectedBody({
        fileNumber: GOLD_C.fileNumber, granteeAddress: GOLD_C.granteeAddress, titleInsurer: GOLD_C.titleInsurer,
        taxId: GOLD_C.taxId, considerationFigs: GOLD_C.considerationFigs, assessedValue: GOLD_C.assessedValue,
        parties, granting, legal: GOLD_C_LEGAL, vesting: GOLD_C_VESTING, signature, venue: 'CITY OF ALEXANDRIA',
        signers: 'Dana Rae WHITFIELD, a/k/a Dana R. Whitfield, Executor of Estate of Raymond Earl Whitfield', returnTo: GOLD_C.returnTo,
      })),
    );
  });

  it('GOLD-D: name-change (formerly of record) -> unmarried, condo (instrument-#)', () => {
    const d = assembleSellerSideDeed(GOLD_D);
    expect(d.failedClosed).toBe(false);
    const parts = d.parts!;
    const parties = 'by and between Owen PARK and Jenna PARK, formerly of record as Jenna LIANG, a married couple, (the "Grantors"), and Sofia OKAFOR, unmarried, (the "Grantee"),';
    const granting =
      'For and in consideration of the sum of FIVE HUNDRED TWENTY NINE THOUSAND AND 00/100 DOLLARS ($529,000.00), and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantors do hereby grant, bargain, sell and convey, with General Warranty and English Covenants of title, unto the said Grantee, in fee simple, as sole owner, all of the following parcel of real property, with improvements thereon, located in Prince William County, Commonwealth of Virginia, to wit:';
    const signature = '______________________________\nOwen PARK\n\n______________________________\nJenna PARK';
    expect(parts.partiesClause).toBe(parties); // "formerly of record as Jenna LIANG" in the clause, NOT a name field
    expect(parts.grantingClause).toBe(granting);
    expect(parts.signatureBlock).toBe(signature); // signature uses bare names, no "formerly"
    expect(parts.signers).toBe('Owen PARK and Jenna PARK');
    expect(parts.legalBlock).toBe(GOLD_D_LEGAL); // both condo instrument numbers + TOGETHER WITH block, whole
    expect(d.recordableFloorOk).toBe(true);
    expect(norm(d.text)).toBe(
      norm(expectedBody({
        fileNumber: GOLD_D.fileNumber, granteeAddress: GOLD_D.granteeAddress, titleInsurer: GOLD_D.titleInsurer,
        taxId: GOLD_D.taxId, considerationFigs: GOLD_D.considerationFigs, assessedValue: GOLD_D.assessedValue,
        parties, granting, legal: GOLD_D_LEGAL, vesting: GOLD_D_VESTING, signature, venue: 'CITY OF ALEXANDRIA',
        signers: 'Owen PARK and Jenna PARK', returnTo: GOLD_D.returnTo,
      })),
    );
  });

  it('every GOLDEN input name field is bare (no label/capacity/variant/newline bleed)', () => {
    for (const fx of [GOLD_A, GOLD_B, GOLD_C, GOLD_D]) {
      for (const p of [...fx.grantors, ...fx.grantees]) {
        expect(NAME_BLEED_RE.test(p.name)).toBe(false);
      }
    }
  });
});

describe('seller-side assembler — NEG lint cases (must fail closed / fail the lint)', () => {
  it('NEG-1: county-join "FairfaxCounty" fails the format lint', () => {
    const body = 'all of the following parcel of real property, located in FairfaxCounty, Commonwealth of Virginia, to wit:';
    expect(checkFormatLints(body).ok).toBe(false);
  });

  it('NEG-2: authority verb "will full powers" fails the format lint', () => {
    const body = 'duly qualified as Executor for the Estate with will full powers to sell and convey the subject real property.';
    expect(checkFormatLints(body).ok).toBe(false);
  });

  it('NEG-3: vesting verb "Deed form" fails the format lint', () => {
    const body = 'Being the same property conveyed by virtue of a Deed form Gregory Hale, dated June 3, 2020.';
    expect(checkFormatLints(body).ok).toBe(false);
  });

  it('NEG-4: label/capacity/alias/multi-party name-bleed into a name field fails closed', () => {
    const bleeds = [
      'Dana Rae WHITFIELD, Executor of Estate of Raymond Earl Whitfield',
      'Dana Rae WHITFIELD a/k/a Dana R. Whitfield',
      'The Estate of Raymond Earl Whitfield',
      'Owen PARK\nJenna PARK',
      'Helena VOSS, (the "Grantor")',
      'John Doe and Jane Doe', // bare " and " co-party run (no comma)
      'Jane Doe, Trustee', // fiduciary role beyond Executor/Administrator
      'Margaret Vance Executrix', // Latin-feminine form (not a substring of "Executor")
      'Pat Reed, Personal Representative',
      'John Smith f/k/a John Smyth', // f/k/a alias
      'jane doe administrator of estate of x', // lowercase capacity (case-insensitive)
      'Jane Doe (Grantor)', // parenthesized label without the quote
    ];
    for (const badName of bleeds) {
      const d = assembleSellerSideDeed({ ...GOLD_A, grantors: [{ name: badName }], sellerType: 'individual' });
      expect(d.failedClosed).toBe(true);
      expect(d.text).toBe('');
      expect(NAME_BLEED_RE.test(badName)).toBe(true);
    }
  });

  it('NEG-4b: a legitimate bare name (apostrophe/hyphen/suffix) is NOT falsely rejected', () => {
    for (const okName of ["Mary O'Brien", 'Anne-Marie Sandoval', 'Robert Anderson Jr.', 'Chandra Brand']) {
      expect(NAME_BLEED_RE.test(okName)).toBe(false);
    }
  });

  it('NEG-5: annotation/placeholder leak fails the B6 floor', () => {
    for (const body of [
      'the Grantor does hereby grant NOTE: confirm warranty before recording.',
      'located in [County], Commonwealth of Virginia.',
      'unto the said {{grantee}}, in fee simple.',
      'in fee simple, <TENANCY>, all of the following parcel.',
      'the receipt and sufficiency **of which** are hereby acknowledged.',
      'TODO reconcile the legal description.',
    ]) {
      expect(checkAnnotationLeak(body).ok).toBe(false);
    }
  });

  it('NEG-6: truncated legal (no closing boundary) is withheld + fails closed', () => {
    const d = assembleSellerSideDeed({
      ...GOLD_A,
      legalDescription: 'Condominium Unit 4120-C Brighton House Square, Brighton House Condominium, and any and all subsequent amendments recorded thereto among the',
    });
    expect(d.failedClosed).toBe(true);
    expect(d.text).toBe('');
    expect(d.failures.some((f) => /truncat/i.test(f))).toBe(true);
  });
});

describe('seller-side assembler — estate B2 fail-closed scope', () => {
  it('estate without power_of_sale fails closed (B2)', () => {
    const { powerOfSale: _omit, ...noPower } = GOLD_C;
    const d = assembleSellerSideDeed(noPower as SellerSideDeedInput);
    expect(d.failedClosed).toBe(true);
    expect(d.text).toBe('');
    expect(d.failures.some((f) => /power of sale/i.test(f))).toBe(true);
  });

  it('estate with power_of_sale=false fails closed (B2)', () => {
    const d = assembleSellerSideDeed({ ...GOLD_C, powerOfSale: false });
    expect(d.failedClosed).toBe(true);
  });

  it('non-executor fiduciary (Administrator — intestate signal) fails closed', () => {
    const d = assembleSellerSideDeed({
      ...GOLD_C,
      powerOfSale: true,
      grantors: [{ name: 'Dana Rae WHITFIELD', capacity: 'Administrator of Estate of Raymond Earl Whitfield' }],
    });
    expect(d.failedClosed).toBe(true);
    expect(d.failures.some((f) => /non-executor|intestate/i.test(f))).toBe(true);
  });

  it('co-executor (co-fiduciary requiring joinder) fails closed — F1', () => {
    const d = assembleSellerSideDeed({
      ...GOLD_C,
      powerOfSale: true,
      grantors: [{ name: 'Dana Rae WHITFIELD', capacity: 'Co-Executor of Estate of Raymond Earl Whitfield' }],
    });
    expect(d.failedClosed).toBe(true);
    expect(d.text).toBe('');
    expect(d.failures.some((f) => /co-fiduciary|co-executor|single-qualified-Executor/i.test(f))).toBe(true);
  });

  it('sellerType:"individual" can NOT suppress B2 when a grantor carries a fiduciary capacity (no over-render)', () => {
    const d = assembleSellerSideDeed({
      ...GOLD_C,
      sellerType: 'individual', // attempt to bypass the estate gate
      powerOfSale: false,
      grantors: [{ name: 'Dana WHITFIELD', capacity: 'Administrator of Estate of Raymond Whitfield' }],
    });
    expect(d.failedClosed).toBe(true); // capacity forces the B2 path; powerOfSale:false + Administrator fail closed
    expect(d.text).toBe('');
  });

  it('malformed capacity ("Estate of …, and Co") fails closed (decedent-name bleed guard)', () => {
    const d = assembleSellerSideDeed({
      ...GOLD_C,
      powerOfSale: true,
      grantors: [{ name: 'Dana Rae WHITFIELD', capacity: 'Executor of Estate of Raymond, and Company Holdings' }],
    });
    expect(d.failedClosed).toBe(true);
  });
});

describe('seller-side assembler — agreement cross-product (synthetic coverage; no PII)', () => {
  it('individual 2 grantors x 2 grantees (married couple) — Grantors do / Grantees / TBE on the individual path', () => {
    const d = assembleSellerSideDeed({
      ...GOLD_B,
      grantors: [{ name: 'Alex RIVER' }, { name: 'Blair RIVER' }],
      grantorDescriptor: 'a married couple',
      grantees: [{ name: 'Casey STONE' }, { name: 'Drew STONE' }],
      granteeDescriptor: 'a married couple',
      tenancy: 'as tenants by the entirety with the full common law right of survivorship',
    });
    expect(d.failedClosed).toBe(false);
    expect(d.sellerType).toBe('individual');
    expect(d.parts!.grantorLabel).toBe('Grantors');
    expect(d.parts!.granteeLabel).toBe('Grantees');
    expect(d.parts!.partiesClause).toBe(
      'by and between Alex RIVER and Blair RIVER, a married couple, (the "Grantors"), and Casey STONE and Drew STONE, a married couple, (the "Grantees"),',
    );
    expect(d.parts!.signatureBlock).toBe('______________________________\nAlex RIVER\n\n______________________________\nBlair RIVER');
    expect(d.parts!.signers).toBe('Alex RIVER and Blair RIVER');
    expect(d.recordableFloorOk).toBe(true);
  });
});

describe('seller-side assembler — warranty override (FIRE-B1) + count combos', () => {
  it('Special Warranty override conforms the granting clause', () => {
    const d = assembleSellerSideDeed({ ...GOLD_A, warrantyType: 'Special Warranty' });
    expect(d.failedClosed).toBe(false);
    expect(d.warranty).toBe('Special Warranty');
    expect(d.parts!.grantingClause).toBe(
      'For and in consideration of the sum of FOUR HUNDRED THIRTY EIGHT THOUSAND AND 00/100 DOLLARS ($438,000.00), and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantor does hereby grant, bargain, sell and convey, with Special Warranty and English Covenants of title, unto the said Grantee, in fee simple, as sole owner, all of the following parcel of real property, with improvements thereon, located in Fairfax County, Commonwealth of Virginia, to wit:',
    );
  });

  it('default warranty is General Warranty when omitted', () => {
    const { warrantyType: _omit, ...noWar } = GOLD_A;
    const d = assembleSellerSideDeed(noWar as SellerSideDeedInput);
    expect(d.warranty).toBe('General Warranty');
  });
});

describe('seller-side assembler — E0 behavior fixes (S1 independent city + F3 fiduciary-warranty note)', () => {
  it('S1/F2 — an independent-city deed renders "City of <X>" in the granting clause, never "<X> County"', () => {
    const d = assembleSellerSideDeed({ ...GOLD_A, localityType: 'city', localityName: 'Alexandria' });
    expect(d.failedClosed).toBe(false);
    expect(d.parts!.grantingClause).toContain('located in City of Alexandria, Commonwealth of Virginia, to wit:');
    expect(d.parts!.grantingClause).not.toMatch(/Alexandria County/);
  });

  it('S1 — the county path is unchanged (byte-identical): localityType omitted renders "<county> County"', () => {
    const d = assembleSellerSideDeed(GOLD_A); // county: 'Fairfax'
    expect(d.parts!.grantingClause).toContain('located in Fairfax County, Commonwealth of Virginia, to wit:');
  });

  it('F3 — an estate deed on DEFAULT General Warranty emits the standing fiduciary-warranty risk note', () => {
    const d = assembleSellerSideDeed(GOLD_C); // estate, default General Warranty, express power of sale
    expect(d.failedClosed).toBe(false);
    expect(d.warranty).toBe('General Warranty');
    expect(d.notes.some((n) => /Fiduciary-warranty risk/i.test(n))).toBe(true);
  });

  it('F3 — a non-estate (individual) deed does NOT emit the fiduciary-warranty note', () => {
    const d = assembleSellerSideDeed(GOLD_A);
    expect(d.notes.some((n) => /Fiduciary-warranty risk/i.test(n))).toBe(false);
  });
});

describe('seller-side assembler — recordability gates (no bypass; output flows through C1/C2/B6)', () => {
  it('a GOLDEN body passes B6 + format (the text-only recordability floor)', () => {
    for (const fx of [GOLD_A, GOLD_B, GOLD_C, GOLD_D]) {
      const d = assembleSellerSideDeed(fx);
      expect(checkAnnotationLeak(d.text).ok).toBe(true);
      expect(checkFormatLints(d.text).ok).toBe(true);
    }
  });

  it('GOLD-B output reconciles cleanly through C1 (legal) + C2 (parties) when given matching sources', () => {
    const d = assembleSellerSideDeed(GOLD_B);
    // C2: the grantor set on the draft == Sch. B-I Req. 4, each with a recorded authority basis.
    const c2 = checkRequiredParties({
      draftGrantors: ['Marcus T. ELLISON', 'Priya ELLISON'],
      requiredParties: ['Marcus T. ELLISON', 'Priya ELLISON'],
      authorityByGrantor: {
        'Marcus T. ELLISON': 'Deed Book 25800 at Page 0631',
        'Priya ELLISON': 'Deed Book 25800 at Page 0631',
      },
    });
    expect(c2.ok).toBe(true);
    // C1: the assembled legal verbatim from the commitment + reconciled to the prior deed (SFH, not condo).
    const c1 = checkLegalDescription({
      draftLegal: d.parts!.legalBlock,
      commitmentExhibitA: GOLD_B_LEGAL,
      priorDeedLegal: GOLD_B_LEGAL,
    });
    expect(c1.ok).toBe(true);
  });
});
