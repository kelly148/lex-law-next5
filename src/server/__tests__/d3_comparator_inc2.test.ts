/**
 * D3-SIGNOFF A.1 Inc 2 — the deterministic comparator. Synthetic fixtures across the NC-D3-3 three tiers +
 * NC-D3-5 role-mapping + NC-D3-4 normalization + determinism + the NC-1 no-text-leak guard. Pure; zero egress.
 * (The real-OCR corpus of recorded instruments — metes-and-bounds, "thence" continuations, condo units,
 * hyphenation/line-wrap — is PII and lives in the sandbox; it is a documented follow-up test artifact.)
 */
import { describe, it, expect } from 'vitest';
import { compareD3Signoff, normalizeForD3Comparison, type D3ComparatorInput } from '../deed/d3Comparator.js';

const LEGAL = 'Lot 12, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 244';

function baseInput(): D3ComparatorInput {
  return {
    category: 'gift',
    draft: { legalDescription: LEGAL, grantors: ['Marcus T. Ellison', 'Priya Ellison'], grantees: ['Hannah R. Ellison'], parcelId: '7298-44-1201', parcelExpected: true },
    source: {
      legalDescription: { value: LEGAL, withheld: false, provenanceClass: 'extraction_verbatim' },
      currentOwners: { values: ['Marcus T. Ellison', 'Priya Ellison'], withheld: false, provenanceClass: 'extraction_verbatim' },
      parcelId: { value: '7298-44-1201', withheld: false, provenanceClass: 'extraction_verbatim' },
    },
  };
}
const fieldStatus = (r: ReturnType<typeof compareD3Signoff>, f: string): string | undefined =>
  r.fields.find((x) => x.field === f)?.status;

describe('A.1 Inc2 — pass: every present operative value matches', () => {
  it('all fields match; tier pass', () => {
    const r = compareD3Signoff(baseInput());
    expect(r.tier).toBe('pass');
    expect(fieldStatus(r, 'legal_description')).toBe('match');
    expect(fieldStatus(r, 'grantor')).toBe('match');
    expect(fieldStatus(r, 'grantee')).toBe('not_applicable'); // NC-D3-5: no source equivalent
    expect(fieldStatus(r, 'parcel_id')).toBe('match');
    expect(r.reasons).toEqual([]);
  });

  it('NC-D3-4 normalization: line-wrap/whitespace reflow still matches', () => {
    const i = baseInput();
    i.draft.legalDescription = 'Lot 12,\n  Section 3,   CEDAR RUN ESTATES,\nrecorded in Deed Book 6011 at Page 244';
    expect(normalizeForD3Comparison(i.draft.legalDescription)).toBe(normalizeForD3Comparison(LEGAL));
    expect(compareD3Signoff(i).tier).toBe('pass');
  });
});

describe('A.1 Inc2 — hard_block on a present-vs-present MISMATCH (non-overridable, NC-D3-3)', () => {
  it('legal-description mismatch is a hard block (the non-overridable core)', () => {
    const i = baseInput();
    i.draft.legalDescription = 'Lot 12, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 999'; // page changed
    const r = compareD3Signoff(i);
    expect(r.tier).toBe('hard_block');
    expect(fieldStatus(r, 'legal_description')).toBe('mismatch');
  });
  it('parcel mismatch is a hard block', () => {
    const i = baseInput();
    i.draft.parcelId = '0000-00-0000';
    expect(compareD3Signoff(i).tier).toBe('hard_block');
  });
  it('grantor set mismatch (role-mapped) is a hard block', () => {
    const i = baseInput();
    i.source.currentOwners.values = ['Someone Else'];
    const r = compareD3Signoff(i);
    expect(r.tier).toBe('hard_block');
    expect(fieldStatus(r, 'grantor')).toBe('mismatch');
  });
  it('a missing DRAFT legal is a hard block', () => {
    const i = baseInput();
    i.draft.legalDescription = '   ';
    expect(compareD3Signoff(i).tier).toBe('hard_block');
  });
});

describe('A.1 Inc2 — overridable_block on a genuinely absent/withheld SOURCE value (NC-D3-3)', () => {
  it('source legal withheld -> overridable', () => {
    const i = baseInput();
    i.source.legalDescription = { value: null, withheld: true, provenanceClass: 'withheld' };
    const r = compareD3Signoff(i);
    expect(r.tier).toBe('overridable_block');
    expect(fieldStatus(r, 'legal_description')).toBe('withheld');
  });
  it('source parcel absent -> overridable', () => {
    const i = baseInput();
    i.source.parcelId = { value: null, withheld: false, provenanceClass: 'extraction_verbatim' };
    const r = compareD3Signoff(i);
    expect(r.tier).toBe('overridable_block');
    expect(fieldStatus(r, 'parcel_id')).toBe('absent');
  });
  it('no parcel expected -> not_applicable (does not block)', () => {
    const i = baseInput();
    i.draft.parcelExpected = false;
    i.draft.parcelId = null;
    const r = compareD3Signoff(i);
    expect(r.tier).toBe('pass');
    expect(fieldStatus(r, 'parcel_id')).toBe('not_applicable');
  });
});

describe('A.1 Inc2 — determinism + NC-1 (no operative text ever leaks into the result)', () => {
  it('same input -> byte-identical result', () => {
    expect(compareD3Signoff(baseInput())).toEqual(compareD3Signoff(baseInput()));
  });
  it('the result carries HASHES + statuses + value-free reasons — never the compared text (NC-1)', () => {
    const i = baseInput();
    i.draft.legalDescription = 'Lot 12, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 999';
    const serialized = JSON.stringify(compareD3Signoff(i));
    expect(serialized).not.toContain('CEDAR RUN'); // no legal-description text
    expect(serialized).not.toContain('Ellison'); // no party names
    expect(serialized).not.toContain('7298-44-1201'); // no parcel value
    // hashes ARE present.
    expect(serialized).toMatch(/[0-9a-f]{64}/);
  });
});
