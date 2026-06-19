/**
 * CONFLICT-GATE-OVERRIDE-1 — pure override-resolution + re-arm logic, enum sync, default-fail-closed
 * proof, and wiring scans.
 *
 * CI has no test DB, so the load-bearing behavior is proven via the PURE exported functions
 * (src/server/conflicts/gateOverride.ts) and the wiring is pinned via source-text assertions. The DB
 * query wrappers (src/server/db/queries/gateOverride.ts) provably no-op in this suite (unmocked).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  preconditionForReason,
  blockingPreconditionsForReasons,
  resolveGateAllowed,
  canonicalConflictsSnapshot,
  canonicalIdentitySnapshot,
  hashSnapshot,
} from '../conflicts/gateOverride.js';
import {
  GATE_OVERRIDE_PRECONDITION_VALUES as SHARED_PRECONDITIONS,
  GATE_OVERRIDE_REASON_CODE_VALUES as SHARED_REASONS,
} from '../../shared/schemas/gateOverride.js';
import {
  GATE_OVERRIDE_PRECONDITION_VALUES as SCHEMA_PRECONDITIONS,
  GATE_OVERRIDE_REASON_CODE_VALUES as SCHEMA_REASONS,
} from '../db/schema.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('CONFLICT-GATE-OVERRIDE-1: reason -> precondition mapping (mirrors evaluateConflictClearance)', () => {
  it('maps the conflicts-clearance reasons to "conflicts"', () => {
    expect(preconditionForReason('no_conflict_check')).toBe('conflicts');
    expect(preconditionForReason('check_stale_parties_changed')).toBe('conflicts');
    expect(preconditionForReason('undispositioned_blocker')).toBe('conflicts');
  });
  it('maps the identity-verification reasons to "identity"', () => {
    expect(preconditionForReason('unconfirmed_client_party')).toBe('identity');
    expect(preconditionForReason('no_client_party')).toBe('identity');
  });
  it('maps an unknown / synthetic reason to NO precondition (never coverable -> always blocks)', () => {
    expect(preconditionForReason('clearance_evaluation_failed')).toBeNull();
    expect(preconditionForReason('something_else')).toBeNull();
  });
  it('blockingPreconditionsForReasons collapses reasons to the distinct preconditions (stable order)', () => {
    expect(blockingPreconditionsForReasons(['undispositioned_blocker'])).toEqual(['conflicts']);
    expect(blockingPreconditionsForReasons(['no_client_party'])).toEqual(['identity']);
    expect(blockingPreconditionsForReasons(['undispositioned_blocker', 'unconfirmed_client_party'])).toEqual([
      'conflicts',
      'identity',
    ]);
  });
});

describe('CONFLICT-GATE-OVERRIDE-1: resolveGateAllowed — default fail-closed is UNCHANGED', () => {
  const none = new Set<'conflicts' | 'identity'>();

  it('CLEARED is always allowed (no override consulted)', () => {
    expect(resolveGateAllowed({ state: 'CLEARED', reasons: [] }, none).allowed).toBe(true);
  });

  it('with NO active overrides, a non-CLEARED matter is BLOCKED and every reason is preserved', () => {
    // This is the proof the gate default is byte-for-byte unchanged: empty override set covers nothing.
    for (const reasons of [
      ['no_conflict_check'],
      ['check_stale_parties_changed'],
      ['undispositioned_blocker'],
      ['unconfirmed_client_party'],
      ['no_client_party'],
    ]) {
      const r = resolveGateAllowed({ state: 'NOT_ESTABLISHED', reasons }, none);
      expect(r.allowed).toBe(false);
      expect(r.blockingReasons).toEqual(reasons);
      expect(r.overriddenPreconditions).toEqual([]);
    }
  });

  it('an active override of the blocking precondition allows drafting (and is recorded as overridden)', () => {
    const r = resolveGateAllowed(
      { state: 'NOT_ESTABLISHED', reasons: ['unconfirmed_client_party'] },
      new Set(['identity']),
    );
    expect(r.allowed).toBe(true);
    expect(r.blockingReasons).toEqual([]);
    expect(r.overriddenPreconditions).toEqual(['identity']);
  });

  it('a BLOCKED (undispositioned blocker) matter is allowed by an active conflicts override', () => {
    const r = resolveGateAllowed({ state: 'BLOCKED', reasons: ['undispositioned_blocker'] }, new Set(['conflicts']));
    expect(r.allowed).toBe(true);
    expect(r.overriddenPreconditions).toEqual(['conflicts']);
  });

  it('an override of the WRONG precondition does NOT unblock', () => {
    const r = resolveGateAllowed(
      { state: 'NOT_ESTABLISHED', reasons: ['unconfirmed_client_party'] },
      new Set(['conflicts']),
    );
    expect(r.allowed).toBe(false);
    expect(r.blockingReasons).toEqual(['unconfirmed_client_party']);
  });

  it('a synthetic/error reason can NEVER be overridden (fail-closed on evaluation error)', () => {
    const r = resolveGateAllowed(
      { state: 'NOT_ESTABLISHED', reasons: ['clearance_evaluation_failed'] },
      new Set(['conflicts', 'identity']),
    );
    expect(r.allowed).toBe(false);
    expect(r.blockingReasons).toEqual(['clearance_evaluation_failed']);
  });

  // The per-precondition guarantee: when BOTH preconditions fail (the non-short-circuiting evaluator
  // reports both), an override of ONE must NOT mask the other. This is the defect the review caught.
  it('an override of ONE precondition does NOT unblock when the OTHER also fails', () => {
    const r = resolveGateAllowed(
      { state: 'NOT_ESTABLISHED', reasons: ['no_conflict_check', 'no_client_party'] },
      new Set(['conflicts']),
    );
    expect(r.allowed).toBe(false);
    expect(r.blockingReasons).toEqual(['no_client_party']);
    expect(r.overriddenPreconditions).toEqual(['conflicts']);
  });

  it('overriding BOTH failing preconditions unblocks (each attested separately)', () => {
    const r = resolveGateAllowed(
      { state: 'NOT_ESTABLISHED', reasons: ['no_conflict_check', 'no_client_party'] },
      new Set(['conflicts', 'identity']),
    );
    expect(r.allowed).toBe(true);
    expect(r.blockingReasons).toEqual([]);
    expect(r.overriddenPreconditions).toEqual(['conflicts', 'identity']);
  });
});

describe('CONFLICT-GATE-OVERRIDE-1: snapshot hashing drives RE-ARM (supersedes on material change)', () => {
  it('conflicts snapshot is order-independent over party ids (confirm/no-op does not re-arm)', () => {
    const a = hashSnapshot(canonicalConflictsSnapshot({ latestCheckId: 'c1', partyIds: ['p1', 'p2'] }));
    const b = hashSnapshot(canonicalConflictsSnapshot({ latestCheckId: 'c1', partyIds: ['p2', 'p1'] }));
    expect(a).toBe(b);
  });
  it('adding a party RE-ARMS the conflicts override (hash changes)', () => {
    const before = hashSnapshot(canonicalConflictsSnapshot({ latestCheckId: 'c1', partyIds: ['p1', 'p2'] }));
    const after = hashSnapshot(canonicalConflictsSnapshot({ latestCheckId: 'c2', partyIds: ['p1', 'p2', 'p3'] }));
    expect(after).not.toBe(before);
  });
  it('a fresh conflict check (new id) alone RE-ARMS even if the party set is unchanged', () => {
    const before = hashSnapshot(canonicalConflictsSnapshot({ latestCheckId: 'c1', partyIds: ['p1'] }));
    const after = hashSnapshot(canonicalConflictsSnapshot({ latestCheckId: 'c2', partyIds: ['p1'] }));
    expect(after).not.toBe(before);
  });
  it('identity snapshot is stable under reorder, but RE-ARMS when a client confirms or a client is added', () => {
    const base = hashSnapshot(
      canonicalIdentitySnapshot([
        { partyId: 'p2', confirmed: false, normalizedName: 'beta' },
        { partyId: 'p1', confirmed: false, normalizedName: 'acme' },
      ]),
    );
    const reordered = hashSnapshot(
      canonicalIdentitySnapshot([
        { partyId: 'p1', confirmed: false, normalizedName: 'acme' },
        { partyId: 'p2', confirmed: false, normalizedName: 'beta' },
      ]),
    );
    expect(reordered).toBe(base);
    const confirmedOne = hashSnapshot(
      canonicalIdentitySnapshot([
        { partyId: 'p1', confirmed: true, normalizedName: 'acme' },
        { partyId: 'p2', confirmed: false, normalizedName: 'beta' },
      ]),
    );
    expect(confirmedOne).not.toBe(base);
    const newClient = hashSnapshot(
      canonicalIdentitySnapshot([
        { partyId: 'p1', confirmed: false, normalizedName: 'acme' },
        { partyId: 'p2', confirmed: false, normalizedName: 'beta' },
        { partyId: 'p3', confirmed: false, normalizedName: 'gamma' },
      ]),
    );
    expect(newClient).not.toBe(base);
  });
});

describe('CONFLICT-GATE-OVERRIDE-1: enum values are kept in sync (schema.ts <-> shared zod)', () => {
  it('precondition + reason-code value arrays are identical in both sources', () => {
    expect([...SCHEMA_PRECONDITIONS]).toEqual([...SHARED_PRECONDITIONS]);
    expect([...SCHEMA_REASONS]).toEqual([...SHARED_REASONS]);
  });
});

describe('CONFLICT-GATE-OVERRIDE-1: wiring (additive; gate default fail-closed; no audit-enum migration)', () => {
  it('migration 0025 creates the gate_override table and ALTERS nothing (no audit_events touch)', () => {
    const mig = read('src/server/db/migrations/0025_conflict_gate_override_1_gate_override.sql');
    expect(mig).toContain('CREATE TABLE IF NOT EXISTS `gate_override`');
    expect(mig).not.toContain('audit_events');
    expect(mig).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  });
  it('the pre-deploy runner is registered (allowlist + expected-tables assertion)', () => {
    const runner = read('scripts/apply-prod-migrations.mjs');
    expect(runner).toContain("'0025_conflict_gate_override_1_gate_override.sql'");
    expect(runner).toContain("'gate_override'");
  });
  it('schema.ts defines the gate_override table', () => {
    const schema = read('src/server/db/schema.ts');
    expect(schema).toContain('export const gateOverride = mysqlTable(');
    expect(schema).toContain("'gate_override'");
  });
  it('the audit ledger REUSES eventType "disposition" — no new audit_events event type was added', () => {
    const auditSchema = read('src/shared/schemas/auditEvents.ts');
    expect(auditSchema).not.toContain('gate_override');
    const queries = read('src/server/db/queries/gateOverride.ts');
    expect(queries).toContain("eventType: 'disposition'");
    expect(queries).toContain('ownerScope(gateOverride.userId, userId)');
  });
  it('the create gate, export gate, and generation paths consult the posture-aware resolver (which wraps the override-aware resolver)', () => {
    // CONFLICT-TOGGLE-1 Inc 2 rewired these sites from resolveDraftingGate to resolvePostureDraftingGate.
    // INTENT preserved: the override-aware resolveDraftingGate is still consulted underneath (postureGate.ts
    // wraps it) — posture only governs whether the ABSENCE of clearance hard-blocks; a blocker still stops.
    expect(read('src/server/procedures/documents.ts')).toContain('resolvePostureDraftingGate(input.matterId, ctx.userId)');
    expect(read('src/server/index.ts')).toContain('resolvePostureDraftingGate(doc.matterId, userId)');
    const gen = read('src/server/procedures/documents4a.ts');
    expect(gen).toContain('resolvePostureDraftingGate(doc.matterId, userId)');
    expect(gen).toContain('recordDraftUnderOverride({');
    // the posture-aware resolver still consults the override-aware resolveDraftingGate underneath
    expect(read('src/server/conflicts/postureGate.ts')).toContain('resolveDraftingGate(matterId, userId)');
  });
  it('the gateOverride router is wired into the root app router', () => {
    expect(read('src/server/router.ts')).toContain('gateOverride: gateOverrideRouter');
  });
  it('resolveDraftingGate uses the NON-short-circuiting evaluateAllClearanceReasons (per-precondition safety)', () => {
    const conflicts = read('src/server/db/queries/conflicts.ts');
    expect(conflicts).toContain('export async function evaluateAllClearanceReasons');
    const queries = read('src/server/db/queries/gateOverride.ts');
    expect(queries).toContain('evaluateAllClearanceReasons(matterId, userId)');
    // the override record-guard also evaluates ALL preconditions (so either blocker is overridable)
    expect(read('src/server/procedures/gateOverride.ts')).toContain('evaluateAllClearanceReasons(input.matterId, ctx.userId)');
  });
  it('the new gate_override table is covered by purgeMatter (no orphan rows after a matter purge)', () => {
    expect(read('src/server/db/queries/matterPurge.ts')).toContain("step('gateOverride', gateOverride");
  });
});
