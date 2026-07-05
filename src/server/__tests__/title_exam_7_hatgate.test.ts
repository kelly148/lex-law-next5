/**
 * TITLE-EXAM-1 (T7) — dual-hat entity gate + knowledge scoping (NC-5, PB-1). Pure. Builds the gate; loads no
 * FATIC content.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveHat,
  resolveFaticAvailability,
  accessibleKnowledgeLanes,
  isKnowledgeLaneAccessible,
  canSeedAcrossHats,
  resolveTemplateFamily,
  resolveDisclaimerSet,
  isAdvicePermitted,
  resolveHatProfile,
} from '../titleExam/hatGate.js';

describe('T7 — resolveHat (only an affirmative title election is the Universal Title hat)', () => {
  it('title_settlement_agent → universal_title; everything else → the conservative law-firm hat', () => {
    expect(resolveHat('title_settlement_agent')).toBe('universal_title');
    expect(resolveHat('law_firm')).toBe('satterwhite_law_firm');
    expect(resolveHat(null)).toBe('satterwhite_law_firm');
    expect(resolveHat(undefined)).toBe('satterwhite_law_firm');
    expect(resolveHat('something_unknown')).toBe('satterwhite_law_firm');
  });
});

describe('T7 — FATIC availability (PB-1 RESOLVED 2026-07-05: available for BOTH hats at Stage-1)', () => {
  it('both hats have FATIC at Stage-1 (the interim UT-only gate is lifted); law-firm reason carries the Stage-2 caveat', () => {
    expect(resolveFaticAvailability('universal_title').available).toBe(true);
    expect(resolveFaticAvailability('satterwhite_law_firm').available).toBe(true);
    expect(resolveFaticAvailability('satterwhite_law_firm').reason).toContain('Stage-2');
    expect(resolveFaticAvailability('satterwhite_law_firm', true).available).toBe(true);
  });
});

describe('T7 — hat-scoped knowledge lanes (NC-5; cross-hat default NO)', () => {
  it('each hat sees its own matter lane + public authority + cross-hat-approved, never the other hat’s matter lane', () => {
    const ut = accessibleKnowledgeLanes('universal_title');
    expect(ut).toContain('ut_matter');
    expect(ut).toContain('underwriter_derived'); // title seat
    expect(ut).not.toContain('firm_matter');

    const firm = accessibleKnowledgeLanes('satterwhite_law_firm');
    expect(firm).toContain('firm_matter');
    expect(firm).not.toContain('ut_matter');
    expect(firm).not.toContain('underwriter_derived');

    for (const hat of ['universal_title', 'satterwhite_law_firm'] as const) {
      expect(isKnowledgeLaneAccessible(hat, 'public_authority')).toBe(true);
      expect(isKnowledgeLaneAccessible(hat, 'cross_hat_approved')).toBe(true);
    }
  });

  it('cross-hat seeding defaults NO in both directions; only an affirmative promotion allows it', () => {
    expect(canSeedAcrossHats('universal_title', 'satterwhite_law_firm')).toBe(false);
    expect(canSeedAcrossHats('satterwhite_law_firm', 'universal_title')).toBe(false);
    expect(canSeedAcrossHats('universal_title', 'satterwhite_law_firm', true)).toBe(true);
    expect(canSeedAcrossHats('universal_title', 'universal_title')).toBe(true); // same hat, not a cross-hat seed
  });
});

describe('T7 — template family / disclaimer set / advice posture per hat (NC-5)', () => {
  it('title hat frames requirements (no party advice); law-firm hat may advise', () => {
    expect(resolveTemplateFamily('universal_title')).toBe('title_underwriting');
    expect(resolveTemplateFamily('satterwhite_law_firm')).toBe('law_firm');
    expect(isAdvicePermitted('universal_title')).toBe(false);
    expect(isAdvicePermitted('satterwhite_law_firm')).toBe(true);
    expect(resolveDisclaimerSet('universal_title').join(' ')).toContain('not your attorney');
    expect(resolveDisclaimerSet('satterwhite_law_firm').join(' ')).toContain('engagement');
  });

  it('resolveHatProfile ties it together for a title matter', () => {
    const p = resolveHatProfile('title_settlement_agent');
    expect(p.hat).toBe('universal_title');
    expect(p.fatic.available).toBe(true);
    expect(p.templateFamily).toBe('title_underwriting');
    expect(p.advicePermitted).toBe(false);
    // a law-firm matter, no paper: FATIC unavailable
    expect(resolveHatProfile('law_firm').fatic.available).toBe(true); // PB-1 resolved (both hats, Stage-1)
  });
});
