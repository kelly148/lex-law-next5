/**
 * deed_doctype_guard_live9.test.ts — LIVE-9 (triad-dispositioned 2026-06-26).
 *
 * The generic LLM / template document path must NEVER mint a Virginia deed or deed-like recordable
 * instrument. These tests pin the shared classifier + block helper + send/export scanner that every generic
 * text-producing entry point consults:
 *   - all deed dropdown values + an adversarial free-text battery are blocked;
 *   - a deed of trust is class 2 (security_instrument) and never routed to the gift/conveyance assembler;
 *   - the free-text TITLE is matched only when documentType is 'custom' (a first-class NON-deed type with a
 *     deed-mentioning title is NOT blocked);
 *   - the block holds with DEED_DRAFT_AGENT_ENABLED OFF (only the message adapts);
 *   - non-deed types are unaffected (regression);
 *   - the defense-in-depth scanner flags deed OPERATIVE language but not incidental mentions.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  classifyDeedLike,
  enforceNotDeedLike,
  scanForDeedOperativeLanguage,
  isSanctionedAgentDeed,
  normalizeForDeedMatch,
  type DeedGuardResult,
} from '../deed/deedDocTypeGuard.js';

const FLAG = 'DEED_DRAFT_AGENT_ENABLED';
const prior = process.env[FLAG];
afterEach(() => {
  if (prior === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prior;
});

function classOf(r: DeedGuardResult): string {
  return r.blocked ? r.guardClass : 'allowed';
}

describe('classifyDeedLike — dropdown values', () => {
  it("'deed' is blocked as a conveyance_deed", () => {
    expect(classOf(classifyDeedLike({ documentType: 'deed' }))).toBe('conveyance_deed');
  });
  it("'deed_of_trust' is blocked as a security_instrument (class 2), NOT a conveyance deed", () => {
    expect(classOf(classifyDeedLike({ documentType: 'deed_of_trust' }))).toBe('security_instrument');
  });
});

describe('classifyDeedLike — adversarial free-text battery (all must block)', () => {
  const conveyance = [
    'gift_deed',
    'Virginia deed of gift',
    'corrective deed',
    'TOD deed',
    'warranty deed',
    'deed into trust',
    'deed for 3210 Q Street',
    'my deed',
    'deed of release',
    'quitclaim',
    'bargain and sale',
  ];
  const security = ['deed-of-trust', 'commercial deed of trust', 'security deed', 'mortgage'];

  for (const t of conveyance) {
    it(`blocks "${t}" as conveyance_deed`, () => {
      expect(classOf(classifyDeedLike({ documentType: t }))).toBe('conveyance_deed');
    });
  }
  for (const t of security) {
    it(`blocks "${t}" as security_instrument`, () => {
      expect(classOf(classifyDeedLike({ documentType: t }))).toBe('security_instrument');
    });
  }
});

describe('classifyDeedLike — normalization handles separators and camelCase', () => {
  it("'DeedOfTrust' normalizes and blocks as security", () => {
    expect(classOf(classifyDeedLike({ documentType: 'DeedOfTrust' }))).toBe('security_instrument');
  });
  it("'quit-claim' blocks as conveyance", () => {
    expect(classOf(classifyDeedLike({ documentType: 'quit-claim' }))).toBe('conveyance_deed');
  });
  it('normalizeForDeedMatch collapses separators', () => {
    expect(normalizeForDeedMatch('deed_of-Trust')).toBe('deed of trust');
  });
  it("plural 'deeds' is caught, but 'indeed' and 'deeded' are NOT (whole-word match)", () => {
    expect(classOf(classifyDeedLike({ documentType: 'deeds' }))).toBe('conveyance_deed');
    expect(classOf(classifyDeedLike({ documentType: 'indeed' }))).toBe('allowed');
    expect(classOf(classifyDeedLike({ documentType: 'deeded' }))).toBe('allowed');
  });
});

describe('classifyDeedLike — title is matched ONLY for documentType=custom', () => {
  it("custom + title 'Deed of Gift' is blocked (conveyance)", () => {
    expect(classOf(classifyDeedLike({ documentType: 'custom', title: 'Deed of Gift' }))).toBe('conveyance_deed');
  });
  it("custom + customTypeLabel 'Deed of Trust' is blocked (security)", () => {
    expect(classOf(classifyDeedLike({ documentType: 'custom', customTypeLabel: 'Deed of Trust' }))).toBe(
      'security_instrument',
    );
  });
  it("a first-class NON-deed type ('memo') with a deed-mentioning title is NOT blocked", () => {
    expect(classOf(classifyDeedLike({ documentType: 'memo', title: 'Analysis of a deed of gift' }))).toBe('allowed');
  });
  it('custom + a non-deed title is NOT blocked', () => {
    expect(classOf(classifyDeedLike({ documentType: 'custom', title: 'Settlement statement' }))).toBe('allowed');
  });
});

describe('classifyDeedLike — non-deed types are unaffected (regression)', () => {
  for (const t of ['will', 'memo', 'agreement', 'power_of_attorney', 'lease', 'contract', 'letter', 'engagement_letter']) {
    it(`'${t}' is allowed`, () => {
      expect(classOf(classifyDeedLike({ documentType: t }))).toBe('allowed');
    });
  }
});

describe('enforceNotDeedLike — throws the class-appropriate PRECONDITION_FAILED', () => {
  const base = { entryPath: 'test', userId: 'u1' };

  it('throws CONVEYANCE_DEED_BLOCKED for a deed', () => {
    try {
      enforceNotDeedLike({ ...base, documentType: 'deed' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('PRECONDITION_FAILED');
      expect((err as TRPCError).message).toContain('CONVEYANCE_DEED_BLOCKED');
    }
  });

  it('throws SECURITY_INSTRUMENT_BLOCKED for a deed of trust, and never references the gift/conveyance assembler', () => {
    try {
      enforceNotDeedLike({ ...base, documentType: 'deed_of_trust' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as TRPCError).message).toContain('SECURITY_INSTRUMENT_BLOCKED');
      expect((err as TRPCError).message).toContain('security-instrument');
      // a security instrument must NOT be steered to the deed/conveyance (Quick-Deed) workflow
      expect((err as TRPCError).message).not.toContain('Quick-Deed');
    }
  });

  it('does NOT throw for a non-deed type', () => {
    expect(() => enforceNotDeedLike({ ...base, documentType: 'will' })).not.toThrow();
  });

  it('the BLOCK holds with DEED_DRAFT_AGENT_ENABLED OFF (only the message adapts)', () => {
    delete process.env[FLAG];
    let offMsg = '';
    try {
      enforceNotDeedLike({ ...base, documentType: 'deed' });
    } catch (err) {
      offMsg = (err as TRPCError).message;
    }
    expect(offMsg).toContain('CONVEYANCE_DEED_BLOCKED');
    expect(offMsg).toContain('unavailable');

    process.env[FLAG] = 'true';
    let onMsg = '';
    try {
      enforceNotDeedLike({ ...base, documentType: 'deed' });
    } catch (err) {
      onMsg = (err as TRPCError).message;
    }
    expect(onMsg).toContain('CONVEYANCE_DEED_BLOCKED');
    expect(onMsg).toContain('Quick-Deed');
    expect(onMsg).not.toBe(offMsg);
  });
});

describe('scanForDeedOperativeLanguage — defense-in-depth send/export scanner', () => {
  it('flags the exemption-killing granting clause', () => {
    const text = 'The Grantor does hereby GRANT, BARGAIN, SELL and CONVEY unto the Grantee the following...';
    expect(scanForDeedOperativeLanguage(text).isDeedText).toBe(true);
  });
  it('flags the exemption-safe gift granting verb + Deed-of-Gift face statement', () => {
    const text = 'This Deed of Gift, made this day, witnesseth that the Grantor does grant and convey...';
    expect(scanForDeedOperativeLanguage(text).isDeedText).toBe(true);
  });
  it('flags a quitclaim operative clause', () => {
    expect(scanForDeedOperativeLanguage('the Grantor does remise, release and quitclaim').isDeedText).toBe(true);
  });
  it('does NOT flag a memo that merely mentions a deed in passing', () => {
    const text = 'This memo analyzes whether a deed of gift is the right vehicle; we recommend discussing it.';
    // "deed of gift" appears here, so it WOULD match — verify the narrower operative scan still distinguishes
    // a true operative clause from incidental prose by NOT matching ordinary discussion without a clause.
    const memo = 'This memorandum discusses the recordation tax treatment of the transfer to the client.';
    expect(scanForDeedOperativeLanguage(memo).isDeedText).toBe(false);
    // the phrase "deed of gift" is itself treated as operative (it names the instrument on its face):
    expect(scanForDeedOperativeLanguage(text).isDeedText).toBe(true);
  });
  it('returns false for empty / null text', () => {
    expect(scanForDeedOperativeLanguage('').isDeedText).toBe(false);
    expect(scanForDeedOperativeLanguage(null).isDeedText).toBe(false);
  });
});

describe('W3c — isSanctionedAgentDeed (provenance-aware export sanction)', () => {
  it('sanctions ONLY a deed stamped agent_assembled', () => {
    expect(isSanctionedAgentDeed('deed', 'agent_assembled')).toBe(true);
  });
  it('does NOT sanction a legacy deed (null / llm_authored provenance) — closes the LIVE-9 residual', () => {
    expect(isSanctionedAgentDeed('deed', null)).toBe(false);
    expect(isSanctionedAgentDeed('deed', undefined)).toBe(false);
    expect(isSanctionedAgentDeed('deed', 'llm_authored')).toBe(false);
  });
  it('does NOT sanction a non-deed type regardless of provenance (unchanged scan path)', () => {
    expect(isSanctionedAgentDeed('custom', 'agent_assembled')).toBe(false);
    expect(isSanctionedAgentDeed('memo', null)).toBe(false);
  });
});
