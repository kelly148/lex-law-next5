/**
 * CONFLICT-TOGGLE-1 Inc 1 — firm-scoped conflicts POSTURE policy substrate (DORMANT).
 *
 * Covers the ethics-load-bearing core in isolation: the PURE default-safe resolver (force-on precedence,
 * representational-always-ENFORCED, fail-closed on missing/unknown), the schema defaults + relaxation
 * detection, the procedure (flag-gated dark, owner-scoped, typed-reason-required on relaxation), and the
 * migration's additive/idempotent DDL guards. DB-free: the query layer is mocked. Nothing here exercises a
 * gate TRANSITION — the substrate is dormant by design (no transition reads the posture in Inc 1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import {
  resolveEffectivePosture,
  ConflictPolicySchema,
  DEFAULT_CONFLICT_POLICY,
  isPolicyRelaxation,
  CONFLICT_POSTURE_VALUES,
  type ConflictPolicy,
} from '../../shared/schemas/conflictPolicy.js';

vi.mock('../db/queries/conflictPolicy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/conflictPolicy.js')>();
  return {
    ...actual,
    getFirmConflictPolicy: vi.fn(),
    setFirmConflictPolicy: vi.fn(),
    listFirmConflictPolicyHistory: vi.fn(),
  };
});

import { appRouter } from '../router.js';
import * as policyQueries from '../db/queries/conflictPolicy.js';

const U1 = '11111111-1111-1111-1111-111111111111';
function caller(userId: string | undefined) {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });
}
function pol(transactionalPosture: 'ENFORCED' | 'ADVISORY'): ConflictPolicy {
  // deedConflictsEnforced defaults false (QD-2). Included so the object is a complete ConflictPolicy and so the
  // setPolicy .toHaveBeenCalledWith assertions match the Zod-parsed (defaulted) input the router forwards.
  return { schemaVersion: 1, transactionalPosture, deedConflictsEnforced: false };
}

// ── the pure resolver (default-safe) ────────────────────────────────────────
describe('CONFLICT-TOGGLE-1 — resolveEffectivePosture (pure, default-safe)', () => {
  it('FORCE-ON overrides everything — even a transactional ADVISORY policy resolves ENFORCED', () => {
    const r = resolveEffectivePosture({ policy: pol('ADVISORY'), capacity: 'title_settlement_agent', forceOn: true });
    expect(r).toEqual({ posture: 'ENFORCED', source: 'force_on' });
  });

  it('representational (law_firm) capacity is ALWAYS ENFORCED, regardless of policy', () => {
    expect(resolveEffectivePosture({ policy: pol('ADVISORY'), capacity: 'law_firm', forceOn: false }).posture).toBe('ENFORCED');
  });

  it('unknown / null / undefined capacity is fail-closed to ENFORCED', () => {
    for (const capacity of [null, undefined, '', 'something_else']) {
      const r = resolveEffectivePosture({ policy: pol('ADVISORY'), capacity, forceOn: false });
      expect(r.posture).toBe('ENFORCED');
      expect(r.source).toBe('representational_or_default');
    }
  });

  it('transactional capacity with NO policy is fail-closed to ENFORCED', () => {
    const r = resolveEffectivePosture({ policy: null, capacity: 'title_settlement_agent', forceOn: false });
    expect(r).toEqual({ posture: 'ENFORCED', source: 'no_policy_default' });
  });

  it('transactional capacity honors the firm policy — the ONLY relaxation path (ENFORCED stays ENFORCED, ADVISORY -> ADVISORY)', () => {
    expect(resolveEffectivePosture({ policy: pol('ENFORCED'), capacity: 'title_settlement_agent', forceOn: false }))
      .toEqual({ posture: 'ENFORCED', source: 'firm_policy' });
    expect(resolveEffectivePosture({ policy: pol('ADVISORY'), capacity: 'title_settlement_agent', forceOn: false }))
      .toEqual({ posture: 'ADVISORY', source: 'firm_policy' });
  });
});

// ── the schema (defaults + relaxation) ──────────────────────────────────────
describe('CONFLICT-TOGGLE-1 — ConflictPolicySchema (default-safe shape)', () => {
  it('DEFAULT_CONFLICT_POLICY is the SAFE policy and an empty object parses to it', () => {
    // QD-2 added the defaulted deedConflictsEnforced:false field — old/empty blobs still parse to the safe default.
    expect(DEFAULT_CONFLICT_POLICY).toEqual({ schemaVersion: 1, transactionalPosture: 'ENFORCED', deedConflictsEnforced: false });
    expect(ConflictPolicySchema.parse({})).toEqual(DEFAULT_CONFLICT_POLICY);
  });

  it('QD-2: deedConflictsEnforced defaults to false on an OLD policy (parse-default; no DDL) and round-trips', () => {
    // An old persisted row written before QD-2 has NO deedConflictsEnforced key; parsing applies the default.
    const oldRow = { schemaVersion: 1, transactionalPosture: 'ADVISORY' };
    expect(ConflictPolicySchema.parse(oldRow).deedConflictsEnforced).toBe(false);
    // A new explicit true round-trips and is preserved alongside the other fields.
    const enforced = ConflictPolicySchema.parse({ schemaVersion: 1, transactionalPosture: 'ENFORCED', deedConflictsEnforced: true });
    expect(enforced.deedConflictsEnforced).toBe(true);
    expect(enforced.transactionalPosture).toBe('ENFORCED');
    // Flipping only the deed field preserves the rest (the setConflictsEnforced spread pattern).
    const flipped = ConflictPolicySchema.parse({ ...ConflictPolicySchema.parse({ transactionalPosture: 'ADVISORY' }), deedConflictsEnforced: true });
    expect(flipped).toEqual({ schemaVersion: 1, transactionalPosture: 'ADVISORY', deedConflictsEnforced: true });
  });

  it('QD-2: a MALFORMED policy blob fails safeParse, and the safe DEFAULT it falls back to has deedConflictsEnforced=false', () => {
    // getFirmConflictPolicy fail-closes a malformed persisted blob to DEFAULT_CONFLICT_POLICY (never throws,
    // never relaxes). The deed toggle must inherit that safe default — an unreadable policy can NEVER read as
    // "enforced=... whatever the corrupt blob said"; it reads as the safe default (false here = QD-1 bypass).
    expect(ConflictPolicySchema.safeParse({ transactionalPosture: 'GARBAGE', deedConflictsEnforced: 'yes' }).success).toBe(false);
    expect(ConflictPolicySchema.safeParse('not even an object').success).toBe(false);
    // A deedConflictsEnforced that is not a boolean is rejected (not silently coerced):
    expect(ConflictPolicySchema.safeParse({ schemaVersion: 1, transactionalPosture: 'ENFORCED', deedConflictsEnforced: 1 }).success).toBe(false);
    // The fallback the query layer uses carries the safe deed default:
    expect(DEFAULT_CONFLICT_POLICY.deedConflictsEnforced).toBe(false);
  });

  it('rejects a bad posture and never allows SANDBOX as a firm transactional default', () => {
    expect(ConflictPolicySchema.safeParse({ transactionalPosture: 'bogus' }).success).toBe(false);
    expect(ConflictPolicySchema.safeParse({ transactionalPosture: 'SANDBOX' }).success).toBe(false);
    expect(CONFLICT_POSTURE_VALUES).toEqual(['ENFORCED', 'ADVISORY', 'SANDBOX']); // SANDBOX exists, just not as a firm default
  });

  it('isPolicyRelaxation is true ONLY for transactional ENFORCED -> ADVISORY', () => {
    expect(isPolicyRelaxation(pol('ENFORCED'), pol('ADVISORY'))).toBe(true);
    expect(isPolicyRelaxation(pol('ADVISORY'), pol('ENFORCED'))).toBe(false); // tightening
    expect(isPolicyRelaxation(pol('ENFORCED'), pol('ENFORCED'))).toBe(false);
    expect(isPolicyRelaxation(pol('ADVISORY'), pol('ADVISORY'))).toBe(false);
  });
});

// ── the procedure (gated, owner-scoped, reason-required on relaxation) ───────
describe('CONFLICT-TOGGLE-1 — conflictPolicy router', () => {
  const GATE = 'CONFLICT_GATE_ENABLED';
  const FORCE = 'CONFLICT_GATE_FORCE_ON';
  let savedGate: string | undefined;
  let savedForce: string | undefined;
  beforeEach(() => {
    savedGate = process.env[GATE];
    savedForce = process.env[FORCE];
    vi.clearAllMocks();
    vi.mocked(policyQueries.getFirmConflictPolicy).mockResolvedValue({ policy: pol('ENFORCED'), source: 'default' });
    vi.mocked(policyQueries.setFirmConflictPolicy).mockResolvedValue({ policy: pol('ADVISORY'), source: 'persisted' });
    vi.mocked(policyQueries.listFirmConflictPolicyHistory).mockResolvedValue([]);
  });
  afterEach(() => {
    if (savedGate === undefined) delete process.env[GATE]; else process.env[GATE] = savedGate;
    if (savedForce === undefined) delete process.env[FORCE]; else process.env[FORCE] = savedForce;
  });

  it('isEnabled is ungated and reflects the flag; every other op refuses when the gate is OFF', async () => {
    delete process.env[GATE];
    const u = caller(U1);
    expect(await u.conflictPolicy.isEnabled()).toEqual({ enabled: false });
    await expect(u.conflictPolicy.get()).rejects.toThrow(/CONFLICT_GATE_DISABLED/);
    await expect(u.conflictPolicy.setPolicy({ policy: pol('ENFORCED') })).rejects.toThrow(/CONFLICT_GATE_DISABLED/);
    await expect(u.conflictPolicy.history()).rejects.toThrow(/CONFLICT_GATE_DISABLED/);
    expect(policyQueries.getFirmConflictPolicy).not.toHaveBeenCalled();
  });

  it('get returns the policy + per-capacity effective posture; owner-scoped to ctx.userId', async () => {
    process.env[GATE] = 'true';
    delete process.env[FORCE];
    vi.mocked(policyQueries.getFirmConflictPolicy).mockResolvedValue({ policy: pol('ADVISORY'), source: 'persisted' });
    const res = await caller(U1).conflictPolicy.get();
    expect(policyQueries.getFirmConflictPolicy).toHaveBeenCalledWith(U1); // firmOwnerUserId = ctx.userId
    expect(res.policy.transactionalPosture).toBe('ADVISORY');
    expect(res.effectiveByCapacity.law_firm).toBe('ENFORCED'); // representational non-disableable
    expect(res.effectiveByCapacity.title_settlement_agent).toBe('ADVISORY');
    expect(res.forceOn).toBe(false);
  });

  it('FORCE-ON makes the effective posture ENFORCED for both capacities even when the policy is ADVISORY', async () => {
    process.env[GATE] = 'true';
    process.env[FORCE] = 'true';
    vi.mocked(policyQueries.getFirmConflictPolicy).mockResolvedValue({ policy: pol('ADVISORY'), source: 'persisted' });
    const res = await caller(U1).conflictPolicy.get();
    expect(res.forceOn).toBe(true);
    expect(res.effectiveByCapacity.title_settlement_agent).toBe('ENFORCED');
  });

  it('setPolicy RELAXATION without a typed reason is refused (CONFLICT_POLICY_REASON_REQUIRED)', async () => {
    process.env[GATE] = 'true';
    vi.mocked(policyQueries.getFirmConflictPolicy).mockResolvedValue({ policy: pol('ENFORCED'), source: 'persisted' });
    await expect(caller(U1).conflictPolicy.setPolicy({ policy: pol('ADVISORY') }))
      .rejects.toThrow(/CONFLICT_POLICY_REASON_REQUIRED/);
    expect(policyQueries.setFirmConflictPolicy).not.toHaveBeenCalled();
  });

  it('setPolicy RELAXATION with a typed reason persists (owner-scoped, reason recorded)', async () => {
    process.env[GATE] = 'true';
    vi.mocked(policyQueries.getFirmConflictPolicy).mockResolvedValue({ policy: pol('ENFORCED'), source: 'persisted' });
    await caller(U1).conflictPolicy.setPolicy({ policy: pol('ADVISORY'), reasonText: 'deed scrivener desk only' });
    expect(policyQueries.setFirmConflictPolicy).toHaveBeenCalledWith({
      firmOwnerUserId: U1,
      changedByUserId: U1,
      policy: pol('ADVISORY'),
      reasonText: 'deed scrivener desk only',
    });
  });

  it('setPolicy TIGHTENING (ADVISORY -> ENFORCED) needs no reason', async () => {
    process.env[GATE] = 'true';
    vi.mocked(policyQueries.getFirmConflictPolicy).mockResolvedValue({ policy: pol('ADVISORY'), source: 'persisted' });
    vi.mocked(policyQueries.setFirmConflictPolicy).mockResolvedValue({ policy: pol('ENFORCED'), source: 'persisted' });
    await caller(U1).conflictPolicy.setPolicy({ policy: pol('ENFORCED') });
    expect(policyQueries.setFirmConflictPolicy).toHaveBeenCalledTimes(1);
  });
});

// ── the migration (additive / idempotent / TiDB-safe) ───────────────────────
describe('CONFLICT-TOGGLE-1 — migration 0047 additive guards', () => {
  const MIGRATION_SQL = readFileSync(
    fileURLToPath(new URL('../db/migrations/0047_conflict_toggle_1_posture_policy.sql', import.meta.url)),
    'utf8',
  );
  const MIGRATION_DDL = MIGRATION_SQL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

  it('creates firm_conflict_policy idempotently, additive-only, with an INLINE index (no ALTER ... ADD INDEX)', () => {
    expect(/CREATE TABLE IF NOT EXISTS `firm_conflict_policy`/.test(MIGRATION_SQL)).toBe(true);
    expect(/\bDROP\s+(TABLE|COLUMN|DATABASE|INDEX)\b/i.test(MIGRATION_DDL)).toBe(false);
    expect(/\bTRUNCATE\b/i.test(MIGRATION_DDL)).toBe(false);
    expect(/\bDELETE\s+FROM\b/i.test(MIGRATION_DDL)).toBe(false);
    expect(/\bRENAME\b/i.test(MIGRATION_DDL)).toBe(false);
    expect(/ALTER\s+TABLE[\s\S]*ADD\s+(UNIQUE\s+)?INDEX/i.test(MIGRATION_DDL)).toBe(false); // TiDB trap
    expect(/INDEX `idx_firm_conflict_policy_owner`/.test(MIGRATION_SQL)).toBe(true); // index is INLINE
  });
});
