/**
 * FOLD-DEED-1 — RON / e-recording seed (Increment "Locality + RON", Part B).
 *
 * Three guarantees:
 *   1. CONTENT — the verified RON KB carries the source-of-truth statutory citations VERBATIM (authority,
 *      the two acknowledgment-form templates as STRUCTURAL blanks, the § 47.1-16 e-certificate recitals,
 *      URPERA equivalence, the e-recording submitters), and the [UNVERIFIED] items (VITA SEC505,
 *      Indecomm/Kofile) are carried as ADVISORIES — never hard-encoded as blockers.
 *   2. WIRING — isVaLocalityERecording / resolveDeedKbAvailability surface "does this locality operate an
 *      eRecording System" ONLY from the verified locality KB (never model memory).
 *   3. FAIL-CLOSED GATING — a RON / e-notary deed clears recordability ONLY with operating e-recording AND
 *      the § 47.1-16 e-certificate recitals affirmed (URPERA parity with paper). DB-free; pure modules.
 */
import { describe, it, expect } from 'vitest';
import {
  RON_PROVENANCE,
  RON_AUTHORITY,
  ACKNOWLEDGMENT_FORMS,
  ACKNOWLEDGMENT_CONTENT,
  E_CERTIFICATE_RECITALS,
  URPERA_EQUIVALENCE,
  E_RECORDING_SUBMITTERS,
  RON_ADVISORIES,
} from '../deed/deedKbRonVa.js';
import { isVaLocalityERecording, VA_LOCALITIES } from '../deed/deedKbLocalitiesVa.js';
import { resolveDeedKbAvailability } from '../deed/deedKb.js';
import {
  evaluateDeedGate,
  DeedGateStateSchema,
  type DeedGateState,
  type DeedKbAvailability,
} from '../../shared/schemas/deedGate.js';

// ── 1. CONTENT — verified statutory transcription ─────────────────────────────
describe('FOLD-DEED-1 RON — verified KB content (model is never the source)', () => {
  it('provenance pins the committed verified source + VA', () => {
    expect(RON_PROVENANCE.source).toBe('docs/VA_Deed_Locality_and_RON_Source_VERIFIED_2026-06-19.docx');
    expect(RON_PROVENANCE.jurisdiction).toBe('VA');
  });

  it('RON authority carries the Title 47.1 citations (§§ 47.1-13(D) / 7 / 6.1 / 2 / 12)', () => {
    const cites = RON_AUTHORITY.map((a) => a.citation);
    for (const c of ['Va. Code § 47.1-13(D)', 'Va. Code § 47.1-7', 'Va. Code § 47.1-6.1', 'Va. Code § 47.1-2', 'Va. Code § 47.1-12']) {
      expect(cites).toContain(c);
    }
  });

  it('the two acknowledgment forms are STRUCTURAL templates with blanks — notary specifics never auto-filled', () => {
    const long = ACKNOWLEDGMENT_FORMS.find((f) => f.key === 'long_form');
    const short = ACKNOWLEDGMENT_FORMS.find((f) => f.key === 'short_form');
    expect(long?.citation).toBe('Va. Code § 55.1-612(1)');
    expect(short?.citation).toBe('Va. Code § 55.1-619(3)');
    // Every form is a blank-bearing template (____), so the system supplies STRUCTURE, never the notary's specifics.
    for (const f of ACKNOWLEDGMENT_FORMS) expect(f.template).toContain('____');
    expect(ACKNOWLEDGMENT_CONTENT.citation).toBe('Va. Code § 55.1-618');
  });

  it('the § 47.1-16 e-certificate recitals carry the three required elements (incl. the tamper-evident e-seal, no image)', () => {
    expect(E_CERTIFICATE_RECITALS.citation).toBe('Va. Code § 47.1-16');
    expect(E_CERTIFICATE_RECITALS.requirements).toHaveLength(3);
    const blob = E_CERTIFICATE_RECITALS.requirements.join(' ').toLowerCase();
    expect(blob).toContain('virginia'); // notary's VA location at the time of the act
    expect(blob).toContain('remote online notarization');
    expect(blob).toMatch(/tamper-evident/);
    expect(E_CERTIFICATE_RECITALS.requirements.join(' ')).toContain('55.1-662(C)'); // no seal image required
  });

  it('URPERA equivalence (§§ 55.1-662–664) makes a RON deed recordable on the same footing as paper', () => {
    const cites = URPERA_EQUIVALENCE.map((u) => u.citation);
    for (const c of ['Va. Code § 55.1-662(A)', 'Va. Code § 55.1-662(B)', 'Va. Code § 55.1-662(C)', 'Va. Code § 55.1-663', 'Va. Code § 55.1-664']) {
      expect(cites).toContain(c);
    }
  });

  it('e-recording submitters are the [VERIFIED] portals; [UNVERIFIED] items are advisories, not blockers', () => {
    expect(E_RECORDING_SUBMITTERS).toEqual(expect.arrayContaining(['Simplifile']));
    expect(E_RECORDING_SUBMITTERS.some((s) => s.startsWith('CSC'))).toBe(true);
    expect(E_RECORDING_SUBMITTERS.some((s) => s.startsWith('ePN'))).toBe(true);
    const adv = RON_ADVISORIES.join(' ');
    expect(adv).toMatch(/SEC505/); // the VITA format standard stays UNVERIFIED → advisory
    expect(adv).toMatch(/UNVERIFIED/);
    expect(adv).toMatch(/Indecomm/); // not confirmed as a VA portal → not seeded
    expect(adv).toMatch(/Kofile/);
  });
});

// ── 2. WIRING — e-recording availability comes ONLY from the verified locality KB ─────
describe('FOLD-DEED-1 RON — locality e-recording wiring (fail-closed)', () => {
  it('all five seeded localities operate a verified eRecording System; an unseeded locality does not', () => {
    for (const l of VA_LOCALITIES) expect(isVaLocalityERecording(l.name)).toBe(true);
    expect(isVaLocalityERecording('Richmond')).toBe(false);
    expect(isVaLocalityERecording(null)).toBe(false);
  });

  it('resolveDeedKbAvailability surfaces localityERecording only for a VA + verified locality', () => {
    expect(resolveDeedKbAvailability({ jurisdiction: 'VA', locality: 'Fairfax County', deedType: 'deed', deedSubType: 'gift' }).localityERecording).toBe(true);
    expect(resolveDeedKbAvailability({ jurisdiction: 'VA', locality: 'Richmond', deedType: 'deed', deedSubType: 'gift' }).localityERecording).toBe(false);
    expect(resolveDeedKbAvailability({ jurisdiction: 'MD', locality: 'Fairfax County', deedType: 'deed', deedSubType: 'gift' }).localityERecording).toBe(false);
  });
});

// ── 3. FAIL-CLOSED GATING — RON recordability needs e-recording AND the § 47.1-16 recitals ─────
describe('FOLD-DEED-1 RON — recordability is fail-closed for an e-notary / RON mode', () => {
  const FULL_KB: DeedKbAvailability = { templateCoverage: true, vestingListValidated: true, localityVerified: true, localityERecording: true };
  const PARTIES = { grantorCount: 1, granteeCount: 1 };
  function fullState(over: Partial<DeedGateState> = {}): DeedGateState {
    return DeedGateStateSchema.parse({
      sourceOfRecordInstrument: 'Deed Book 1234, Page 56',
      recordingLocality: 'Fairfax County',
      deedSubType: 'bargain_and_sale',
      descriptionSourceMatch: true,
      descriptionParcelScope: 'whole',
      descriptionProvenance: 'Deed Book 1234, Page 56; Plat Book 7, Page 12',
      descriptionNotOcrOnly: true,
      descriptionHasPlatOrSubdivisionRef: true,
      descriptionConfirmedAt: '2026-06-19T12:00:00Z',
      vestingSelection: 'tenants by the entirety with right of survivorship',
      maritalStatusConfirmed: true,
      spousalJoinder: 'present',
      grantorReconciledToSource: true,
      fiduciaryAuthority: 'not_applicable',
      specialInstrumentTriggersReviewed: true,
      preparerReturnGranteeAddress: true,
      ...over,
    });
  }

  it('RON without the § 47.1-16 recitals affirmed is BLOCKED even with full KB', () => {
    const r = evaluateDeedGate({ state: fullState({ executionMode: 'ron', eCertificateRecitalsAffirmed: null }), kb: FULL_KB, parties: PARTIES });
    expect(r.recordable).toBe(false);
    expect(r.recordability.blockingReasons).toContain('e_certificate_recitals_unaffirmed');
  });

  it('RON in a locality without operating e-recording is BLOCKED even with the recitals affirmed', () => {
    const noER: DeedKbAvailability = { ...FULL_KB, localityERecording: false };
    const r = evaluateDeedGate({ state: fullState({ executionMode: 'ron', eCertificateRecitalsAffirmed: true }), kb: noER, parties: PARTIES });
    expect(r.recordable).toBe(false);
    expect(r.recordability.blockingReasons).toContain('locality_e_recording_unavailable');
  });

  it('RON with operating e-recording AND the recitals affirmed is recordable (URPERA parity)', () => {
    const r = evaluateDeedGate({ state: fullState({ executionMode: 'ron', eCertificateRecitalsAffirmed: true }), kb: FULL_KB, parties: PARTIES });
    expect(r.recordable).toBe(true);
  });

  it('a wet-sign deed needs neither e-recording nor the e-certificate recitals', () => {
    const r = evaluateDeedGate({ state: fullState({ executionMode: 'wet_sign' }), kb: FULL_KB, parties: PARTIES });
    expect(r.recordability.passed).toBe(true);
  });
});
