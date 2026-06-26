/**
 * DEED-DRAFT-AGENT-1 QUICK DEED — multi-category dispatch (into-LLC / out-of-LLC / TOD / confirmation / into-trust).
 *
 * The fast-lane quickDeed.generate now dispatches every built category, each reusing its matter-scoped build core
 * (the {status:'OK'|'WITHHELD', deed?} categories). This battery proves, per category:
 *   - GOLD happy path: a deed doc + version is persisted; the version content carries the VERBATIM legal + the
 *     category's load-bearing facts; the document notes carry the structural one-liner + the conflicts-bypass
 *     stamp; the stamp is NEVER in the recordable deed body.
 *   - NEG fail-closed: a known fail-closed trigger yields failedClosed:true, no document persisted, the flag
 *     surfaced in `failures`.
 *
 * Same DB/gate-leaf mocking style as quick_deed_qd1.test.ts (the pure assemblers run for real). Fixtures mirror the
 * per-category matter-scoped draft tests (the OK inputs + materials packets that the assemblers accept).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../db/queries/matters.js', () => ({ getMatterById: vi.fn(), insertMatter: vi.fn() }));
vi.mock('../db/queries/materials.js', () => ({ listMaterialsForMatter: vi.fn() }));
vi.mock('../db/queries/documents.js', () => ({
  insertDocument: vi.fn(),
  updateDocumentCurrentVersion: vi.fn(),
  updateDocumentNotes: vi.fn(),
  getDocumentById: vi.fn(),
}));
vi.mock('../db/queries/versions.js', () => ({
  getNextVersionNumber: vi.fn(),
  insertVersion: vi.fn(),
  getLatestVersionForDocument: vi.fn(),
}));
vi.mock('../conflicts/postureGate.js', () => ({ resolvePostureDraftingGate: vi.fn() }));
vi.mock('../db/queries/conflicts.js', () => ({ hasUndispositionedBlocker: vi.fn() }));
vi.mock('../db/queries/conflictPolicy.js', () => ({ getFirmConflictPolicy: vi.fn(), setFirmConflictPolicy: vi.fn() }));

import { quickDeedRouter, QUICK_DEED_NO_CONFLICTS_NOTE } from '../procedures/deedDraftAgent.js';
import { getMatterById } from '../db/queries/matters.js';
import { listMaterialsForMatter } from '../db/queries/materials.js';
import { insertDocument, updateDocumentCurrentVersion } from '../db/queries/documents.js';
import { getNextVersionNumber, insertVersion } from '../db/queries/versions.js';
import { getFirmConflictPolicy } from '../db/queries/conflictPolicy.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const M1 = '22222222-2222-2222-2222-222222222222';
const quick = () => quickDeedRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 });

type Mock = ReturnType<typeof vi.fn>;
const mat = (id: string, textContent: string) => ({ id, textContent });

/** Wire the standard owned-matter + persist mocks for a happy-path generate. */
function mockHappyPath(materials: { id: string; textContent: string }[], docId: string, verId: string): void {
  (getMatterById as Mock).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
  (listMaterialsForMatter as Mock).mockResolvedValue(materials.map((m) => ({ ...m })));
  (insertDocument as Mock).mockResolvedValue({ id: docId, documentType: 'deed' });
  (getNextVersionNumber as Mock).mockResolvedValue(1);
  (insertVersion as Mock).mockResolvedValue({ id: verId, versionNumber: 1 });
  (updateDocumentCurrentVersion as Mock).mockResolvedValue({ id: docId });
}
function mockWithheld(materials: { id: string; textContent: string }[]): void {
  (getMatterById as Mock).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
  (listMaterialsForMatter as Mock).mockResolvedValue(materials.map((m) => ({ ...m })));
}
const docArg = () => (insertDocument as Mock).mock.calls[0]?.[0];
const verArg = () => (insertVersion as Mock).mock.calls[0]?.[0];

const origDeed = process.env['DEED_DRAFT_AGENT_ENABLED'];
const origConflict = process.env['CONFLICT_GATE_ENABLED'];

beforeEach(() => {
  vi.clearAllMocks();
  process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
  delete process.env['CONFLICT_GATE_ENABLED'];
  (getFirmConflictPolicy as Mock).mockResolvedValue({
    policy: { schemaVersion: 1, transactionalPosture: 'ENFORCED', deedConflictsEnforced: false },
    source: 'default',
  });
});
afterEach(() => {
  if (origDeed === undefined) delete process.env['DEED_DRAFT_AGENT_ENABLED'];
  else process.env['DEED_DRAFT_AGENT_ENABLED'] = origDeed;
  if (origConflict === undefined) delete process.env['CONFLICT_GATE_ENABLED'];
  else process.env['CONFLICT_GATE_ENABLED'] = origConflict;
});

// ── shared assertions ─────────────────────────────────────────────────────────────────────────────────────────
function assertGold(res: { documentId: unknown }, contentMarkers: string[], notesMarkers: string[]): void {
  expect(res.documentId).not.toBeNull();
  const notes = docArg().notes as string;
  const content = verArg().content as string;
  // the conflicts-bypass stamp is threaded into the document notes (schema-free), never the recordable deed body
  expect(notes).toContain(QUICK_DEED_NO_CONFLICTS_NOTE);
  expect(content).not.toContain(QUICK_DEED_NO_CONFLICTS_NOTE);
  expect(notes).toContain('Generated by DEED-DRAFT-AGENT-1 (deterministic). The attorney reviews/edits/approves; this draft is never auto-recorded, filed, or sent.');
  for (const m of notesMarkers) expect(notes).toContain(m);
  for (const m of contentMarkers) expect(content).toContain(m);
}

// ════════════════════════════ C3 — Deed Into an LLC ════════════════════════════
describe('quickDeed.generate — into-LLC dispatch (C3)', () => {
  const MATERIALS = [
    mat('v', [
      'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Dahlia OKONKWO,',
      '(the "Grantee"),',
      'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty and English Covenants of title,',
      'unto the said Grantee, in fee simple, as sole owner, all that parcel located in',
      'Fairfax County, Commonwealth of Virginia, to wit:',
      '   Lot TWENTY-SEVEN (27), HAWTHORNE RIDGE, as the same appears duly dedicated, platted and',
      '   recorded in Deed Book 8412 at Page 0337, among the Land Records of Fairfax County, Virginia.',
      '   BEING the same property conveyed unto Dahlia Okonkwo by Deed dated June 1, 2001, recorded in Deed Book 3000 at Page 100.',
      'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
      'Tax I.D. Number: 1184-55-0027',
    ].join('\n')),
    mat('t', 'REAL ESTATE ASSESSMENT\nParcel No: 1184-55-0027\nProperty Address: 7720 Marlowe Glen Court, Springfield, VA 22150\nTotal Assessed Value: $612,400.00'),
    mat('l', 'Entity Information\nEntity Name: Marlowe Glen Holdings LLC\nEntity ID: 11876543\nEntity Type: Limited Liability Company\nEntity Status: Active\nFormation Date: 03/18/2026\nJurisdiction: VA\nMembers: Dahlia Okonkwo\nState Corporation Commission'),
  ];
  const okIntoLlc = {
    preparedBy: 'Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC',
    titleSearch: 'Prepared without benefit of title search',
    consideration: '$0.00',
    instrumentDatePhrase: '____ day of April, 2026',
    grantors: [{ name: 'Dahlia OKONKWO', maritalStatus: 'unmarried' }],
    grantorCardinality: 'single' as const,
    propertyJurisdiction: 'County of Fairfax, Virginia',
    derivationOfTitle: 'For derivation of title, see Deed recorded in Deed Book _________, at page __________, among the aforesaid land records.',
    subjectTo: 'This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.',
    notaryJurisdiction: { commonwealth: 'COMMONWEALTH OF VIRGINIA', locality: 'CITY OF ALEXANDRIA' },
  };

  it('GOLD: persists a quitclaim-into-LLC deed; verbatim legal + the VA designator + the stamp in notes', async () => {
    mockHappyPath(MATERIALS, 'doc-llc', 'ver-llc');
    const res = await quick().generate({ matterId: M1, deedType: 'deed_into_llc', intoLlc: okIntoLlc });
    expect(res.failedClosed).toBe(false);
    expect(res.documentId).toBe('doc-llc');
    assertGold(res, ['HAWTHORNE RIDGE', '1184-55-0027', '7720 Marlowe Glen Court, Springfield, VA 22150', 'Marlowe Glen Holdings LLC, a Virginia Limited Liability Company', 'Dahlia OKONKWO'], ['QUITCLAIM, no warranty']);
    // QUITCLAIM-into-LLC invariant: the source General-Warranty/English-Covenants language must NOT bleed through.
    expect(verArg().content).not.toContain('English Covenants');
    expect(updateDocumentCurrentVersion).toHaveBeenCalledWith('doc-llc', U1, 'ver-llc');
  });

  it('NEG: a truncated legal fails closed — no document persisted, the flag surfaced', async () => {
    const truncated = MATERIALS.map((m) => (m.id === 'v' ? mat('v', m.textContent.replace('among the Land Records of Fairfax County, Virginia.', 'among the')) : m));
    mockWithheld(truncated);
    const res = await quick().generate({ matterId: M1, deedType: 'deed_into_llc', intoLlc: okIntoLlc });
    expect(res.failedClosed).toBe(true);
    expect(res.documentId).toBeNull();
    expect(res.failures.some((f) => /TRUNCATED_LEGAL_DESCRIPTION/.test(f))).toBe(true);
    expect(insertDocument).not.toHaveBeenCalled();
  });
});

// ════════════════════════════ C4 — Deed Out of an LLC ════════════════════════════
describe('quickDeed.generate — out-of-LLC dispatch (C4)', () => {
  const MATERIALS = [
    mat('v', [
      'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Maplehurst Holdings LLC,',
      '(the "Grantee"),',
      'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with Special Warranty of title,',
      'unto the said Grantee, in fee simple, all that parcel located in',
      'Loudoun County, Commonwealth of Virginia, to wit:',
      '   Lot 61, Section 3, HAWKSLEY GLEN, as the same appears duly dedicated, platted and',
      '   recorded in Deed Book 2207 at Page 0844, among the Land Records of Loudoun County, Virginia.',
      '   BEING the same property conveyed by Deed dated June 1, 2018, recorded in Deed Book 3000 at Page 100.',
      'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
      'Tax I.D. Number: 0173-19-0412',
    ].join('\n')),
    mat('t', 'REAL ESTATE ASSESSMENT\nParcel No: 0173-19-0412\nProperty Address: 8814 Larkspur Meadow Lane, Aldie, Virginia 20105\nTotal Assessed Value: $1,275,400.00'),
    mat('l', 'OPERATING AGREEMENT OF MAPLEHURST HOLDINGS LLC\nA Virginia Limited Liability Company\nARTICLE III. MEMBER; CAPITAL; OWNERSHIP INTEREST\nMembers: Desmond R. Okafor and Priya N. Venkataraman\nPercentage Interest: 50% each'),
  ];
  const okOutOfLlc = {
    fileNumber: '41-2026-7720',
    consideration: '0.00',
    executionMonth: 'July',
    executionYear: '2026',
    localityType: 'County',
    derivationInstrumentNumber: '202401090012744',
    notaryLocality: 'COUNTY OF LOUDOUN',
    returnTo: { company: 'Universal Title', line1: '3031 Fairview Park Drive', line2: 'Suite 375', cityStateZip: 'Falls Church, VA 22042', phone: '(703) 354-2100' },
  };

  it('GOLD: persists a Special-Warranty out-of-LLC deed; members default from facts; the stamp in notes', async () => {
    mockHappyPath(MATERIALS, 'doc-oll', 'ver-oll');
    const res = await quick().generate({ matterId: M1, deedType: 'deed_out_of_llc', outOfLlc: okOutOfLlc });
    expect(res.failedClosed).toBe(false);
    assertGold(res, ['HAWKSLEY GLEN', '0173-19-0412', '8814 Larkspur Meadow Lane, Aldie, Virginia 20105', 'MAPLEHURST HOLDINGS LLC', 'Desmond R. Okafor', 'Priya N. Venkataraman', 'Special Warranty'], ['member signature set + the verbatim legal are load-bearing']);
    expect(updateDocumentCurrentVersion).toHaveBeenCalledWith('doc-oll', U1, 'ver-oll');
  });

  it('NEG: a General-Warranty warrantyToken fails closed (out-of-LLC is Special Warranty only)', async () => {
    mockWithheld(MATERIALS);
    const res = await quick().generate({ matterId: M1, deedType: 'deed_out_of_llc', outOfLlc: { ...okOutOfLlc, warrantyToken: 'grant and convey, with General Warranty of title' } });
    expect(res.failedClosed).toBe(true);
    expect(res.documentId).toBeNull();
    expect(res.failures.some((f) => /WARRANTY_MISMATCH/.test(f))).toBe(true);
    expect(insertDocument).not.toHaveBeenCalled();
  });
});

// ════════════════════════════ C5 — Transfer on Death ════════════════════════════
describe('quickDeed.generate — TOD dispatch (C5)', () => {
  const MATERIALS = [
    mat('v', [
      'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Marcus T. ELLISON and',
      'Priya ELLISON, husband and wife, (the "Grantees"),',
      'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty and English Covenants of title,',
      'unto the said Grantees, in fee simple, as tenants by the entirety with the right of survivorship, all that parcel located in',
      'Prince William County, Commonwealth of Virginia, to wit:',
      '   Lot 12, Section 3, CEDAR RUN ESTATES, as the same appears duly dedicated, platted and',
      '   recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
      '   BEING the same property conveyed unto Harold V. Greer by Deed dated June 1, 2001, recorded in Deed Book 3000 at Page 100.',
      'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
      'Tax I.D. Number: 7298-44-1201',
    ].join('\n')),
    mat('t', 'REAL ESTATE ASSESSMENT\nParcel No: 7298-44-1201\nProperty Address: 4120 Cedar Run Lane, Manassas, VA 20109\nTotal Assessed Value: $588,400.00'),
  ];
  const okTod = {
    preparer: 'Mason Law Firm, PLC',
    returnTo: 'Universal Title, 1320 Old Chain Bridge Road, McLean, VA 22101',
    deedDatePhrase: 'October 2025',
    transferor: { name: 'Marcus T. ELLISON', capacity: 'surviving joint tenant' },
    primaryBeneficiaries: { persons: ['Daniel HOLLOWAY', 'Rebecca HOLLOWAY-MERCER'], vesting: 'joint tenants with the common law right of survivorship', relationship: null },
    beingRecital: 'BEING the same property conveyed unto Marcus T. Ellison by Deed recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
    acknowledgmentMonthYear: 'October 2025',
    notaryCountyBlank: true,
  };

  it('GOLD: persists a Revocable Transfer on Death Deed; beneficiaries + verbatim legal + the stamp in notes', async () => {
    mockHappyPath(MATERIALS, 'doc-tod', 'ver-tod');
    const res = await quick().generate({ matterId: M1, deedType: 'deed_tod', tod: okTod });
    expect(res.failedClosed).toBe(false);
    assertGold(res, ['REVOCABLE TRANSFER ON DEATH DEED', 'CEDAR RUN ESTATES', '7298-44-1201', '4120 Cedar Run Lane, Manassas, VA 20109', 'Daniel HOLLOWAY', 'Rebecca HOLLOWAY-MERCER', 'joint tenants with the common law right of survivorship'], ['death-effective']);
    expect(updateDocumentCurrentVersion).toHaveBeenCalledWith('doc-tod', U1, 'ver-tod');
  });

  it('NEG: no beneficiary designated fails closed — no document persisted', async () => {
    mockWithheld(MATERIALS);
    const res = await quick().generate({ matterId: M1, deedType: 'deed_tod', tod: { ...okTod, primaryBeneficiaries: { persons: [], vesting: 'sole owner', relationship: null } } });
    expect(res.failedClosed).toBe(true);
    expect(res.documentId).toBeNull();
    expect(res.failures.some((f) => /NO_BENEFICIARY_DESIGNATED/.test(f))).toBe(true);
    expect(insertDocument).not.toHaveBeenCalled();
  });
});

// ════════════════════════════ C1 — Deed of Confirmation ════════════════════════════
describe('quickDeed.generate — confirmation dispatch (C1)', () => {
  const MATERIALS = [
    mat('v', [
      'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Marcus T. ELLISON and',
      'Priya ELLISON, husband and wife, (the "Grantees"),',
      'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty and English Covenants of title,',
      'unto the said Grantees, in fee simple, as tenants by the entirety with the right of survivorship, all that parcel located in',
      'Prince William County, Commonwealth of Virginia, to wit:',
      '   Lot 12, Section 3, CEDAR RUN ESTATES, as the same appears duly dedicated, platted and',
      '   recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
      '   BEING the same property conveyed unto Harold V. Greer by Deed dated June 1, 2001, recorded in Deed Book 3000 at Page 100.',
      'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
      'Tax I.D. Number: 7298-44-1201',
    ].join('\n')),
    mat('t', 'REAL ESTATE ASSESSMENT\nParcel No: 7298-44-1201\nProperty Address: 4120 Cedar Run Lane, Manassas, VA 20109\nTotal Assessed Value: $588,400.00'),
  ];
  const okConfirmation = {
    archetype: 'C1-a-survivorship' as const,
    exemptionCode: '58.1-810(1)',
    preparer: 'Mason Law Firm, PLC',
    preparedNote: 'Prepared without the benefit of a title examination.',
    consideration: '$0.00 (confirmatory)',
    grantingDatePhrase: 'March, 2026',
    partyName: 'Marcus T. ELLISON',
    vesting: 'sole owner',
    grantingVerb: 'grant and convey',
    warranty: 'General Warranty and English Covenants of title',
    subjectTo: 'covenants, conditions, restrictions, easements and rights of way of record',
    chainSurvivorship: {
      tookTitleAs: 'joint tenants with the common law right of survivorship',
      coOwners: ['Marcus T. ELLISON', 'Priya ELLISON'],
      vestingDeedDate: 'May 2, 2019',
      vestingDeedRecorded: 'May 5, 2019',
      vestingInstrumentNumber: '201905050012345',
      recordsCounty: 'Prince William County, Virginia',
    },
    decedent: { name: 'Priya ELLISON', dateOfDeath: 'January 10, 2026' },
    beingRecitalPriorInstrument: '201905050012345',
  };

  it('GOLD: persists a Deed of Confirmation; survivorship derivation + verbatim legal + the stamp in notes', async () => {
    mockHappyPath(MATERIALS, 'doc-cnf', 'ver-cnf');
    const res = await quick().generate({ matterId: M1, deedType: 'deed_of_confirmation', confirmation: okConfirmation });
    expect(res.failedClosed).toBe(false);
    assertGold(res, ['DEED OF CONFIRMATION', 'CEDAR RUN ESTATES', '7298-44-1201', '4120 Cedar Run Lane, Manassas, VA 20109', 'Marcus T. ELLISON', 'Priya ELLISON'], ['confirms (places of record) title already vested by operation of law']);
    expect(updateDocumentCurrentVersion).toHaveBeenCalledWith('doc-cnf', U1, 'ver-cnf');
  });

  it('NEG: a parties-not-identical confirmation fails closed — no document persisted', async () => {
    mockWithheld(MATERIALS);
    const res = await quick().generate({ matterId: M1, deedType: 'deed_of_confirmation', confirmation: { ...okConfirmation, grantorGranteeSame: false } });
    expect(res.failedClosed).toBe(true);
    expect(res.documentId).toBeNull();
    expect(res.failures.some((f) => /PARTIES_NOT_IDENTICAL/.test(f))).toBe(true);
    expect(insertDocument).not.toHaveBeenCalled();
  });
});

// ════════════════════════════ C2 — Deed Into Trust ════════════════════════════
describe('quickDeed.generate — into-trust dispatch (C2)', () => {
  const MATERIALS = [
    mat('v', [
      'THIS DEED, made this 2nd day of May, 2019, by and between Quillon DEVELOPMENTS, and Rosalind A. WHITMORE and',
      'Desmond P. WHITMORE, a married couple, (the "Grantees"),',
      'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty and English',
      'Covenants of title, unto the said Grantees, in fee simple, as tenants by the entirety, all that parcel located in',
      'the County of Fairfax, Commonwealth of Virginia, to wit:',
      '   Condominium Unit No. 412, THE BELLWEATHER AT QUARRY STATION Condominium, and together with the limited common elements appurtenant thereto, including limited common element parking space(s) RPT-08, and storage space RS-31, established by condominium instruments recorded on March 2, 2009, Instrument No. 090004411 ("Declaration"), and any supplemental declarations and/or amendments recorded subsequent thereto, among the land records of the County of Fairfax, Virginia.',
      '   BEING the same property conveyed by Deed dated June 1, 2009, recorded as Instrument No. 090004555.',
      'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
      'Tax I.D. Number: 0417-09-0412',
    ].join('\n')),
    mat('t', 'REAL ESTATE ASSESSMENT\nParcel No: 0417-09-0412\nProperty Address: 2140 Quarry Court Unit 412, Reston, VA 20191\nTotal Assessed Value: $553,200.00'),
    mat('c', 'CERTIFICATE OF TRUST\nThis Certificate of Trust is executed pursuant to Va. Code § 64.2-775.\nTrust Name and Date: The Trust is known as The Whitmore Family Revocable Living Trust, established by a Trust\nAgreement dated August 14, 2021.\nCurrent Trustees: The currently acting Trustees are Rosalind A. Whitmore and Desmond P. Whitmore, serving as\nCo-Trustees.\nTrustee Powers: The Trustees have broad powers under Article IX of the Trust Agreement.'),
  ];
  const okIntoTrust = {
    exemplar: 'A' as const,
    exemptionBasis: ['58.1-811(A)(12)'],
    titleSearchPerformed: false,
    preparer: { name: 'Kelly Satterwhite, Esq.', vsb: '91049', firm: 'The Mason Law Firm, PLC' },
    consideration: '$0.00',
    instrumentDate: { day: '9th', month: 'April', year: '2026' },
    grantors: [{ full: 'Rosalind A. WHITMORE' }, { full: 'Desmond P. WHITMORE' }],
    grantorMaritalStatus: 'a married couple',
    heldAs: 'tenants_by_entirety',
    trustStructure: 'single_joint_trust',
    trusteesRecital: 'Rosalind A. WHITMORE and Desmond P. WHITMORE, Trustees of the THE WHITMORE FAMILY REVOCABLE LIVING TRUST, dated August 14, 2021',
    granteeObjectPlurality: 'GRANTEES' as const,
    grantingVerb: 'quitclaim, release and convey',
    lceIdentificationFootnote: true,
    derivation: 'For derivation of title, see Deed intended to be recorded immediately prior hereto, among the aforesaid land records.',
    tbeImmunityNote: 'Exemplar-A',
    notaryJurisdiction: { type: 'CITY' as const, name: 'ALEXANDRIA' },
  };

  it('GOLD: persists a Deed Into Trust; attorney trustees recital + verbatim condo legal + the stamp in notes', async () => {
    mockHappyPath(MATERIALS, 'doc-trt', 'ver-trt');
    const res = await quick().generate({ matterId: M1, deedType: 'deed_into_trust', intoTrust: okIntoTrust });
    expect(res.failedClosed).toBe(false);
    assertGold(res, ['THE BELLWEATHER AT QUARRY STATION', '0417-09-0412', '2140 Quarry Court Unit 412, Reston, VA 20191', '553200', 'THE WHITMORE FAMILY REVOCABLE LIVING TRUST', 'quitclaim, release and convey'], ['the trustees recital + the verbatim legal are load-bearing']);
    expect(updateDocumentCurrentVersion).toHaveBeenCalledWith('doc-trt', U1, 'ver-trt');
  });

  it('NEG: a blank trustees recital fails closed (never auto-fabricated) — no document persisted', async () => {
    mockWithheld(MATERIALS);
    const res = await quick().generate({ matterId: M1, deedType: 'deed_into_trust', intoTrust: { ...okIntoTrust, trusteesRecital: '   ' } });
    expect(res.failedClosed).toBe(true);
    expect(res.documentId).toBeNull();
    expect(res.failures.some((f) => /TRUSTEES_RECITAL_MISSING/.test(f))).toBe(true);
    expect(insertDocument).not.toHaveBeenCalled();
  });
});
