/**
 * CHAT-UI-1 W1 — posture model + coherence table (pure logic).
 *
 * The load-bearing safety logic (brief §2): the per-property confirm triggers (§2.1), the full-triple
 * coherence check (§2.2), and the operator-ratified ~8-row HARD/SOFT incoherence table (§2.6 D2).
 *
 * THE ISSUER SCENARIO IS THE FIRST ACCEPTANCE TEST (brief §1, build directive): a natural-language
 * request that changes who a document is "from" must NEVER silently set posture — it must require a
 * confirm — while a purely cosmetic reformat must not.
 */
import { describe, it, expect } from 'vitest';

import {
  type Issuer,
  type Posture,
  issuerRequiresConfirm,
  privilegeRequiresConfirm,
  recipientRequiresConfirm,
  posturePropertyTriggers,
  isOutwardMove,
  evaluateCoherence,
  hasHardBlock,
  INCOHERENCE_TABLE,
} from '../../shared/posture/postureCoherence.js';

const COUNSEL: Issuer = { entity: 'the firm', capacity: 'counsel' };
const PRINCIPAL: Issuer = { entity: 'the company', capacity: 'principal' };

const posture = (over: Partial<Posture> = {}): Posture => ({
  issuer: COUNSEL,
  privilege: null,
  recipient: 'internal_client',
  ...over,
});

// ── THE ISSUER SCENARIO (first acceptance test) ────────────────────────────────────────────────────

describe('CHAT-UI-1 issuer scenario — "firm style, no branding, from the owners"', () => {
  it('"from the owners" changes the issuer (entity + capacity) -> MUST require a confirm, never silent', () => {
    const before = COUNSEL; // "from counsel / the firm"
    const fromTheOwners: Issuer = { entity: 'the owners', capacity: 'principal' };
    expect(issuerRequiresConfirm(before, fromTheOwners)).toBe(true);
    expect(posturePropertyTriggers(posture({ issuer: before }), posture({ issuer: fromTheOwners })).any).toBe(true);
  });

  it('"firm style, no branding" (display reformat only — same entity + capacity) does NOT trigger a confirm', () => {
    const before: Issuer = { entity: 'the firm', capacity: 'counsel', display: 'Smith & Co LLP — letterhead' };
    const reformatted: Issuer = { entity: 'the firm', capacity: 'counsel', display: 'Smith & Co (no branding)' };
    expect(issuerRequiresConfirm(before, reformatted)).toBe(false);
  });

  it('a capacity change alone (same named entity, counsel -> principal) still requires a confirm', () => {
    expect(issuerRequiresConfirm({ entity: 'Acme', capacity: 'counsel' }, { entity: 'Acme', capacity: 'principal' })).toBe(true);
  });
});

// ── Per-property triggers (brief §2.1) ─────────────────────────────────────────────────────────────

describe('posture confirm triggers — privilege & recipient confirm on ANY change (no classifier)', () => {
  it('privilege confirms on every value change, including to/from undetermined (null)', () => {
    expect(privilegeRequiresConfirm(null, true)).toBe(true);
    expect(privilegeRequiresConfirm(null, false)).toBe(true);
    expect(privilegeRequiresConfirm(true, false)).toBe(true);
    expect(privilegeRequiresConfirm(false, true)).toBe(true);
    expect(privilegeRequiresConfirm(true, true)).toBe(false);
    expect(privilegeRequiresConfirm(null, null)).toBe(false);
  });

  it('recipient confirms on every value change', () => {
    expect(recipientRequiresConfirm('internal_client', 'adverse')).toBe(true);
    expect(recipientRequiresConfirm('adverse', 'adverse')).toBe(false);
  });

  it('posturePropertyTriggers reports each changed property and the aggregate', () => {
    const t = posturePropertyTriggers(
      posture({ issuer: COUNSEL, privilege: true, recipient: 'internal_client' }),
      posture({ issuer: PRINCIPAL, privilege: true, recipient: 'adverse' }),
    );
    expect(t).toEqual({ issuer: true, privilege: false, recipient: true, any: true });
  });

  it('an unchanged triple triggers nothing', () => {
    const p = posture({ issuer: COUNSEL, privilege: true, recipient: 'neutral_third_party' });
    expect(posturePropertyTriggers(p, p).any).toBe(false);
  });
});

describe('recipient outward-exposure ladder (brief §2.4)', () => {
  it('moving up the ladder is an outward move; moving down is not', () => {
    expect(isOutwardMove('internal_client', 'adverse')).toBe(true);
    expect(isOutwardMove('adverse', 'internal_client')).toBe(false);
    expect(isOutwardMove('regulator_court', 'public')).toBe(true);
    expect(isOutwardMove('adverse', 'adverse')).toBe(false);
  });
});

// ── The incoherence table (brief §2.6 D2) — every ratified row ─────────────────────────────────────

interface TableCase {
  name: string;
  posture: Posture;
  atEgress?: boolean;
  expectIds: string[];
  expectHard: boolean;
}

const TABLE_CASES: TableCase[] = [
  {
    name: 'R1 privileged -> adverse = HARD',
    posture: posture({ privilege: true, recipient: 'adverse' }),
    expectIds: ['priv-to-adverse'],
    expectHard: true,
  },
  {
    name: 'R2 privileged -> public = HARD',
    posture: posture({ privilege: true, recipient: 'public' }),
    expectIds: ['priv-to-public'],
    expectHard: true,
  },
  {
    name: 'R3 privileged -> regulator/court = HARD',
    posture: posture({ privilege: true, recipient: 'regulator_court' }),
    expectIds: ['priv-to-tribunal'],
    expectHard: true,
  },
  {
    name: 'R4 privileged -> neutral third party = SOFT',
    posture: posture({ privilege: true, recipient: 'neutral_third_party' }),
    expectIds: ['priv-to-third-party'],
    expectHard: false,
  },
  {
    name: 'R5 principal + privileged + co-counsel (outward) = HARD (outward row only)',
    posture: posture({ issuer: PRINCIPAL, privilege: true, recipient: 'co_counsel_agent' }),
    expectIds: ['principal-privileged-outward'],
    expectHard: true,
  },
  {
    name: 'R5+R1 principal + privileged + adverse = both HARD rows',
    posture: posture({ issuer: PRINCIPAL, privilege: true, recipient: 'adverse' }),
    expectIds: ['priv-to-adverse', 'principal-privileged-outward'],
    expectHard: true,
  },
  {
    name: 'R6 principal + privileged + internal/client = SOFT',
    posture: posture({ issuer: PRINCIPAL, privilege: true, recipient: 'internal_client' }),
    expectIds: ['principal-privileged-internal'],
    expectHard: false,
  },
  {
    name: 'R7 counsel + NOT privileged + internal/client = SOFT',
    posture: posture({ issuer: COUNSEL, privilege: false, recipient: 'internal_client' }),
    expectIds: ['counsel-unprivileged-internal'],
    expectHard: false,
  },
  {
    name: 'R8 adverse + privilege undetermined, AT EGRESS = HARD',
    posture: posture({ issuer: PRINCIPAL, privilege: null, recipient: 'adverse' }),
    atEgress: true,
    expectIds: ['adverse-privilege-unset'],
    expectHard: true,
  },
  {
    name: 'R8 does NOT fire away from egress (mid-flow null privilege is allowed)',
    posture: posture({ issuer: PRINCIPAL, privilege: null, recipient: 'adverse' }),
    atEgress: false,
    expectIds: [],
    expectHard: false,
  },
];

describe('incoherence table — ratified HARD/SOFT rows', () => {
  it.each(TABLE_CASES)('$name', ({ posture: p, atEgress, expectIds, expectHard }) => {
    const findings = evaluateCoherence(p, { atEgress: atEgress ?? false });
    expect(findings.map((f) => f.id).sort()).toEqual([...expectIds].sort());
    expect(hasHardBlock(findings)).toBe(expectHard);
  });

  it('every row carries an id, a severity, a summary, and a rationale (auditable data)', () => {
    expect(INCOHERENCE_TABLE.length).toBe(8);
    for (const row of INCOHERENCE_TABLE) {
      expect(row.id).toBeTruthy();
      expect(['HARD', 'SOFT']).toContain(row.severity);
      expect(row.summary.length).toBeGreaterThan(0);
      expect(row.rationale.length).toBeGreaterThan(0);
    }
  });
});

// ── Coherent postures must stay CLEAN (no false HARD/SOFT) — the brief §1 legitimate cases ──────────

describe('coherent postures produce no findings (no over-flagging)', () => {
  const COHERENT: { name: string; posture: Posture; atEgress?: boolean }[] = [
    {
      name: 'privileged advice from counsel to our client (the canonical privileged doc)',
      posture: posture({ issuer: COUNSEL, privilege: true, recipient: 'internal_client' }),
    },
    {
      name: 'non-privileged directive from the company to an adverse party (the §1 legitimate case)',
      posture: posture({ issuer: PRINCIPAL, privilege: false, recipient: 'adverse' }),
      atEgress: true,
    },
    {
      name: 'non-privileged demand letter from counsel to an adverse party',
      posture: posture({ issuer: COUNSEL, privilege: false, recipient: 'adverse' }),
      atEgress: true,
    },
    {
      name: 'counsel, privilege determined false, to a neutral third party',
      posture: posture({ issuer: COUNSEL, privilege: false, recipient: 'neutral_third_party' }),
    },
  ];

  it.each(COHERENT)('$name -> no findings', ({ posture: p, atEgress }) => {
    expect(evaluateCoherence(p, { atEgress: atEgress ?? false })).toEqual([]);
  });
});
