/**
 * D3-SIGNOFF A.1 Inc 3 — OBSERVE orchestration: the deterministic draft-field extractor + observeD3Comparison +
 * the NC-1-safe telemetry payload. Pure; zero egress. Extraction gaps become not_applicable + a note (never a
 * false hard-block); party comparison is deferred in OBSERVE.
 */
import { describe, it, expect } from 'vitest';
import { extractAssembledDeedFields, observeD3Comparison, buildD3ObserveTelemetry } from '../deed/d3Observe.js';

const LEGAL = 'Lot 12, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 244';
const PARCEL = '7298-44-1201';
// A minimal assembled-deed body with the standard anchors.
const DEED = [
  'THIS DEED OF GIFT is made by and between the Grantor and the Grantee.',
  'That the Grantor does hereby grant and convey, with General Warranty, unto the Grantee, in fee simple, all',
  'that certain real property located in Prince William County, Commonwealth of Virginia, to wit:',
  `   ${LEGAL}`,
  '',
  'BEING the same property conveyed unto the Grantor by prior deed.',
  `Tax I.D. Number: ${PARCEL}`,
].join('\n');

function source(over: Partial<{ legal: string | null; legalWithheld: boolean; parcel: string | null; parcelWithheld: boolean; owners: string[] }> = {}) {
  return {
    legalDescription: { value: over.legal !== undefined ? over.legal : LEGAL, withheld: over.legalWithheld ?? false, flags: [] as string[] },
    parcelId: { value: over.parcel !== undefined ? over.parcel : PARCEL, withheld: over.parcelWithheld ?? false },
    currentOwners: { values: over.owners ?? ['Marcus T. Ellison'], withheld: false },
  };
}
const status = (o: ReturnType<typeof observeD3Comparison>, f: string): string | undefined =>
  o.result.fields.find((x) => x.field === f)?.status;

describe('A.1 Inc3 — extractAssembledDeedFields', () => {
  it('extracts the legal (after "to wit:", up to the BEING recital) and the parcel (after Tax I.D.)', () => {
    const d = extractAssembledDeedFields(DEED);
    expect(d.legalDescription).toContain('CEDAR RUN ESTATES');
    expect(d.legalDescription).not.toContain('BEING'); // stopped at the recital
    expect(d.parcelId).toBe(PARCEL);
    expect(d.notes).toEqual([]);
  });
  it('notes a missing anchor instead of throwing', () => {
    const d = extractAssembledDeedFields('a deed with no anchors at all');
    expect(d.legalDescription).toBeNull();
    expect(d.parcelId).toBeNull();
    expect(d.notes.length).toBe(2);
  });
});

describe('A.1 Inc3 — observeD3Comparison', () => {
  it('a faithful deed passes (legal + parcel match; parties deferred)', () => {
    const o = observeD3Comparison({ deedText: DEED, category: 'gift', source: source(), parcelExpected: true });
    expect(o.result.tier).toBe('pass');
    expect(status(o, 'legal_description')).toBe('match');
    expect(status(o, 'parcel_id')).toBe('match');
    expect(o.partiesCompared).toBe(false);
    expect(o.result.fields.find((f) => f.field === 'grantor')).toBeUndefined(); // parties dropped in OBSERVE
  });

  it('a legal-description divergence in the deed is a hard block', () => {
    const drifted = DEED.replace('Page 244', 'Page 999');
    const o = observeD3Comparison({ deedText: drifted, category: 'gift', source: source(), parcelExpected: true });
    expect(o.result.tier).toBe('hard_block');
    expect(status(o, 'legal_description')).toBe('mismatch');
  });

  it('an EXTRACTION gap is not_applicable + a note — never a false hard-block', () => {
    const o = observeD3Comparison({ deedText: 'no anchors here', category: 'gift', source: source(), parcelExpected: true });
    expect(o.result.tier).toBe('pass'); // extraction gaps do not block
    expect(status(o, 'legal_description')).toBe('not_applicable');
    expect(o.legalExtracted).toBe(false);
    expect(o.extractionNotes.some((n) => n.includes('legal_description'))).toBe(true);
  });

  it('a withheld source legal is an overridable block', () => {
    const o = observeD3Comparison({ deedText: DEED, category: 'gift', source: source({ legal: null, legalWithheld: true }), parcelExpected: true });
    expect(o.result.tier).toBe('overridable_block');
    expect(status(o, 'legal_description')).toBe('withheld');
  });
});

describe('A.1 Inc3 — buildD3ObserveTelemetry (NC-1: statuses + flags only)', () => {
  it('produces a value-free payload with wouldBlock + per-field statuses', () => {
    const drifted = DEED.replace('Page 244', 'Page 999');
    const o = observeD3Comparison({ deedText: drifted, category: 'gift', source: source(), parcelExpected: true });
    const payload = buildD3ObserveTelemetry(o, { documentVersionId: 'v-1', gateMode: 'observe' });
    expect(payload.wouldBlock).toBe(true);
    expect(payload.tier).toBe('hard_block');
    expect(payload.legalStatus).toBe('mismatch');
    expect(payload.partiesCompared).toBe(false);
    const s = JSON.stringify(payload);
    expect(s).not.toContain('CEDAR RUN'); // NC-1: no legal text
    expect(s).not.toContain(PARCEL); // NC-1: no parcel value
  });
});
