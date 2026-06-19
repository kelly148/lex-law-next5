/**
 * CONFLICT-TOGGLE-1 Inc 2 — the POSTURE-aware gate wiring (the behavior-changing layer).
 *
 * Covers: the pure composition (clamp / matter-effective-posture / auto-escalation / apply-to-gate), the
 * posture-aware gate wrapper (resolvePostureDraftingGate) over mocked clearance + state, the per-matter
 * election procedure (attestation + auto-escalation refusal + Matter-Record audit), and the migration's
 * additive guards. DB-free: the query layers are mocked. The clearance predicate is never touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import {
  clampPostureToCeiling,
  resolveMatterEffectivePosture,
  detectAutoEscalation,
  applyPostureToGate,
  type ConflictPolicy,
} from '../../shared/schemas/conflictPolicy.js';

function pol(transactionalPosture: 'ENFORCED' | 'ADVISORY'): ConflictPolicy {
  return { schemaVersion: 1, transactionalPosture };
}

// ── pure composition ────────────────────────────────────────────────────────
describe('CONFLICT-TOGGLE-1 Inc 2 — pure posture composition', () => {
  it('clampPostureToCeiling: stricter passes, more-lenient is clamped up to the ceiling', () => {
    expect(clampPostureToCeiling('ENFORCED', 'ADVISORY')).toBe('ENFORCED'); // stricter ok
    expect(clampPostureToCeiling('ADVISORY', 'ADVISORY')).toBe('ADVISORY');
    expect(clampPostureToCeiling('ADVISORY', 'ENFORCED')).toBe('ENFORCED'); // can't be more lenient than ceiling
    expect(clampPostureToCeiling('SANDBOX', 'ADVISORY')).toBe('ADVISORY'); // sandbox not reachable below an ADVISORY ceiling
  });

  it('resolveMatterEffectivePosture: force-on / auto-escalation / representational all force ENFORCED', () => {
    expect(resolveMatterEffectivePosture({ firmPolicy: pol('ADVISORY'), capacity: 'title_settlement_agent', electedPosture: 'ADVISORY', forceOn: true, autoEscalate: false }).posture).toBe('ENFORCED');
    expect(resolveMatterEffectivePosture({ firmPolicy: pol('ADVISORY'), capacity: 'title_settlement_agent', electedPosture: 'ADVISORY', forceOn: false, autoEscalate: true }).posture).toBe('ENFORCED');
    expect(resolveMatterEffectivePosture({ firmPolicy: pol('ADVISORY'), capacity: 'law_firm', electedPosture: 'ADVISORY', forceOn: false, autoEscalate: false }).posture).toBe('ENFORCED');
  });

  it('resolveMatterEffectivePosture: transactional honors the election, clamped to the firm ceiling', () => {
    // firm permits ADVISORY, matter elects ADVISORY -> ADVISORY
    expect(resolveMatterEffectivePosture({ firmPolicy: pol('ADVISORY'), capacity: 'title_settlement_agent', electedPosture: 'ADVISORY', forceOn: false, autoEscalate: false }))
      .toEqual({ posture: 'ADVISORY', source: 'matter_election' });
    // firm ENFORCED ceiling, matter elects ADVISORY -> clamped to ENFORCED
    expect(resolveMatterEffectivePosture({ firmPolicy: pol('ENFORCED'), capacity: 'title_settlement_agent', electedPosture: 'ADVISORY', forceOn: false, autoEscalate: false }))
      .toEqual({ posture: 'ENFORCED', source: 'matter_election_clamped' });
    // no election -> firm default
    expect(resolveMatterEffectivePosture({ firmPolicy: pol('ADVISORY'), capacity: 'title_settlement_agent', electedPosture: null, forceOn: false, autoEscalate: false }))
      .toEqual({ posture: 'ADVISORY', source: 'firm_default' });
  });

  it('detectAutoEscalation: adverse party / multiple represented / blocker each escalate', () => {
    expect(detectAutoEscalation({ partyRoles: ['client', 'adverse'], clientPartyCount: 1, clearanceState: 'NOT_ESTABLISHED' }).escalate).toBe(true);
    expect(detectAutoEscalation({ partyRoles: ['client', 'client'], clientPartyCount: 2, clearanceState: 'NOT_ESTABLISHED' }).triggers).toContain('multiple_represented_parties');
    expect(detectAutoEscalation({ partyRoles: ['client'], clientPartyCount: 1, clearanceState: 'BLOCKED' }).triggers).toContain('undispositioned_blocker');
    expect(detectAutoEscalation({ partyRoles: ['client'], clientPartyCount: 1, clearanceState: 'NOT_ESTABLISHED' }).escalate).toBe(false);
  });

  it('applyPostureToGate: ENFORCED passes through; ADVISORY lets absence pass but a BLOCKER hard-stops; SANDBOX allows', () => {
    // ENFORCED mirrors the base gate
    expect(applyPostureToGate({ posture: 'ENFORCED', clearanceState: 'NOT_ESTABLISHED', baseAllowed: false, blockingReasons: ['no_conflict_check'] }))
      .toEqual({ allowed: false, mode: 'enforced', bypassedReasons: [] });
    // ADVISORY + non-blocker absence -> allowed, records what it bypassed
    expect(applyPostureToGate({ posture: 'ADVISORY', clearanceState: 'NOT_ESTABLISHED', baseAllowed: false, blockingReasons: ['no_conflict_check', 'no_client_party'] }))
      .toEqual({ allowed: true, mode: 'advisory_clear', bypassedReasons: ['no_conflict_check', 'no_client_party'] });
    // ADVISORY + a positive BLOCKER -> still hard-stops
    expect(applyPostureToGate({ posture: 'ADVISORY', clearanceState: 'BLOCKED', baseAllowed: false, blockingReasons: ['undispositioned_blocker'] }))
      .toEqual({ allowed: false, mode: 'advisory_blocker', bypassedReasons: [] });
    // SANDBOX allows regardless (internal/non-client) — even with a blocker
    expect(applyPostureToGate({ posture: 'SANDBOX', clearanceState: 'BLOCKED', baseAllowed: false, blockingReasons: ['undispositioned_blocker'] }).allowed).toBe(true);
  });
});

// ── the posture-aware gate wrapper ──────────────────────────────────────────
vi.mock('../db/queries/gateOverride.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/gateOverride.js')>();
  return { ...actual, resolveDraftingGate: vi.fn() };
});
vi.mock('../db/queries/conflictPolicy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/conflictPolicy.js')>();
  return { ...actual, getFirmConflictPolicy: vi.fn(), getMatterConflictPosture: vi.fn(), setMatterConflictPosture: vi.fn() };
});
vi.mock('../db/queries/matters.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/matters.js')>();
  return { ...actual, getMatterById: vi.fn() };
});
vi.mock('../db/queries/matterParties.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/matterParties.js')>();
  return { ...actual, listPartiesForMatter: vi.fn() };
});
vi.mock('../db/queries/conflicts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/conflicts.js')>();
  return { ...actual, evaluateAllClearanceReasons: vi.fn() };
});
vi.mock('../db/queries/auditEvents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/auditEvents.js')>();
  return { ...actual, insertAuditEvent: vi.fn().mockResolvedValue('evt-1') };
});

import { resolvePostureDraftingGate } from '../conflicts/postureGate.js';
import { appRouter } from '../router.js';
import * as gateOverrideQ from '../db/queries/gateOverride.js';
import * as policyQ from '../db/queries/conflictPolicy.js';
import * as mattersQ from '../db/queries/matters.js';
import * as partiesQ from '../db/queries/matterParties.js';
import * as conflictsQ from '../db/queries/conflicts.js';
import * as auditQ from '../db/queries/auditEvents.js';

const U = '11111111-1111-1111-1111-111111111111';
const M = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const GATE = 'CONFLICT_GATE_ENABLED';
const FORCE = 'CONFLICT_GATE_FORCE_ON';

function baseGate(over: Partial<{ allowed: boolean; state: string; reasons: string[]; blockingReasons: string[] }> = {}) {
  const state = over.state ?? 'NOT_ESTABLISHED';
  return {
    allowed: over.allowed ?? false,
    clearance: { state, reasons: over.reasons ?? ['no_conflict_check'] },
    blockingReasons: over.blockingReasons ?? ['no_conflict_check'],
    blockingPreconditions: [],
    overriddenPreconditions: [],
    activeOverrides: [],
  } as Awaited<ReturnType<typeof gateOverrideQ.resolveDraftingGate>>;
}
function setMatter(capacity: string | null) {
  vi.mocked(mattersQ.getMatterById).mockResolvedValue({ id: M, userId: U, engagementCapacity: capacity } as Awaited<ReturnType<typeof mattersQ.getMatterById>>);
}
function setParties(roles: string[]) {
  vi.mocked(partiesQ.listPartiesForMatter).mockResolvedValue(roles.map((role, i) => ({ id: `p${i}`, role })) as Awaited<ReturnType<typeof partiesQ.listPartiesForMatter>>);
}

let savedGate: string | undefined;
let savedForce: string | undefined;
beforeEach(() => {
  savedGate = process.env[GATE];
  savedForce = process.env[FORCE];
  vi.clearAllMocks();
  delete process.env[FORCE];
  vi.mocked(policyQ.getFirmConflictPolicy).mockResolvedValue({ policy: pol('ADVISORY'), source: 'persisted' });
  vi.mocked(policyQ.getMatterConflictPosture).mockResolvedValue('ADVISORY');
  vi.mocked(policyQ.setMatterConflictPosture).mockResolvedValue(undefined);
  vi.mocked(conflictsQ.evaluateAllClearanceReasons).mockResolvedValue({ state: 'NOT_ESTABLISHED', reasons: ['no_conflict_check'] });
  setMatter('title_settlement_agent');
  setParties(['client']);
});
afterEach(() => {
  if (savedGate === undefined) delete process.env[GATE]; else process.env[GATE] = savedGate;
  if (savedForce === undefined) delete process.env[FORCE]; else process.env[FORCE] = savedForce;
});

describe('CONFLICT-TOGGLE-1 Inc 2 — resolvePostureDraftingGate', () => {
  it('ADVISORY transactional matter: a non-cleared (non-blocker) matter is ALLOWED, with the bypassed reasons recorded', async () => {
    vi.mocked(gateOverrideQ.resolveDraftingGate).mockResolvedValue(baseGate({ allowed: false, state: 'NOT_ESTABLISHED', blockingReasons: ['no_conflict_check', 'no_client_party'] }));
    const r = await resolvePostureDraftingGate(M, U);
    expect(r.posture).toBe('ADVISORY');
    expect(r.allowed).toBe(true);
    expect(r.mode).toBe('advisory_clear');
    expect(r.bypassedReasons).toEqual(['no_conflict_check', 'no_client_party']);
  });

  it('a positive BLOCKER hard-stops even under an ADVISORY election (auto-escalates to ENFORCED per item 10)', async () => {
    vi.mocked(gateOverrideQ.resolveDraftingGate).mockResolvedValue(baseGate({ allowed: false, state: 'BLOCKED', blockingReasons: ['undispositioned_blocker'] }));
    const r = await resolvePostureDraftingGate(M, U);
    expect(r.allowed).toBe(false);
    // The disposition lists "any blocker" as an auto-escalation trigger → the effective posture is ENFORCED.
    expect(r.posture).toBe('ENFORCED');
    expect(r.postureSource).toBe('auto_escalation');
    expect(r.autoEscalationTriggers).toContain('undispositioned_blocker');
  });

  it('auto-escalation (adverse party) forces ENFORCED — a non-cleared matter is BLOCKED despite the ADVISORY election', async () => {
    setParties(['client', 'adverse']);
    vi.mocked(gateOverrideQ.resolveDraftingGate).mockResolvedValue(baseGate({ allowed: false, state: 'NOT_ESTABLISHED', blockingReasons: ['no_conflict_check'] }));
    const r = await resolvePostureDraftingGate(M, U);
    expect(r.posture).toBe('ENFORCED');
    expect(r.postureSource).toBe('auto_escalation');
    expect(r.allowed).toBe(false);
    expect(r.autoEscalationTriggers).toContain('adverse_party_present');
  });

  it('representational (law_firm) matter is ENFORCED regardless of the firm/elected posture', async () => {
    setMatter('law_firm');
    vi.mocked(gateOverrideQ.resolveDraftingGate).mockResolvedValue(baseGate({ allowed: false, state: 'NOT_ESTABLISHED' }));
    const r = await resolvePostureDraftingGate(M, U);
    expect(r.posture).toBe('ENFORCED');
    expect(r.allowed).toBe(false);
  });

  it('CLEARED is allowed under every posture', async () => {
    vi.mocked(gateOverrideQ.resolveDraftingGate).mockResolvedValue(baseGate({ allowed: true, state: 'CLEARED', reasons: [], blockingReasons: [] }));
    const r = await resolvePostureDraftingGate(M, U);
    expect(r.allowed).toBe(true);
  });
});

// ── the election procedure ──────────────────────────────────────────────────
function caller(userId: string | undefined) {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });
}

describe('CONFLICT-TOGGLE-1 Inc 2 — conflictPolicy.setMatterPosture', () => {
  beforeEach(() => {
    process.env[GATE] = 'true';
  });

  it('ELECTING ADVISORY without an attestation reason is refused', async () => {
    await expect(caller(U).conflictPolicy.setMatterPosture({ matterId: M, posture: 'ADVISORY' }))
      .rejects.toThrow(/CONFLICT_POSTURE_ATTESTATION_REQUIRED/);
    expect(policyQ.setMatterConflictPosture).not.toHaveBeenCalled();
  });

  it('ELECTING ADVISORY is REFUSED when an adverse party auto-escalates the matter', async () => {
    setParties(['client', 'adverse']);
    await expect(caller(U).conflictPolicy.setMatterPosture({ matterId: M, posture: 'ADVISORY', reasonText: 'scrivener only' }))
      .rejects.toThrow(/CONFLICT_POSTURE_ADVISORY_REFUSED/);
    expect(policyQ.setMatterConflictPosture).not.toHaveBeenCalled();
  });

  it('ELECTING ADVISORY is REFUSED on a representational matter', async () => {
    setMatter('law_firm');
    await expect(caller(U).conflictPolicy.setMatterPosture({ matterId: M, posture: 'ADVISORY', reasonText: 'scrivener only' }))
      .rejects.toThrow(/CONFLICT_POSTURE_ADVISORY_REFUSED/);
  });

  it('ELECTING ADVISORY succeeds on a clean transactional matter; writes the election + a Matter-Record audit event', async () => {
    setMatter('title_settlement_agent');
    setParties(['client']);
    await caller(U).conflictPolicy.setMatterPosture({ matterId: M, posture: 'ADVISORY', reasonText: 'deed scrivener, no adverse party' });
    expect(policyQ.setMatterConflictPosture).toHaveBeenCalledWith(expect.objectContaining({ userId: U, matterId: M, posture: 'ADVISORY', reasonText: 'deed scrivener, no adverse party' }));
    expect(auditQ.insertAuditEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(auditQ.insertAuditEvent).mock.calls[0]![0]).toMatchObject({ matterId: M, action: 'set_conflict_posture', scope: 'matter' });
  });

  it('ELECTING ENFORCED always succeeds (no reason required) and is owner-scoped', async () => {
    await caller(U).conflictPolicy.setMatterPosture({ matterId: M, posture: 'ENFORCED' });
    expect(policyQ.setMatterConflictPosture).toHaveBeenCalledWith(expect.objectContaining({ userId: U, posture: 'ENFORCED' }));
  });

  it('refuses entirely when the gate flag is OFF', async () => {
    delete process.env[GATE];
    await expect(caller(U).conflictPolicy.setMatterPosture({ matterId: M, posture: 'ENFORCED' })).rejects.toThrow(/CONFLICT_GATE_DISABLED/);
  });
});

// ── migration ───────────────────────────────────────────────────────────────
describe('CONFLICT-TOGGLE-1 Inc 2 — migration 0048 additive guards', () => {
  const SQL = readFileSync(fileURLToPath(new URL('../db/migrations/0048_conflict_toggle_1_matter_posture.sql', import.meta.url)), 'utf8');
  const DDL = SQL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  it('creates matter_conflict_posture idempotently, additive-only, INLINE index', () => {
    expect(/CREATE TABLE IF NOT EXISTS `matter_conflict_posture`/.test(SQL)).toBe(true);
    expect(/\bDROP\s+(TABLE|COLUMN|DATABASE|INDEX)\b/i.test(DDL)).toBe(false);
    expect(/\bTRUNCATE\b|\bDELETE\s+FROM\b|\bRENAME\b/i.test(DDL)).toBe(false);
    expect(/ALTER\s+TABLE[\s\S]*ADD\s+(UNIQUE\s+)?INDEX/i.test(DDL)).toBe(false);
    expect(/INDEX `idx_matter_conflict_posture`/.test(SQL)).toBe(true);
  });
});
