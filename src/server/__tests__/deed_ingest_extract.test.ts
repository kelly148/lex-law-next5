/**
 * DEED-DRAFT-AGENT-1 ingest pre-stage (UAT-fix-list B1 / OCR) — deterministic field-extraction tests. REWORK.
 *
 * Fixtures are SYNTHETIC OCR'd-text — STRUCTURALLY FAITHFUL to the real Mason §2.1.1 skeleton (name BEFORE the
 * `(the "Grantor")` parenthetical label, multi-line legals, line breaks mid-name, co-fiduciaries, a/k/a
 * variants, formerly-of-record, condos) but with INVENTED names/numbers (the real corpus is confidential).
 *
 * TEST METHODOLOGY MANDATE (the rework's HOLD-level requirement): every captured field is asserted by
 * EXACT-STRING equality (toBe / toEqual), NEVER substring (.test()/.includes()) — substring matches are what
 * hid the corrupted captures (e.g. "Dana Rae Whitfield The") that passed CI in the rejected attempt. A
 * NEGATIVE-ASSERTION family additionally proves name fields do NOT contain a parenthetical label, the `), and`
 * bridge, a role word, an a/k/a connector, or a newline. POISON fixtures prove FAIL-CLOSED withholding.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyDeedDocType,
  extractDeedIngest,
  type DeedIngestField,
  type DeedIngestResult,
} from '../deed/deedIngestExtract.js';
import { checkLegalDescription, checkRequiredParties } from '../deed/deedDraftGates.js';
import { consolidateDeedSourceFacts } from '../deed/deedSourceFacts.js';
// NOTE: scanned-vs-text-native detection is the EXISTING pipeline's job (pdfExtract -> pdfNeedsOcr, covered by
// the existing intake tests). It is intentionally not re-imported here — pulling the heavy OCR chain into a
// pure-text unit test would add cost for no benefit. The extractor consumes already-extracted text.

/** Non-null field accessor: throws if the field is absent so a typo can't silently pass as "undefined". */
function fld(r: DeedIngestResult, key: string): DeedIngestField {
  const f = r.fields.find((x) => x.key === key);
  if (!f) throw new Error(`field "${key}" not present in extraction (keys: ${r.fields.map((x) => x.key).join(',')})`);
  return f;
}

/** The negative-assertion family: a captured party name must NOT contain any boundary-bleed signature. This
 *  is the CHECK SET that protects against regression — strengthened after the rework review to also catch the
 *  comma-glued-people, and/&-glued-people, determiner-lead-in, and descriptor-bleed classes the first guard
 *  missed (#10, #22, #38, #39). */
function expectNameClean(name: string): void {
  expect(name).not.toMatch(/\(the\s+["'“”]?\s*Grant/i); // parenthetical label bled in
  expect(name).not.toMatch(/\)\s*,\s*and\b/i); // `"), and` bridge bled in
  expect(name).not.toMatch(/\b(?:Executor|Executrix|Administrator|Personal\s+Representative|Trustee)\b/i); // role bled in
  expect(name).not.toMatch(/\ba\/k\/a\b|\baka\b/i); // alias connector bled in
  expect(name).not.toMatch(/\bEstate\s+of\b/i); // estate-caption bled in
  expect(name).not.toMatch(/[\n\r]/); // crossed a line boundary
  expect(name).not.toMatch(/\s+(?:and|&)\s+/i); // two distinct people glued by and/&
  expect(name).not.toMatch(/^(?:the|a|an|said|certain)\b/i); // determiner / prose lead-in
  expect(name).not.toMatch(/\b(?:husband\s+and\s+wife|married|unmarried|single\s+(?:man|woman))\b/i); // descriptor bled in
  // any internal comma must be a generational suffix ONLY (John Q. Public, Jr.) — never a second person.
  const comma = /,\s*(.+)$/.exec(name);
  if (comma) expect(comma[1]).toMatch(/^(?:Jr\.?|Sr\.?|I{1,3}|IV|V|Esq\.?)$/i);
}

// ── SYNTHETIC fixtures — structurally faithful to §2.1.1 ────────────────────────

// GOLDEN-1: living married couple, SFH. Note the LINE BREAK mid-grantor (Marcus … and \n Priya …).
const GOLDEN_1 = [
  'THIS DEED, made this ___ day of June, 2026, by and between Marcus T. ELLISON and',
  'Priya ELLISON, a married couple, (the "Grantors"), and Daniel WONG, (the "Grantee"),',
  'WITNESSETH that for and in consideration of the sum set forth below, the Grantors do hereby grant,',
  'bargain, sell and convey, with General Warranty and English Covenants of title, unto the said',
  'Grantee, in fee simple, as sole owner, all that certain parcel of real property located in',
  'Prince William County, Commonwealth of Virginia, to wit:',
  '   Lot 12, Section 3, CEDAR RUN ESTATES, as the same appears duly dedicated, platted and',
  '   recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
  '   BEING the same property conveyed to Marcus T. Ellison and Priya Ellison, husband and wife,',
  '   by Deed from Harold V. Greer, dated May 2, 2019 and recorded May 6, 2019, in Deed Book 25110 at Page 0455.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
  'Tax I.D. Number: 7298-44-1201   Consideration: $612,000.00   Assessed Value: $588,400.00',
].join('\n');

const GOLDEN_1_LEGAL =
  'Lot 12, Section 3, CEDAR RUN ESTATES, as the same appears duly dedicated, platted and recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.';

// GOLDEN-2: testate-estate executor, a/k/a + capacity, LINE BREAK inside the grantor span before the capacity.
const GOLDEN_2 = [
  'THIS DEED, made this ___ day of January, 2026, by and between Dana Rae Whitfield, a/k/a Dana R. Whitfield,',
  'Executor of Estate of Raymond Earl Whitfield, (the "Grantor"), and Carla MENDEZ and',
  'Luis MENDEZ, a married couple, (the "Grantees"),',
  'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty and English',
  'Covenants of title, unto the said Grantees, in fee simple, as tenants by the entirety with survivorship, all',
  'that parcel located in Fairfax County, Commonwealth of Virginia, to wit:',
  '   Lot 8, Block D, Section 1, WILLOW BEND, recorded in Deed Book 9001 at Page 12, Fairfax County, Virginia.',
  '   BEING the same property conveyed unto Raymond Earl Whitfield by Deed dated March 3, 2004, and',
  '   recorded in Deed Book 16002 at Page 0310, among the land records of Fairfax County, Virginia. The said',
  '   Raymond Earl Whitfield departed this life testate on or about January 8, 2026; his Last Will and Testament',
  '   was admitted to probate, see FI-2026-0000412, and the undersigned qualified as Executor with full power to',
  '   sell and convey on behalf of the Estate.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
  'The Estate of Raymond Earl Whitfield   By: ______ Dana Rae Whitfield, a/k/a Dana R. Whitfield, Executor',
].join('\n');

// GOLDEN-3: name-change couple + condo (Declaration + Plat instrument #s).
const GOLDEN_3 = [
  'THIS DEED, made this ___ day of June, 2026, by and between Owen PARK and Jenna PARK, formerly of record as',
  'Jenna LIANG, a married couple, (the "Grantors"), and Sofia OKAFOR, unmarried, (the "Grantee"),',
  'WITNESSETH that the Grantors do hereby grant, bargain, sell and convey, with General Warranty and English',
  'Covenants of title, unto the said Grantee, in fee simple, as sole owner, all that condominium unit located in',
  'Prince William County, Commonwealth of Virginia, to wit:',
  '   Condominium Unit 14, Phase 2, RIVERMONT COMMONS CONDOMINIUM, as established under and subject to the',
  '   Declaration (including the Bylaws attached thereto) recorded as Instrument No. 201906120044100 and Plat at',
  '   Instrument No. 201906120044101, TOGETHER WITH an undivided interest in the common elements appurtenant thereto.',
  '   BEING the same property conveyed unto Owen Park and Jenna Park by Deed recorded in Deed Book 7700 at Page 15.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
].join('\n');

const GOLDEN_3_LEGAL =
  'Condominium Unit 14, Phase 2, RIVERMONT COMMONS CONDOMINIUM, as established under and subject to the Declaration (including the Bylaws attached thereto) recorded as Instrument No. 201906120044100 and Plat at Instrument No. 201906120044101, TOGETHER WITH an undivided interest in the common elements appurtenant thereto.';

// GOLDEN-4: co-fiduciaries (split correctly despite the capacity clause containing "Estate of").
const GOLDEN_4 = [
  'THIS DEED, made this ___ day of February, 2026, by and between Grace HOLT and Samuel HOLT, Co-Executors of Estate of Eleanor Holt, (the "Grantors"), and Theodore VANCE, (the "Grantee"),',
  'WITNESSETH that the Grantors do hereby grant and convey, with Special Warranty, unto the said Grantee, in fee simple, as sole owner, all that parcel located in Loudoun County, Commonwealth of Virginia, to wit:',
  '   Lot 5, ASHBURN FARMS, recorded in Deed Book 3100 at Page 77, Loudoun County, Virginia.',
  '   BEING the same property conveyed unto Eleanor Holt by Deed dated June 1, 2000, recorded in Deed Book 8800 at Page 5.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
].join('\n');

// POISON-1: truncated legal — the legal block is cut with no section terminator (no BEING / Subject-to).
const POISON_1 = [
  'THIS DEED, made this ___ day of June, 2026, by and between Marcus T. ELLISON and Priya ELLISON, a married couple, (the "Grantors"), and Daniel WONG, (the "Grantee"),',
  'WITNESSETH that the Grantors do hereby grant, bargain, sell and convey, with General Warranty, unto the said Grantee, in fee simple, as sole owner, all that parcel located in Prince William County, Commonwealth of Virginia, to wit:',
  '   Lot 12, Section 3, CEDAR RUN ESTATES,',
].join('\n');

// POISON-2: label pollution — the grantor span cannot be cleanly isolated (no parenthetical label to anchor).
const POISON_2 = [
  'THIS DEED, made this ___ day of June, 2026, by and between the grantors more particularly described in the caption hereto and the grantees named therein, WITNESSETH that the Grantors do hereby grant, bargain, sell and convey, with General Warranty and English Covenants of title, unto the said Grantees, in fee simple, as sole owner, all that parcel located in Fairfax County, Commonwealth of Virginia, to wit:',
  '   Lot 1, Block A, SOMEWHERE SUBDIVISION, recorded in Deed Book 100 at Page 1, Fairfax County, Virginia.',
  '   BEING the same property conveyed unto the grantors by prior deed of record.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
].join('\n');

// POISON-3: parcel decoy — the Tax I.D. line carries the word "record", not a GPIN-shaped token.
const POISON_3 = [
  'THIS DEED, made this ___ day of June, 2026, by and between Marcus T. ELLISON and Priya ELLISON, a married couple, (the "Grantors"), and Daniel WONG, (the "Grantee"),',
  'WITNESSETH that the Grantors do hereby grant, bargain, sell and convey, with General Warranty, unto the said Grantee, in fee simple, as sole owner, all that parcel located in Prince William County, Commonwealth of Virginia, to wit:',
  '   Lot 12, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 244, Prince William County, Virginia.',
  '   BEING the same property conveyed to Marcus T. Ellison and Priya Ellison by Deed in Deed Book 25110 at Page 0455.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
  'Tax I.D. Number: record   Consideration: $612,000.00   Assessed Value: $588,400.00',
].join('\n');

const TITLE_COMMITMENT = [
  'COMMITMENT FOR TITLE INSURANCE',
  'Schedule A',
  'Commitment No. SYN-2026-0042',
  'Proposed Insured: Taylor M. Brooks, a single woman',
  'Sale Price: $415,000.00',
  'Amount of Insurance: $420,000.00',
  'GPIN: 0123-45-6789',
  'Chain of Title: prior vesting by Deed recorded as Instrument No. 20180300123456.',
  'Schedule B-I — Requirements to be met:',
  '4. Deed to be executed from Jordan A. Rivers and Casey L. Rivers to the Proposed Insured.',
  'Exhibit A: Lot 17, Block C, Section 3, NEWINGTON GREEN, as recorded in',
  'Deed Book 4821 at Page 119, among the land records of Fairfax County, Virginia.',
  'Issuing Agent: Universal Title and Escrow LLC',
].join('\n');

const COMMITMENT_EXHIBIT_A =
  'Lot 17, Block C, Section 3, NEWINGTON GREEN, as recorded in Deed Book 4821 at Page 119, among the land records of Fairfax County, Virginia.';

const PROBATE_AUTHORITY = [
  'CERTIFICATE OF QUALIFICATION',
  'In the matter concerning the real estate of various Virginia parcels referenced herein.',
  'Estate of John Q. Public, Jr.',
  'FI-2026-0157',
  'Last Will and Testament admitted to probate.',
  'Executor: Dana Rae Whitfield, a/k/a Dana R. Whitfield',
  'The said Executor qualified with full power to sell and convey on behalf of the Estate.',
].join('\n');

const TAX_RECORD = [
  'REAL ESTATE ASSESSMENT',
  'Tax Map 2026 revision, Sheet 12.',
  'Parcel No: 7298-44-1201',
  'Land Value: $120,000.00',
  'Improvement Value: $230,000.00',
  'Total Assessed Value: $350,000.00',
].join('\n');

// ── classification ──────────────────────────────────────────────────────────────

describe('classification', () => {
  it('classifies the four deed-relevant document types', () => {
    expect(classifyDeedDocType(GOLDEN_1).type).toBe('vesting_deed');
    expect(classifyDeedDocType(TITLE_COMMITMENT).type).toBe('title_commitment');
    expect(classifyDeedDocType(PROBATE_AUTHORITY).type).toBe('probate_authority');
    expect(classifyDeedDocType(TAX_RECORD).type).toBe('tax_record');
    expect(classifyDeedDocType('').type).toBe('unknown');
    expect(classifyDeedDocType('asdf qwerty lorem ipsum').type).toBe('unknown');
  });
});

// ── GOLDEN-1 ──────────────────────────────────────────────────────────────────

describe('GOLDEN-1 — living married couple, SFH (line break mid-grantor)', () => {
  const r = extractDeedIngest(GOLDEN_1);

  it('grantors are isolated from the descriptor and split across the line break (EXACT)', () => {
    const g = fld(r, 'grantor');
    expect(g.values).toEqual(['Marcus T. ELLISON', 'Priya ELLISON']);
    expect(g.value).toBeNull(); // multi-valued
    g.values.forEach(expectNameClean);
  });

  it('the marital descriptor is captured SEPARATELY, never inside a name', () => {
    expect(fld(r, 'grantorDescriptor').value).toBe('a married couple');
  });

  it('grantee, tenancy, warranty (EXACT)', () => {
    expect(fld(r, 'grantee').values).toEqual(['Daniel WONG']);
    expect(fld(r, 'grantee').value).toBe('Daniel WONG');
    expect(fld(r, 'tenancy').value).toBe('sole owner');
    expect(fld(r, 'warrantyType').value).toBe('General Warranty');
  });

  it('the multi-line legal description is captured WHOLE, verbatim, not withheld (EXACT)', () => {
    const legal = fld(r, 'legalDescription');
    expect(legal.value).toBe(GOLDEN_1_LEGAL);
    expect(legal.withheld).toBe(false);
    expect(legal.flags).toEqual([]);
    expect(legal.mapsTo).toBe('Legal description');
  });

  it('the vesting prior-deed reference comes from the BEING recital, NOT the plat ref in the legal (EXACT)', () => {
    expect(fld(r, 'vestingPriorDeedRef').value).toBe('Deed Book 25110 at Page 0455');
    expect(fld(r, 'vestingPriorDeedDate').value).toBe('May 2, 2019');
  });

  it('prep-block tax id + money normalized (EXACT)', () => {
    expect(fld(r, 'taxId').value).toBe('7298-44-1201');
    expect(fld(r, 'consideration').value).toBe('612000.00');
    expect(fld(r, 'assessedValue').value).toBe('588400.00');
  });

  it('prior-deed parties map to NEUTRAL prior-deed roles, NOT the new-deed party slots (#19)', () => {
    expect(fld(r, 'grantor').mapsTo).not.toBe('Grantor name');
    expect(fld(r, 'grantee').mapsTo).not.toBe('Grantee name');
    expect(typeof fld(r, 'grantor').mapsTo).toBe('string');
  });
});

// ── GOLDEN-2 ──────────────────────────────────────────────────────────────────

describe('GOLDEN-2 — estate executor, a/k/a + capacity (line break before capacity)', () => {
  const r = extractDeedIngest(GOLDEN_2);

  it('fiduciary name is isolated from the capacity and never crosses the newline (EXACT)', () => {
    const f = fld(r, 'fiduciaryName');
    expect(f.value).toBe('Dana Rae Whitfield');
    // the exact over-capture the rejected attempt produced — must NOT happen:
    expect(f.value).not.toBe('Dana Rae Whitfield The');
    expect(f.value).not.toBe('Dana Rae Whitfield Executor');
    expectNameClean(f.value ?? '');
  });

  it('a/k/a variants are preserved as DISTINCT candidates, un-collapsed (FIRE-B3, EXACT)', () => {
    const f = fld(r, 'fiduciaryName');
    expect(f.candidates).toEqual(['Dana Rae Whitfield', 'Dana R. Whitfield']);
    f.candidates.forEach(expectNameClean);
    expect(r.warnings.join(' ')).toMatch(/aka_variants_unresolved/);
  });

  it('capacity is captured SEPARATELY, not inside the name (EXACT)', () => {
    expect(fld(r, 'fiduciaryCapacity').value).toBe('Executor of Estate of Raymond Earl Whitfield');
  });

  it('decedent / estate-caption name + probate FI number (EXACT)', () => {
    expect(fld(r, 'decedentName').value).toBe('Raymond Earl Whitfield');
    expect(fld(r, 'probateFiNumber').value).toBe('FI-2026-0000412');
  });

  it('grantees (the buyers) are split, with their own descriptor (EXACT)', () => {
    expect(fld(r, 'grantee').values).toEqual(['Carla MENDEZ', 'Luis MENDEZ']);
    expect(fld(r, 'granteeDescriptor').value).toBe('a married couple');
    fld(r, 'grantee').values.forEach(expectNameClean);
  });

  it('the prior-deed reference is the BEING recital deed, with power-of-sale present (EXACT)', () => {
    expect(fld(r, 'vestingPriorDeedRef').value).toBe('Deed Book 16002 at Page 0310');
    expect(fld(r, 'powerOfSale').value).toBe('full power to sell and convey');
  });
});

// ── GOLDEN-3 ──────────────────────────────────────────────────────────────────

describe('GOLDEN-3 — name-change couple + condo', () => {
  const r = extractDeedIngest(GOLDEN_3);

  it('grantors exclude the formerly-of-record name (it lands in its own field, EXACT)', () => {
    const g = fld(r, 'grantor');
    expect(g.values).toEqual(['Owen PARK', 'Jenna PARK']);
    g.values.forEach((n) => {
      expectNameClean(n);
      expect(n).not.toMatch(/LIANG/); // the old name must NOT be in the current name
      expect(n).not.toMatch(/formerly/i);
    });
    expect(fld(r, 'formerlyOfRecord').value).toBe('Jenna LIANG');
  });

  it('grantee + descriptor (EXACT)', () => {
    expect(fld(r, 'grantee').value).toBe('Sofia OKAFOR');
    expect(fld(r, 'granteeDescriptor').value).toBe('unmarried');
  });

  it('condo Declaration + Plat instrument numbers, both captured EXACTLY (C1 exact-match feed)', () => {
    expect(fld(r, 'condoDeclarationInstrument').value).toBe('201906120044100');
    expect(fld(r, 'condoPlatInstrument').value).toBe('201906120044101');
  });

  it('the full multi-line condo legal block is captured whole, not withheld (EXACT)', () => {
    const legal = fld(r, 'legalDescription');
    expect(legal.value).toBe(GOLDEN_3_LEGAL);
    expect(legal.withheld).toBe(false);
  });
});

// ── GOLDEN-4 ──────────────────────────────────────────────────────────────────

describe('GOLDEN-4 — co-fiduciaries', () => {
  const r = extractDeedIngest(GOLDEN_4);

  it('both co-fiduciaries are split despite the capacity containing "Estate of" (EXACT)', () => {
    const f = fld(r, 'fiduciaryName');
    expect(f.values).toEqual(['Grace HOLT', 'Samuel HOLT']);
    expect(f.value).toBeNull(); // multiple DISTINCT signers — neither auto-picked
    expect(f.flags).toContain('co_fiduciaries');
    f.values.forEach(expectNameClean);
  });

  it('capacity + decedent captured separately (EXACT)', () => {
    expect(fld(r, 'fiduciaryCapacity').value).toBe('Co-Executors of Estate of Eleanor Holt');
    expect(fld(r, 'decedentName').value).toBe('Eleanor Holt');
  });
});

// ── POISON fixtures — must FAIL CLOSED ─────────────────────────────────────────

describe('POISON-1 — truncated legal (must withhold the verbatim claim)', () => {
  const r = extractDeedIngest(POISON_1);
  it('the legal description is withheld + flagged truncated, never surfaced as verbatim', () => {
    const legal = fld(r, 'legalDescription');
    expect(legal.value).toBeNull();
    expect(legal.withheld).toBe(true);
    expect(legal.flags).toContain('truncated');
    expect(r.warnings.join(' ')).toMatch(/fields_withheld[^ ]*legalDescription/);
  });
});

describe('POISON-2 — label pollution (must withhold the grantor, never emit junk)', () => {
  const r = extractDeedIngest(POISON_2);
  it('the grantor is withheld + flagged, with no junk value', () => {
    const g = fld(r, 'grantor');
    expect(g.value).toBeNull();
    expect(g.values).toEqual([]);
    expect(g.withheld).toBe(true);
    expect(g.flags).toContain('isolation_failed');
  });
  it('NO field anywhere emits a parenthetical-label or bridge fragment', () => {
    for (const f of r.fields) {
      const all = [f.value ?? '', ...f.values, ...f.candidates];
      for (const s of all) {
        expect(s).not.toMatch(/\(the\s+["'“”]?\s*Grant/i);
        expect(s).not.toMatch(/\)\s*,\s*and\b/i);
      }
    }
  });
});

describe('POISON-3 — parcel decoy (must withhold, never set the id to "record")', () => {
  const r = extractDeedIngest(POISON_3);
  it('taxId is withheld (no GPIN-shaped token), not the word "record"', () => {
    const t = fld(r, 'taxId');
    expect(t.value).toBeNull();
    expect(t.value).not.toBe('record');
    expect(t.withheld).toBe(true);
    expect(t.flags).toContain('low_shape_no_gpin');
  });
  it('the surrounding prep-block money still extracts (the decoy is isolated to taxId)', () => {
    expect(fld(r, 'consideration').value).toBe('612000.00');
    expect(fld(r, 'assessedValue').value).toBe('588400.00');
  });
});

// ── title commitment ───────────────────────────────────────────────────────────

describe('title commitment — bounded required parties, sale-price (not policy amount), GPIN, multi-line Exhibit A', () => {
  const r = extractDeedIngest(TITLE_COMMITMENT);

  it('Sch. B-I Req. 4 required parties stop at " to " and split into a set (EXACT, #4/#20)', () => {
    const rp = fld(r, 'requiredParties');
    expect(rp.values).toEqual(['Jordan A. Rivers', 'Casey L. Rivers']);
    rp.values.forEach((n) => {
      expectNameClean(n);
      expect(n).not.toMatch(/Proposed Insured/i);
      expect(n).not.toMatch(/\bto\b/);
    });
  });

  it('consideration is the SALE price, not the amount of insurance (EXACT, #22)', () => {
    expect(fld(r, 'consideration').value).toBe('415000.00');
    expect(fld(r, 'policyAmount').value).toBe('420000.00');
    expect(fld(r, 'consideration').value).not.toBe('420000.00');
  });

  it('GPIN, proposed insured, issuing agent, multi-line Exhibit A (EXACT)', () => {
    expect(fld(r, 'taxId').value).toBe('0123-45-6789');
    expect(fld(r, 'proposedInsured').value).toBe('Taylor M. Brooks, a single woman');
    expect(fld(r, 'titleInsurer').value).toBe('Universal Title and Escrow LLC');
    expect(fld(r, 'exhibitALegal').value).toBe(COMMITMENT_EXHIBIT_A);
  });

  it('the prior-deed instrument reference requires a digit (EXACT, #6)', () => {
    expect(fld(r, 'priorDeedRef').value).toBe('Instrument No. 20180300123456');
  });

  it('a non-numeric instrument placeholder is NOT captured as a reference (#6)', () => {
    const r2 = extractDeedIngest(TITLE_COMMITMENT.replace('Instrument No. 20180300123456', 'Instrument No. SEE-ATTACHED'));
    // the only remaining digit-bearing recording ref is the Exhibit A "Deed Book 4821 at Page 119".
    expect(fld(r2, 'priorDeedRef').value).toBe('Deed Book 4821 at Page 119');
  });
});

// ── probate authority ──────────────────────────────────────────────────────────

describe('probate / certificate of qualification — real-estate guard, suffix retention, fiduciary variants', () => {
  const r = extractDeedIngest(PROBATE_AUTHORITY);

  it('decedent skips "real estate of …" and keeps the generational suffix (EXACT, #7/#21)', () => {
    expect(fld(r, 'decedentName').value).toBe('John Q. Public, Jr.');
  });

  it('FI number with the FI- prefix (EXACT)', () => {
    expect(fld(r, 'probateFiNumber').value).toBe('FI-2026-0157');
  });

  it('role-labeled fiduciary name + a/k/a variants (EXACT)', () => {
    const f = fld(r, 'fiduciaryName');
    expect(f.value).toBe('Dana Rae Whitfield');
    expect(f.candidates).toEqual(['Dana Rae Whitfield', 'Dana R. Whitfield']);
    expect(fld(r, 'powerOfSale').value).toBe('full power to sell and convey');
  });
});

// ── rework-review regressions (the 39 confirmed findings) ──────────────────────
// Every block below is a fixture for a defect the adversarial review confirmed in the first rework cut. Each
// asserts the CORRECT post-fix behavior by exact match / fail-closed withholding, so the class cannot regress.

const D_HEAD = 'THIS DEED, made this ___ day of June, 2026, by and between ';
const D_TAIL =
  ' WITNESSETH that the Grantors do hereby grant, with General Warranty, unto the said Grantee, in fee simple, as sole owner, all that parcel located in Fairfax County, Commonwealth of Virginia, to wit:\n   Lot 1, SOMEWHERE, recorded in Deed Book 1 at Page 1, Fairfax County, Virginia.\n   BEING the same property conveyed unto the grantors by Deed dated May 1, 2000, recorded in Deed Book 2 at Page 2.\nThis conveyance is made subject to covenants of record.';

describe('multi-party comma lists are split into DISTINCT people (#1, #14, #17, #18)', () => {
  it('"A, B and C" -> three distinct grantors, none comma-glued (EXACT)', () => {
    const g = fld(extractDeedIngest(D_HEAD + 'Alan SMITH, Beth SMITH and Carl SMITH, (the "Grantors"), and Dee WONG, (the "Grantee"),' + D_TAIL), 'grantor');
    expect(g.values).toEqual(['Alan SMITH', 'Beth SMITH', 'Carl SMITH']);
    g.values.forEach(expectNameClean);
  });
  it('comma-only "A, B" -> two distinct grantors (EXACT)', () => {
    const g = fld(extractDeedIngest(D_HEAD + 'Alan SMITH, Beth SMITH, (the "Grantors"), and Dee WONG, (the "Grantee"),' + D_TAIL), 'grantor');
    expect(g.values).toEqual(['Alan SMITH', 'Beth SMITH']);
    g.values.forEach(expectNameClean);
  });
});

describe('co-fiduciary glued with a/k/a is NOT collapsed into one variant (#3, #14, #18)', () => {
  const r = extractDeedIngest(
    'CERTIFICATE OF QUALIFICATION\nEstate of Big DOE\nFI-2026-0001\nExecutor: Dana Rae Whitfield, a/k/a Dana R. Whitfield and Marcus Lee Whitfield\nThe said Executors qualified with full power to sell and convey on behalf of the Estate.',
  );
  it('two DISTINCT signers in values; Dana\'s a/k/a alias preserved; value withheld (EXACT)', () => {
    const f = fld(r, 'fiduciaryName');
    expect(f.values).toEqual(['Dana Rae Whitfield', 'Marcus Lee Whitfield']);
    expect(f.value).toBeNull();
    expect(f.candidates).toEqual(['Dana Rae Whitfield', 'Dana R. Whitfield']);
    expect(f.flags).toContain('co_fiduciaries');
    f.values.forEach(expectNameClean);
    // the exact corruption the rework review caught — must NOT appear as a candidate:
    expect(f.candidates).not.toContain('Dana R. Whitfield and Marcus Lee Whitfield');
  });
});

describe('living grantor a/k/a variants are now carried, not dropped (#20)', () => {
  it('grantor value = primary, candidates carry the alias (EXACT)', () => {
    const g = fld(extractDeedIngest(D_HEAD + 'Owen PARK, a/k/a Owen P. PARK, (the "Grantor"), and Sofia OKAFOR, (the "Grantee"),' + D_TAIL), 'grantor');
    expect(g.value).toBe('Owen PARK');
    expect(g.candidates).toEqual(['Owen PARK', 'Owen P. PARK']);
    expect(g.flags).toContain('aka_variants_present');
  });
});

describe('article-led marital descriptor is peeled, not glued (#2)', () => {
  const r = extractDeedIngest(D_HEAD + 'Owen PARK, an unmarried man, (the "Grantor"), and Sofia OKAFOR, an unmarried woman, (the "Grantee"),' + D_TAIL);
  it('"an unmarried man/woman" -> separate descriptor field (EXACT)', () => {
    expect(fld(r, 'grantor').value).toBe('Owen PARK');
    expect(fld(r, 'grantorDescriptor').value).toBe('an unmarried man');
    expect(fld(r, 'grantee').value).toBe('Sofia OKAFOR');
    expect(fld(r, 'granteeDescriptor').value).toBe('an unmarried woman');
    expectNameClean(fld(r, 'grantor').value ?? '');
  });
});

describe('legal block is NOT truncated at an INLINE "subject to"/"being" inside the metes (#4, #7, #12, #19)', () => {
  it('a metes-and-bounds legal with an internal "subject to covenants of record" is captured WHOLE (EXACT)', () => {
    const text =
      'THIS DEED by and between A AA, (the "Grantor"), and B BB, (the "Grantee"), in fee simple, as sole owner, located in Fairfax County, Commonwealth of Virginia, to wit:\n   BEGINNING at an iron pin; thence N 10 E 100 feet, the parcel being subject to covenants of record in DB 5 PG 5; thence S 80 E 50 feet to the POINT OF BEGINNING, containing 2.5 acres.\n   BEING the same property conveyed unto A AA by Deed in Deed Book 9 at Page 9.\nThis conveyance is made subject to covenants of record.';
    const legal = fld(extractDeedIngest(text), 'legalDescription');
    expect(legal.value).toBe('BEGINNING at an iron pin; thence N 10 E 100 feet, the parcel being subject to covenants of record in DB 5 PG 5; thence S 80 E 50 feet to the POINT OF BEGINNING, containing 2.5 acres.');
    expect(legal.withheld).toBe(false);
  });
});

describe('a withheld critical field forces document-level review (#37)', () => {
  it('POISON-1 (truncated legal) -> lowConfidence + critical_field_unresolved', () => {
    const r = extractDeedIngest(POISON_1);
    expect(fld(r, 'legalDescription').withheld).toBe(true);
    expect(r.lowConfidence).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/critical_field_unresolved[^ ]*legalDescription/);
  });
});

describe('money: a cell with two amounts is withheld, never merged (#6)', () => {
  it('two amounts run together -> withheld multiple_amounts', () => {
    const r = extractDeedIngest(D_HEAD + 'A AA, (the "Grantor"), and B BB, (the "Grantee"),' + D_TAIL + '\nConsideration: $612,000.00 $588,400.00');
    const c = fld(r, 'consideration');
    expect(c.value).toBeNull();
    expect(c.withheld).toBe(true);
    expect(c.flags).toContain('multiple_amounts');
  });
});

describe('decedent: mid-string "deceased" stripped, suffix kept (#9, #21)', () => {
  it('"Estate of John Q. Public, Jr., deceased, late of Fairfax County" -> "John Q. Public, Jr." (EXACT)', () => {
    const r = extractDeedIngest('CERTIFICATE OF QUALIFICATION\nEstate of John Q. Public, Jr., deceased, late of Fairfax County.\nFI-2026-0009\nExecutor: Jane DOE');
    expect(fld(r, 'decedentName').value).toBe('John Q. Public, Jr.');
  });
});

describe('parcel id is bound to its own column (no neighbour-column bleed) (#11, #26)', () => {
  it('GPIN cell is taken, an adjacent phone column is not (EXACT)', () => {
    const r = extractDeedIngest('REAL ESTATE ASSESSMENT\nLand Value: $1.00\nGPIN: 7298-44-1201   Phone: 555-123-4567');
    expect(fld(r, 'parcelId').value).toBe('7298-44-1201');
  });
});

describe('title commitment: requiredParties anchoring + descriptor peel + decoy resistance (#8, #13, #15, #34)', () => {
  it('an earlier "conveyed from X to Y" decoy is ignored; Req. 4 parties win (EXACT)', () => {
    const text =
      'COMMITMENT FOR TITLE INSURANCE\nSchedule A\nThe estate or interest to be insured is to be conveyed from the current record owner to the proposed purchaser pursuant to the contract.\nProposed Insured: Taylor M. Brooks\nSchedule B-I — Requirements to be met:\n4. Deed to be executed from Jordan A. Rivers and Casey L. Rivers to the Proposed Insured.';
    const rp = fld(extractDeedIngest(text), 'requiredParties');
    expect(rp.values).toEqual(['Jordan A. Rivers', 'Casey L. Rivers']);
    rp.values.forEach(expectNameClean);
  });
  it('a trailing marital descriptor on the required-party clause is peeled (EXACT)', () => {
    const text = 'COMMITMENT FOR TITLE INSURANCE\nSchedule B-I — Requirements to be met:\n4. Deed to be executed from Jordan A. Rivers and Casey L. Rivers, husband and wife, to the Proposed Insured.';
    const rp = fld(extractDeedIngest(text), 'requiredParties');
    expect(rp.values).toEqual(['Jordan A. Rivers', 'Casey L. Rivers']);
    rp.values.forEach(expectNameClean);
  });
  it('a three-person comma list of required parties is split into three (EXACT)', () => {
    const text = 'COMMITMENT FOR TITLE INSURANCE\nSchedule B-I — Requirements to be met:\n4. Deed to be executed from Jordan A. Rivers, Casey L. Rivers and Pat Q. Rivers to the Proposed Insured.';
    expect(fld(extractDeedIngest(text), 'requiredParties').values).toEqual(['Jordan A. Rivers', 'Casey L. Rivers', 'Pat Q. Rivers']);
  });
});

describe('title commitment: Exhibit A boundary — no label bleed, no end-of-doc miss (#5, #23, #33)', () => {
  const EA = 'Lot 17, Block C, NEWINGTON GREEN, recorded in Deed Book 4821 at Page 119, Fairfax County, Virginia.';
  it('Exhibit A that PRECEDES the Schedule-A caption labels stops at the first label (EXACT)', () => {
    const text = `COMMITMENT FOR TITLE INSURANCE\nSchedule A\nExhibit A: ${EA}\nCommitment No. SYN-1\nProposed Insured: Taylor Brooks\nSchedule B-I — Requirements to be met:\n4. Deed to be executed from Jordan Rivers to the Proposed Insured.`;
    expect(fld(extractDeedIngest(text), 'exhibitALegal').value).toBe(EA);
  });
  it('Exhibit A that ENDS the document is captured whole, not dropped (EXACT)', () => {
    const text = `COMMITMENT FOR TITLE INSURANCE\nSchedule A\nGPIN: 0123-45-6789\nSchedule B-I — Requirements to be met:\n4. Deed to be executed from Jordan Rivers to the Proposed Insured.\nExhibit A: ${EA}`;
    expect(fld(extractDeedIngest(text), 'exhibitALegal').value).toBe(EA);
  });
  it('Exhibit A followed by a BEING vesting recital stops at BEING, not swallowing it (#15)', () => {
    const text = `COMMITMENT FOR TITLE INSURANCE\nSchedule A\nExhibit A: ${EA}\nBEING the same property conveyed unto Grantor by prior deed.\nIssuing Agent: Universal Title LLC`;
    expect(fld(extractDeedIngest(text), 'exhibitALegal').value).toBe(EA);
  });
});

// ── second-pass regressions (the 19 confirmed in re-review) ────────────────────
// Defects that the FIRST fix round introduced (over-split / over-reject / under-terminate). Each asserts the
// corrected behavior by exact match or fail-closed withholding so the regression cannot recur.

describe('suffix + a/k/a on one person is NOT shattered into a phantom "Jr." party (#1, #2)', () => {
  it('"John PUBLIC, Jr., a/k/a Johnny PUBLIC, Jr." -> one person, both suffixed variants (EXACT)', () => {
    const g = fld(extractDeedIngest(D_HEAD + 'John PUBLIC, Jr., a/k/a Johnny PUBLIC, Jr., (the "Grantor"), and Buyer ONE, (the "Grantee"),' + D_TAIL), 'grantor');
    expect(g.value).toBe('John PUBLIC, Jr.');
    expect(g.values).toEqual(['John PUBLIC, Jr.']);
    expect(g.candidates).toEqual(['John PUBLIC, Jr.', 'Johnny PUBLIC, Jr.']);
    expect(g.candidates).not.toContain('Jr.');
  });
});

describe('post-nominals (M.D., 2nd) stay on the name, not a phantom party (#3, #7, #11, #13)', () => {
  it('"John PUBLIC, M.D." -> one person (EXACT)', () => {
    expect(fld(extractDeedIngest(D_HEAD + 'John PUBLIC, M.D., (the "Grantor"), and Buyer ONE, (the "Grantee"),' + D_TAIL), 'grantor').values).toEqual(['John PUBLIC, M.D.']);
  });
  it('"John PUBLIC, 2nd" -> one person (EXACT)', () => {
    expect(fld(extractDeedIngest(D_HEAD + 'John PUBLIC, 2nd, (the "Grantor"), and Buyer ONE, (the "Grantee"),' + D_TAIL), 'grantor').values).toEqual(['John PUBLIC, 2nd']);
  });
});

describe('entity/business parties FAIL CLOSED, never split into phantom people (#6, #8, #9, #12, #14, #17)', () => {
  it('an LLC/entity grantor is withheld, not emitted as people', () => {
    for (const span of ['Smith and Jones, LLC', 'Acme Properties LLC', 'Riverbend Holdings, Inc.']) {
      const g = fld(extractDeedIngest(D_HEAD + `${span}, (the "Grantor"), and Buyer ONE, (the "Grantee"),` + D_TAIL), 'grantor');
      expect(g.value).toBeNull();
      expect(g.values).toEqual([]);
      expect(g.withheld).toBe(true);
    }
  });
  it('a "The … Trust" grantee is withheld (entity + capitalized determiner)', () => {
    const r = extractDeedIngest(D_HEAD + 'Marcus ELLISON, (the "Grantor"), and The John Smith Revocable Trust dated January 1 2020, (the "Grantee"),' + D_TAIL);
    expect(fld(r, 'grantee').withheld).toBe(true);
    expect(fld(r, 'grantee').value).toBeNull();
  });
  it('an entity required party in a commitment is withheld (C2-critical fail-closed)', () => {
    const rp = fld(extractDeedIngest('COMMITMENT FOR TITLE INSURANCE\nSchedule B-I — Requirements to be met:\n4. Deed to be executed from Acme Holdings, LLC to the Proposed Insured.'), 'requiredParties');
    expect(rp.withheld).toBe(true);
    expect(rp.values).toEqual([]);
  });
});

describe('legal terminator handles an OCR-joined BEING recital without swallowing it (#4, #10)', () => {
  it('"…Virginia. BEING the same property…" on one line -> legal ends at "Virginia." (EXACT)', () => {
    const text = 'THIS DEED by and between A AA, (the "Grantor"), and B BB, (the "Grantee"), in fee simple, as sole owner, located in Fairfax County, Commonwealth of Virginia, to wit:\n   Lot 9, BLUE ACRES, Fairfax County, Virginia. BEING the same property conveyed unto A AA by Deed in Deed Book 9 at Page 9.\nThis conveyance is made subject to covenants of record.';
    const legal = fld(extractDeedIngest(text), 'legalDescription');
    expect(legal.value).toBe('Lot 9, BLUE ACRES, Fairfax County, Virginia.');
    expect(legal.value).not.toMatch(/BEING the same/);
  });
});

describe('requiredParties: Sch. B-I scoping + Deed-of-Trust exclusion (#5)', () => {
  it('a "Deed of Trust from X to Y" decoy on Schedule A is ignored; Req. 4 wins (EXACT)', () => {
    const text = 'COMMITMENT FOR TITLE INSURANCE\nSchedule A\nA Deed of Trust from John Borrower to Big Bank secures the loan.\nSchedule B-I — Requirements to be met:\n4. Deed to be executed from Jordan A. Rivers to the Proposed Insured.';
    expect(fld(extractDeedIngest(text), 'requiredParties').values).toEqual(['Jordan A. Rivers']);
  });
});

describe('a legitimate nobiliary-particle name is captured, not false-withheld (#18, #19)', () => {
  it('"Hans von STADE" is captured intact (EXACT)', () => {
    expect(fld(extractDeedIngest(D_HEAD + 'Hans von STADE, (the "Grantor"), and Buyer ONE, (the "Grantee"),' + D_TAIL), 'grantor').value).toBe('Hans von STADE');
  });
});

// ── third-pass regressions (entity dead-branches, spaced credentials, interior AND BEING, region labels) ──

describe('entity gate: dead "& Sons"/"Co." branches + missing designators now fail closed', () => {
  it('"&  Sons" / "Co." / common designators are withheld, not split into phantom people', () => {
    for (const span of ['Smith & Sons', 'ABC Co.', 'Smith and Wesson Enterprises', 'Riverbend Group', 'Acme Realty', 'Jones Brothers']) {
      const g = fld(extractDeedIngest(D_HEAD + `${span}, (the "Grantor"), and Buyer ONE, (the "Grantee"),` + D_TAIL), 'grantor');
      expect(g.withheld).toBe(true);
      expect(g.values).toEqual([]);
    }
  });
});

describe('entity gate does NOT over-reject a legitimate surname (Church/Bank) (re-review surname collision)', () => {
  it('"Mary Church" and "Thomas Bank" are captured as individuals (EXACT)', () => {
    expect(fld(extractDeedIngest(D_HEAD + 'Mary Church, (the "Grantor"), and Buyer ONE, (the "Grantee"),' + D_TAIL), 'grantor').value).toBe('Mary Church');
    expect(fld(extractDeedIngest(D_HEAD + 'Thomas Bank, (the "Grantor"), and Buyer ONE, (the "Grantee"),' + D_TAIL), 'grantor').value).toBe('Thomas Bank');
  });
});

describe('an OCR-spaced credential stays on the name, not a phantom party (re-review spaced-credential)', () => {
  it('"John PUBLIC, M D" -> one person (EXACT)', () => {
    expect(fld(extractDeedIngest(D_HEAD + 'John PUBLIC, M D, (the "Grantor"), and Buyer ONE, (the "Grantee"),' + D_TAIL), 'grantor').values).toEqual(['John PUBLIC, M D']);
  });
});

describe('an interior "AND BEING" plat continuation does NOT truncate the legal mid-block (re-review HIGH)', () => {
  it('legal captures through "AND BEING a re-subdivision … containing 2.5 acres." to the true vesting recital', () => {
    const text = 'THIS DEED by and between A AA, (the "Grantor"), and B BB, (the "Grantee"), in fee simple, as sole owner, located in Fairfax County, Commonwealth of Virginia, to wit:\n   Lot 5, BLOCK A, GREEN ACRES. AND BEING a re-subdivision of Lot 4 per plat recorded in Deed Book 3 at Page 3, containing 2.5 acres.\n   BEING the same property conveyed unto A AA by Deed in Deed Book 9 at Page 9.\nThis conveyance is made subject to covenants of record.';
    const legal = fld(extractDeedIngest(text), 'legalDescription');
    expect(legal.value).toBe('Lot 5, BLOCK A, GREEN ACRES. AND BEING a re-subdivision of Lot 4 per plat recorded in Deed Book 3 at Page 3, containing 2.5 acres.');
    expect(legal.withheld).toBe(false);
  });
});

describe('requiredParties recognizes alternate Schedule B-I labels; no region -> fail closed (re-review label miss)', () => {
  it('"Schedule B, Part I" still confines the search and resists a Schedule-A decoy (EXACT)', () => {
    const text = 'COMMITMENT FOR TITLE INSURANCE\nSchedule A\nA Deed to be executed from Morgan T. Wells to Riley P. Stone is contemplated.\nSchedule B, Part I:\n4. Deed to be executed from Jordan A. Rivers to the Proposed Insured.';
    expect(fld(extractDeedIngest(text), 'requiredParties').values).toEqual(['Jordan A. Rivers']);
  });
  it('a commitment with NO recognizable requirements region withholds requiredParties (no full-text decoy scan)', () => {
    const r = extractDeedIngest('COMMITMENT FOR TITLE INSURANCE\nSome freeform text with a Deed from Decoy A to Decoy B mentioned.');
    const rp = fld(r, 'requiredParties');
    expect(rp.values).toEqual([]);
    expect(r.lowConfidence).toBe(true); // critical-field routing fires
  });
});

// ── tax record ─────────────────────────────────────────────────────────────────

describe('tax record — parcel id requires a GPIN shape, not a year/word', () => {
  const r = extractDeedIngest(TAX_RECORD);

  it('captures the real parcel id, not the "Tax Map 2026 revision" year or sheet (EXACT, #5/#12)', () => {
    expect(fld(r, 'parcelId').value).toBe('7298-44-1201');
    expect(fld(r, 'parcelId').value).not.toBe('2026');
    expect(fld(r, 'assessedValue').value).toBe('350000.00');
  });

  it('an alpha-led token (Lot4Block) is rejected, not surfaced as an authoritative id (#12)', () => {
    const r2 = extractDeedIngest('REAL ESTATE ASSESSMENT\nLand Value: $1.00\nTax Map: Lot4Block');
    const p = fld(r2, 'parcelId');
    expect(p.value).toBeNull();
    expect(p.withheld).toBe(true);
  });
});

// ── fail-closed routing (#10) ────────────────────────────────────────────────

describe('fail-closed routing — type-uncertain or zero-field documents route to human review', () => {
  it('garbled / unrecognized input routes to review (lowConfidence, no fields)', () => {
    const r = extractDeedIngest('zzzz qqqq 1234 ~~~ nonsense');
    expect(r.docType).toBe('unknown');
    expect(r.lowConfidence).toBe(true);
  });

  it('a barely-classified document (typeConfidence below the floor) is forced to review, even with a field', () => {
    // a single weak deed signal -> low typeConfidence; the document must still route to review (#10).
    const r = extractDeedIngest('THIS DEED. Consideration: $5.00');
    if (r.typeConfidence < 60) expect(r.lowConfidence).toBe(true);
  });
});

// ── hand-off does NOT bypass the recordability gates (C1/C2) ───────────────────

describe('hand-off does NOT bypass the recordability gates', () => {
  it('an ingest-extracted legal still faces C1 — divergence from the commitment fails closed', () => {
    const extractedLegal = fld(extractDeedIngest(GOLDEN_1), 'legalDescription').value;
    expect(extractedLegal).toBe(GOLDEN_1_LEGAL);
    const legal = extractedLegal ?? '';
    const c1 = checkLegalDescription({
      draftLegal: legal,
      commitmentExhibitA: legal.replace('Lot 12', 'Lot 99'),
      priorDeedLegal: legal,
    });
    expect(c1.ok).toBe(false);
  });

  it('ingest-extracted required parties still face C2 — a missing grantor fails closed', () => {
    const required = fld(extractDeedIngest(TITLE_COMMITMENT), 'requiredParties').values;
    expect(required).toEqual(['Jordan A. Rivers', 'Casey L. Rivers']);
    const c2 = checkRequiredParties({
      draftGrantors: ['Jordan A. Rivers'], // Casey omitted
      requiredParties: required,
      authorityByGrantor: { 'Jordan A. Rivers': 'prior deed DB 1 PG 1' },
    });
    expect(c2.ok).toBe(false);
  });
});

// ── determinism ────────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('produces byte-identical output on the same input', () => {
    for (const fx of [GOLDEN_1, GOLDEN_2, GOLDEN_3, GOLDEN_4, TITLE_COMMITMENT, PROBATE_AUTHORITY, TAX_RECORD]) {
      expect(JSON.stringify(extractDeedIngest(fx))).toBe(JSON.stringify(extractDeedIngest(fx)));
    }
  });
});

// ── Monster UAT v2 (2026-06-26) extraction-bundle fixes: TAX-1 / TAX-2 / EXTRACT-ZW / UAT-G1 ──────────────────────

// A Fairfax County GIS / Department of Tax Administration printout shape: its assessment table uses Fairfax labels
// (MAP #, Land Use Code, Reassessment, Total Value), NOT the generic "Assessed Value" wording — so under the old
// classifier it scored ZERO tax_record hits and misclassified as probate_authority off the bare "Administrator"
// token, which then injected a FALSE estate signal AND left the Quick-Deed pre-fill blank (assessedValue/parcelId).
const FAIRFAX_GIS = [
  'Fairfax County Department of Tax Administration',
  'Real Property Information',
  'MAP #: 0911-13106060B',
  'Property Address: 7720 Marlowe Glen Court, Springfield, VA 22150',
  'Land Use Code: 031 Residential',
  'Reassessment Notice',
  'Total Value: $612,400.00',
  'Contact the Website Administrator for portal access. General Incident reporting available.',
].join('\n');

describe('TAX-1 — Fairfax tax printouts classify as tax_record, not probate (no false estate signal)', () => {
  it('bare "Administrator"/"Incident" tokens alone do NOT score probate_authority (the role needs estate context)', () => {
    // Under the old bare-role pattern this scored probate_authority (conf 55); now it must not.
    expect(classifyDeedDocType('Fairfax County GIS portal. Website Administrator login. General Incident reporting. Parcel viewer.').type).not.toBe('probate_authority');
  });

  it('a Fairfax GIS printout classifies tax_record (Fairfax signals win; the Administrator token is inert)', () => {
    expect(classifyDeedDocType(FAIRFAX_GIS).type).toBe('tax_record');
  });

  it('assessedValue + parcelId RESOLVE from the Fairfax layout (Total Value + MAP #) — QD-3 pre-fill restored', () => {
    const r = extractDeedIngest(FAIRFAX_GIS);
    expect(fld(r, 'parcelId').value).toBe('0911-13106060B');
    expect(fld(r, 'assessedValue').value).toBe('612400.00');
  });

  it('REGRESSION: a genuine probate authority still classifies probate_authority', () => {
    expect(classifyDeedDocType(PROBATE_AUTHORITY).type).toBe('probate_authority');
  });

  it('CASCADE: a gift packet (vesting deed + a Fairfax tax record) does NOT signal an estate', () => {
    const GIFT_VESTING = [
      'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Marcus T. ELLISON, (the "Grantee"),',
      'WITNESSETH that the Grantor does hereby grant and convey, with General Warranty, unto the said Grantee, in fee simple, all that parcel located in Fairfax County, Commonwealth of Virginia, to wit:',
      '   Lot 27, HAWTHORNE RIDGE, recorded in Deed Book 8412 at Page 0337, among the land records of Fairfax County, Virginia.',
      '   BEING the same property conveyed unto Harold V. Greer by Deed in Deed Book 3000 at Page 100.',
      'This conveyance is made subject to covenants of record.',
    ].join('\n');
    const facts = consolidateDeedSourceFacts([
      { materialId: 'v', textContent: GIFT_VESTING },
      { materialId: 't', textContent: FAIRFAX_GIS },
    ]);
    expect(facts.estateSource.signaled).toBe(false);
    expect(facts.estateSource.signals).not.toContain('probate_authority_document');
  });
});

describe('TAX-2 — GPIN shape accepts the Fairfax trailing-alpha (and OCR space) form, without the E5 false-accept', () => {
  it('a hyphen-grouped Tax-ID with a trailing alpha suffix ("0911-13106060B") extracts', () => {
    const r = extractDeedIngest('REAL ESTATE ASSESSMENT\nTax I.D. Number: 0911-13106060B\nTotal Assessed Value: $500,000.00');
    expect(fld(r, 'parcelId').value).toBe('0911-13106060B');
  });

  it('the OCR space-grouped form ("0911 13106060B") extracts when it is the whole cell value', () => {
    const r = extractDeedIngest('REAL ESTATE ASSESSMENT\nTax I.D. Number: 0911 13106060B\nTotal Assessed Value: $500,000.00');
    expect(fld(r, 'parcelId').value).toBe('0911 13106060B');
  });

  it('NEG (E5 guard): a single-digit-group tax-map ("22-4-61") is STILL withheld, never falsely accepted', () => {
    const r = extractDeedIngest('REAL ESTATE ASSESSMENT\nTax Map: 22-4-61\nTotal Assessed Value: $400,000.00');
    const p = fld(r, 'parcelId');
    expect(p.value).toBeNull();
    expect(p.flags).toContain('low_shape_no_gpin');
  });
});

describe('EXTRACT-ZW — zero-width characters are stripped from the extracted (recordable) text', () => {
  const ZW = '\u200B';
  it('the verbatim legal carries no U+200B even when the source sprinkles them (incl. after the terminal period)', () => {
    const src = [
      'THIS DEED, made this 2nd day of June, 2026, by and between Marcus T. ELLISON, (the "Grantor"), and Daniel WONG, (the "Grantee"),',
      'WITNESSETH that the Grantor does hereby grant and convey, with General Warranty, unto the said Grantee, in fee simple, all that parcel located in Prince William County, Commonwealth of Virginia, to wit:',
      `   Lot 12${ZW}, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 244, among the land records of Prince William County, Virginia.${ZW}${ZW}`,
      '   BEING the same property conveyed to Marcus T. Ellison by Deed in Deed Book 25110 at Page 0455.',
      'This conveyance is made subject to covenants of record.',
    ].join('\n');
    const legal = fld(extractDeedIngest(src), 'legalDescription');
    expect(legal.value).not.toBeNull();
    expect(legal.value!).not.toContain(ZW); // invisible chars never ride into the recordable legal
    expect(legal.value!).toContain('Lot 12, Section 3, CEDAR RUN ESTATES'); // and the strip did not corrupt the text
    expect(legal.flags).not.toContain('truncated');
  });
});

describe('UAT-G1 — the no-space "…Virginia.Being…" recital does not run into the verbatim legal', () => {
  const LEGAL = 'Lot 12, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 244, among the land records of Prince William County, Virginia.';
  const head = [
    'THIS DEED, made this 2nd day of June, 2026, by and between Marcus T. ELLISON, (the "Grantor"), and Daniel WONG, (the "Grantee"),',
    'WITNESSETH that the Grantor does hereby grant and convey, with General Warranty, unto the said Grantee, in fee simple, all that parcel located in Prince William County, Commonwealth of Virginia, to wit:',
  ].join('\n');
  const tail = 'This conveyance is made subject to covenants of record.';
  const RECITAL = 'Being the same property conveyed to Marcus T. Ellison by Deed in Deed Book 25110 at Page 0455.';

  it('GOLD: the collapsed (no-space) source terminates the legal at the legal — no run-on, no recital in the block', () => {
    const collapsed = `${head}\n   ${LEGAL}${RECITAL}\n${tail}`; // "...Virginia.Being the same property..."
    const legal = fld(extractDeedIngest(collapsed), 'legalDescription');
    expect(legal.value).toBe(LEGAL);
    expect(legal.value!).not.toContain('Being the same property');
  });

  it('the spaced source is unchanged (same legal block)', () => {
    const spaced = `${head}\n   ${LEGAL}  ${RECITAL}\n${tail}`; // "...Virginia.  Being the same property..."
    expect(fld(extractDeedIngest(spaced), 'legalDescription').value).toBe(LEGAL);
  });
});
