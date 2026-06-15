/**
 * FOLD-PM-2 — document-type extraction engine unit tests (PURE, no DB, no egress).
 *
 * Fixture text in -> classified type + structured fields + confidence out. Also
 * exercises the honesty floor (heuristic-only fields withheld) and the unknown/empty
 * paths (never throws; returns documentType 'unknown' with lowConfidence).
 */

import { describe, it, expect } from 'vitest';
import {
  classifyDocumentType,
  extractStructuredDocument,
} from '../intake/documentTypeParsers.js';

function field(r: ReturnType<typeof extractStructuredDocument>, key: string) {
  return r.fields.find((f) => f.key === key);
}

const COMMITMENT = `
COMMITMENT FOR TITLE INSURANCE
Issued by Acme Title Insurance Company

Commitment No.: AC-2026-00417
Effective Date: March 12, 2026
Proposed Insured: John Q. Buyer and Jane R. Buyer
Policy Amount: $450,000.00

SCHEDULE B
Requirements to be met:
1. Pay the agreed consideration.

Legal Description: Lot 7, Block 3, Maplewood Subdivision, per plat recorded in Book 12, Page 88.
`;

const DEED = `
SPECIAL WARRANTY DEED

THIS DEED made this 1st day of April, 2026.
Grantor: Alpha Holdings, LLC, a Virginia limited liability company
Grantee: Beta Acquisitions, Inc.
Consideration: $1,250,000.00
does hereby grant, bargain and sell unto the Grantee the following described property.
Recorded as Instrument No.: 20260401-0099123
Tax Map / Parcel ID: 045-12-0033
`;

const SURVEY = `
PLAT OF SURVEY / BOUNDARY SURVEY

Surveyor: Lee & Associates Professional Land Surveyors
Date of Survey: 02/15/2026
Containing 2.347 acres more or less.
POINT OF BEGINNING; thence North 12 degrees East...
Surveyor's Certificate: I hereby certify this survey was performed under my direction.
Plat Book 44, Page 17.
`;

const SETTLEMENT = `
ALTA SETTLEMENT STATEMENT
Closing Disclosure

Borrower: John Q. Buyer
Seller: Alpha Holdings, LLC
Contract Sales Price: $450,000.00
New Loan: $360,000.00
Disbursement Date: April 3, 2026
Total Settlement Charges: $12,430.55
Cash to Close from Borrower: $98,210.11
`;

describe('FOLD-PM-2 engine — classification', () => {
  it('classifies each of the four document types with above-floor confidence', () => {
    expect(classifyDocumentType(COMMITMENT).type).toBe('title_commitment');
    expect(classifyDocumentType(DEED).type).toBe('deed');
    expect(classifyDocumentType(SURVEY).type).toBe('survey');
    expect(classifyDocumentType(SETTLEMENT).type).toBe('settlement_statement');
    expect(classifyDocumentType(COMMITMENT).confidence).toBeGreaterThanOrEqual(60);
  });

  it('returns unknown for unrelated or empty text (never throws)', () => {
    expect(classifyDocumentType('Dear client, attached is my engagement letter.').type).toBe('unknown');
    expect(classifyDocumentType('').type).toBe('unknown');
    expect(classifyDocumentType('').confidence).toBe(0);
    expect(extractStructuredDocument('').documentType).toBe('unknown');
    expect(extractStructuredDocument('').lowConfidence).toBe(true);
  });
});

describe('FOLD-PM-2 engine — title commitment fields', () => {
  it('extracts the labeled commitment fields', () => {
    const r = extractStructuredDocument(COMMITMENT);
    expect(r.documentType).toBe('title_commitment');
    expect(field(r, 'commitmentNumber')?.value).toBe('AC-2026-00417');
    expect(field(r, 'effectiveDate')?.value).toContain('March 12, 2026');
    expect(field(r, 'proposedInsured')?.value).toContain('John Q. Buyer');
    expect(field(r, 'policyAmount')?.value).toContain('450,000');
    expect(field(r, 'legalDescription')?.value).toContain('Lot 7');
    expect(r.overallConfidence).toBeGreaterThanOrEqual(60);
    expect(r.lowConfidence).toBe(false);
  });
});

describe('FOLD-PM-2 engine — deed fields', () => {
  it('extracts grantor/grantee/consideration/recording/parcel', () => {
    const r = extractStructuredDocument(DEED);
    expect(r.documentType).toBe('deed');
    expect(field(r, 'grantor')?.value).toContain('Alpha Holdings');
    expect(field(r, 'grantee')?.value).toContain('Beta Acquisitions');
    expect(field(r, 'consideration')?.value).toContain('1,250,000');
    expect(field(r, 'recordingReference')?.value).toContain('20260401-0099123');
    expect(field(r, 'parcelId')?.value).toBe('045-12-0033');
  });
});

describe('FOLD-PM-2 engine — survey fields', () => {
  it('extracts surveyor/date/area/plat', () => {
    const r = extractStructuredDocument(SURVEY);
    expect(r.documentType).toBe('survey');
    expect(field(r, 'surveyor')?.value).toContain('Lee & Associates');
    expect(field(r, 'surveyDate')?.value).toContain('02/15/2026');
    expect(field(r, 'area')?.value).toContain('2.347');
    // Regression: the bare "Plat Book 44, Page 17" form must be captured (the strict capture group
    // must live in BOTH alternatives, not only the "recorded as/in" one).
    expect(field(r, 'platReference')?.value).toContain('Plat Book 44');
  });
});

describe('FOLD-PM-2 engine — settlement statement fields', () => {
  it('extracts parties/amounts/dates', () => {
    const r = extractStructuredDocument(SETTLEMENT);
    expect(r.documentType).toBe('settlement_statement');
    expect(field(r, 'borrower')?.value).toContain('John Q. Buyer');
    expect(field(r, 'seller')?.value).toContain('Alpha Holdings');
    expect(field(r, 'salePrice')?.value).toContain('450,000');
    expect(field(r, 'loanAmount')?.value).toContain('360,000');
    expect(field(r, 'closingDate')?.value).toContain('April 3, 2026');
    expect(field(r, 'cashToClose')?.value).toContain('98,210.11');
  });
});

describe('FOLD-PM-2 engine — honesty floor', () => {
  it('withholds a value detected only by a weak heuristic (value null, withheld=true, listed)', () => {
    // A deed-classified doc whose legal description is present only as a bare Lot/Block string
    // (the title-commitment legalDescription loose pattern). Build a title doc with NO labeled
    // "Legal Description:" but a bare Lot/Block line.
    const text = `COMMITMENT FOR TITLE INSURANCE\nSCHEDULE B\nCommitment No.: X1\nThe land: Lot 9 and Block 2 of the Highlands.`;
    const r = extractStructuredDocument(text);
    expect(r.documentType).toBe('title_commitment');
    const legal = field(r, 'legalDescription');
    expect(legal?.withheld).toBe(true);
    expect(legal?.value).toBeNull();
    expect(legal?.confidence).toBeLessThan(60);
    expect(r.warnings.some((w) => w.startsWith('fields_withheld_low_confidence'))).toBe(true);
  });

  it('flags low overall confidence when no fields are extracted', () => {
    const text = 'WARRANTY DEED. This indenture witnesseth.'; // classifies deed, but no labeled fields
    const r = extractStructuredDocument(text);
    expect(r.documentType).toBe('deed');
    expect(r.fields.every((f) => f.value === null)).toBe(true);
    expect(r.warnings).toContain('no_fields_extracted');
    expect(r.lowConfidence).toBe(true);
  });
});
