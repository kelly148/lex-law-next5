/**
 * FOLD-DEED-1 — the verified VA per-locality recordability KB seed.
 *
 * Covers the locality KB (transcribed from the verified locality+RON source, Part C; cover sheets EXCLUDED):
 * the five localities present + deed-instrument-recordable, the standout on-deed quirks, the [UNVERIFIED]
 * advisories carried (never blocking), and the resolver wiring (a verified locality + known VA sub-type
 * clears localityVerified + templateCoverage; an unseeded locality / non-VA / unknown sub-type stays
 * fail-closed). Pure + DB-free. Also guards the scope exclusion: no cover-sheet rule is seeded.
 */
import { describe, it, expect } from 'vitest';
import { VA_LOCALITIES, getVaLocality, isVaDeedInstrumentRecordableLocality } from '../deed/deedKbLocalitiesVa.js';
import { resolveDeedKbAvailability } from '../deed/deedKb.js';

describe('FOLD-DEED-1 — verified per-locality KB content', () => {
  it('seeds the five v1 localities, each deed-instrument recordable, each with a source cite', () => {
    expect(VA_LOCALITIES.map((l) => l.name)).toEqual(['Fairfax County', 'City of Alexandria', 'Arlington County', 'Loudoun County', 'Prince William County']);
    for (const l of VA_LOCALITIES) {
      expect(l.deedInstrumentRecordable).toBe(true);
      expect(l.source.length).toBeGreaterThan(0);
    }
  });

  it('carries the standout VERIFIED on-deed quirks', () => {
    expect(getVaLocality('Arlington County')!.firstPageRules.join(' ')).toMatch(/preparer.*phone/i);
    expect(getVaLocality('Loudoun County')!.parcelId.format).toMatch(/GPIN, 12-digit/);
    expect(getVaLocality('Prince William County')!.parcelId.format).toMatch(/Grid/);
    expect(getVaLocality('Fairfax County')!.firstPageRules.join(' ')).toMatch(/LEFT MARGIN/i);
    // PWC's GPIN lifecycle drafting risk is carried as a quirk
    expect(getVaLocality('Prince William County')!.quirks.join(' ')).toMatch(/GPIN lifecycle/i);
  });

  it('carries [UNVERIFIED]-derived items as advisories (never as verified prongs)', () => {
    // Alexandria's exact on-deed parcel-ID format is unverified → parcelId.verified false + an advisory
    expect(getVaLocality('City of Alexandria')!.parcelId.verified).toBe(false);
    expect(getVaLocality('City of Alexandria')!.advisories.join(' ')).toMatch(/parcel-ID/i);
  });

  it('does NOT seed any cover-sheet rule (cover sheets are out of scope — post-closing)', () => {
    // No first-page RULE mentions a cover-sheet requirement (only Arlington's "not required since 2016" note,
    // which is reference, lives under quirks — never a gating first-page rule).
    for (const l of VA_LOCALITIES) {
      expect(l.firstPageRules.join(' ').toLowerCase()).not.toContain('cover sheet');
    }
  });

  it('isVaDeedInstrumentRecordableLocality: true for the five, false for an unseeded locality', () => {
    for (const l of VA_LOCALITIES) expect(isVaDeedInstrumentRecordableLocality(l.name)).toBe(true);
    expect(isVaDeedInstrumentRecordableLocality('Richmond')).toBe(false);
    expect(isVaDeedInstrumentRecordableLocality(null)).toBe(false);
  });
});

describe('FOLD-DEED-1 — resolver with the locality seed', () => {
  it('a verified VA locality + a known VA deed sub-type clears localityVerified + templateCoverage', () => {
    const r = resolveDeedKbAvailability({ jurisdiction: 'VA', locality: 'Loudoun County', deedType: 'deed', deedSubType: 'gift' });
    expect(r.localityVerified).toBe(true);
    expect(r.templateCoverage).toBe(true);
  });

  it('an unseeded locality / non-VA / unknown sub-type stays fail-closed', () => {
    expect(resolveDeedKbAvailability({ jurisdiction: 'VA', locality: 'Richmond', deedType: 'deed', deedSubType: 'gift' }).localityVerified).toBe(false);
    expect(resolveDeedKbAvailability({ jurisdiction: 'MD', locality: 'Fairfax County', deedType: 'deed', deedSubType: 'gift' }).localityVerified).toBe(false);
    expect(resolveDeedKbAvailability({ jurisdiction: 'VA', locality: 'Fairfax County', deedType: 'deed', deedSubType: 'not_a_real_type' }).templateCoverage).toBe(false);
    expect(resolveDeedKbAvailability({ jurisdiction: 'VA', locality: null, deedType: 'deed', deedSubType: 'gift' }).localityVerified).toBe(false);
  });
});
