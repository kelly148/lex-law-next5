/**
 * FOLD-DEED-1 Inc 2 — the verified VA state-level KB seed.
 *
 * Covers: the KB content transcribed from the primer (deed types, vesting controlled-list, exemption table,
 * provenance, the five UNverified localities), the KB lookups + the resolver (vesting validates ONLY against
 * the controlled list — never arbitrary/model-invented text; locality stays fail-closed), and the
 * deedGate.referenceKb allowlist procedure. Pure + DB-free.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  VA_DEED_TYPES,
  VA_VESTING_OPTIONS,
  VA_EXEMPTIONS,
  DEED_KB_PROVENANCE,
  isVaVestingValidated,
  isVaDeedTypeKnown,
} from '../deed/deedKbVa.js';
import { resolveDeedKbAvailability } from '../deed/deedKb.js';
import { appRouter } from '../router.js';

describe('FOLD-DEED-1 Inc 2 — verified VA KB content (transcribed from the primer)', () => {
  it('seeds the six VA deed types with verified citations/granting language', () => {
    expect(VA_DEED_TYPES.map((t) => t.key)).toEqual(['bargain_and_sale', 'gift', 'into_trust', 'confirmation', 'transfer_on_death', 'distribution']);
    const gift = VA_DEED_TYPES.find((t) => t.key === 'gift')!;
    expect(gift.exemptionCitation).toBe('Va. Code § 58.1-811(D)');
    expect(gift.grantingLanguage).toBe('grant and convey'); // NOT "grant, bargain, sell, and convey" (P.D. 93-212)
    expect(gift.mustStateTitleInDeed).toBe(true);
    expect(VA_DEED_TYPES.find((t) => t.key === 'transfer_on_death')!.notes).toMatch(/RECORDED BEFORE/i); // § 64.2-625
    expect(VA_DEED_TYPES.find((t) => t.key === 'bargain_and_sale')!.exemptionCitation).toBeNull(); // taxable
  });

  it('provenance points at the committed primer + flags the state-level tier', () => {
    expect(DEED_KB_PROVENANCE.source).toBe('docs/Deed_Drafting_Training_Guide_Virginia.docx');
    expect(DEED_KB_PROVENANCE.tier).toBe('state');
    expect(DEED_KB_PROVENANCE.jurisdiction).toBe('VA');
  });

  it('the vesting controlled-list carries the canonical survivorship language', () => {
    const langs = VA_VESTING_OPTIONS.map((o) => o.language);
    expect(langs).toContain('as joint tenants with right of survivorship and not as tenants in common');
    expect(langs).toContain('as tenants by the entirety with the common-law right of survivorship');
  });

  it('the exemption table carries the verified § citations', () => {
    const cits = VA_EXEMPTIONS.map((e) => e.citation);
    expect(cits).toEqual(expect.arrayContaining(['Va. Code § 58.1-811(D)', 'Va. Code § 58.1-811(A)(12)', 'Va. Code § 58.1-810(1)', 'Va. Code § 58.1-811(J)', 'Va. Code § 58.1-811(K)']));
  });

});

describe('FOLD-DEED-1 Inc 2 — KB lookups + resolver (the verified allowlist; never model memory)', () => {
  it('isVaVestingValidated accepts the controlled-list language, rejects fabricated/arbitrary vesting', () => {
    expect(isVaVestingValidated('as joint tenants with right of survivorship and not as tenants in common')).toBe(true);
    expect(isVaVestingValidated('as tenants by the entirety with the common-law right of survivorship')).toBe(true);
    expect(isVaVestingValidated('jtwros')).toBe(true); // by key
    expect(isVaVestingValidated('to Alice and Bob, jointly')).toBe(false); // the §55.1-134 trap — NOT survivorship
    expect(isVaVestingValidated('some vesting the model invented')).toBe(false);
    expect(isVaVestingValidated(null)).toBe(false);
  });

  it('isVaDeedTypeKnown matches the controlled list by key or title', () => {
    expect(isVaDeedTypeKnown('gift')).toBe(true);
    expect(isVaDeedTypeKnown('Deed of Gift')).toBe(true);
    expect(isVaDeedTypeKnown('quitclaim')).toBe(false);
  });

  it('resolver: VA vesting validates against the controlled list; arbitrary vesting / MD do not', () => {
    expect(resolveDeedKbAvailability({ jurisdiction: 'VA', locality: 'Fairfax County', deedType: 'deed', vestingSelection: 'as tenants by the entirety with the common-law right of survivorship' }).vestingListValidated).toBe(true);
    expect(resolveDeedKbAvailability({ jurisdiction: 'VA', locality: null, deedType: 'deed', vestingSelection: 'made up by the model' }).vestingListValidated).toBe(false);
    expect(resolveDeedKbAvailability({ jurisdiction: 'MD', locality: null, deedType: 'deed', vestingSelection: 'as tenants by the entirety with the common-law right of survivorship' }).vestingListValidated).toBe(false); // MD unseeded
  });
});

describe('FOLD-DEED-1 Inc 2 — deedGate.referenceKb procedure', () => {
  const FLAG = 'DEED_GATE_ENABLED';
  const U = '11111111-1111-1111-1111-111111111111';
  let saved: string | undefined;
  const caller = (userId: string | undefined) => appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });
  beforeEach(() => { saved = process.env[FLAG]; });
  afterEach(() => { if (saved === undefined) delete process.env[FLAG]; else process.env[FLAG] = saved; });

  it('refuses when the flag is OFF', async () => {
    delete process.env[FLAG];
    await expect(caller(U).deedGate.referenceKb()).rejects.toThrow(/DEED_GATE_DISABLED/);
  });

  it('returns the verified KB allowlist with provenance + the five seeded localities', async () => {
    process.env[FLAG] = 'true';
    const kb = await caller(U).deedGate.referenceKb();
    expect(kb.provenance.source).toBe('docs/Deed_Drafting_Training_Guide_Virginia.docx');
    expect(kb.deedTypes.length).toBe(6);
    expect(kb.localities.length).toBe(5);
    expect(kb.escalationTriggers.length).toBeGreaterThan(0);
    expect(kb.exemptions.length).toBeGreaterThan(0);
  });
});
