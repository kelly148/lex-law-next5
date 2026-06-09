/**
 * CONFLICT-GATE-OVERRIDE-1 — PURE override-resolution + snapshot-canonicalization logic.
 *
 * No DB, no LLM, no I/O — every export here is a pure function (mirrors src/server/conflicts/engine.ts).
 * This is where the load-bearing decisions are unit-tested (CI has no test DB): which precondition a
 * gate reason belongs to, whether an override-equipped matter is allowed to draft, and the deterministic
 * canonical snapshot whose hash drives RE-ARM.
 *
 * The gate DEFAULT stays fail-closed: resolveGateAllowed never returns allowed=true for a non-CLEARED
 * matter unless EVERY blocking reason's precondition has an active override. An empty override set covers
 * nothing — identical to the bare clearance gate.
 */

import { createHash } from 'node:crypto';
import {
  GATE_OVERRIDE_PRECONDITION_VALUES,
  type GateOverridePrecondition,
} from '../../shared/schemas/gateOverride.js';

// Reason -> precondition map. These literals MIRROR the reason codes emitted by evaluateConflictClearance
// (src/server/db/queries/conflicts.ts): conflicts-clearance reasons vs identity-verification reasons. A
// reason with no mapping (e.g. 'clearance_evaluation_failed') belongs to NO precondition and is therefore
// never coverable by an override — it always blocks (fail-closed).
export const CONFLICTS_GATE_REASONS = [
  'no_conflict_check',
  'check_stale_parties_changed',
  'undispositioned_blocker',
] as const;
export const IDENTITY_GATE_REASONS = ['unconfirmed_client_party', 'no_client_party'] as const;

export function preconditionForReason(reason: string): GateOverridePrecondition | null {
  if ((CONFLICTS_GATE_REASONS as readonly string[]).includes(reason)) return 'conflicts';
  if ((IDENTITY_GATE_REASONS as readonly string[]).includes(reason)) return 'identity';
  return null;
}

/** The distinct preconditions a set of clearance reasons is currently blocking on (stable order). */
export function blockingPreconditionsForReasons(reasons: readonly string[]): GateOverridePrecondition[] {
  return GATE_OVERRIDE_PRECONDITION_VALUES.filter((pc) =>
    reasons.some((r) => preconditionForReason(r) === pc),
  );
}

export interface ClearanceLike {
  state: string;
  reasons: readonly string[];
}

export interface GateAllowedResult {
  allowed: boolean;
  /** The reasons NOT covered by an active override — empty IFF allowed. */
  blockingReasons: string[];
  /** The preconditions whose blocking reasons were suppressed by an active override. */
  overriddenPreconditions: GateOverridePrecondition[];
}

/**
 * Decide whether a matter may draft given its clearance result and the set of preconditions that currently
 * have an ACTIVE (snapshot-current) attested override. CLEARED is always allowed (no override consulted).
 * Otherwise a reason is suppressed only when its precondition has an active override; allowed IFF every
 * blocking reason is suppressed. PURE.
 */
export function resolveGateAllowed(
  clearance: ClearanceLike,
  activeOverridePreconditions: ReadonlySet<GateOverridePrecondition>,
): GateAllowedResult {
  if (clearance.state === 'CLEARED') {
    return { allowed: true, blockingReasons: [], overriddenPreconditions: [] };
  }
  const blockingReasons: string[] = [];
  const overridden = new Set<GateOverridePrecondition>();
  for (const reason of clearance.reasons) {
    const pc = preconditionForReason(reason);
    if (pc !== null && activeOverridePreconditions.has(pc)) overridden.add(pc);
    else blockingReasons.push(reason);
  }
  return {
    allowed: blockingReasons.length === 0,
    blockingReasons,
    overriddenPreconditions: GATE_OVERRIDE_PRECONDITION_VALUES.filter((pc) => overridden.has(pc)),
  };
}

// ── Canonical snapshots (the RE-ARM key) ────────────────────────────────────────────────────────────
// Deterministic JSON over the precondition STATE at attestation. The hash of this canonical form binds the
// override: when the current state's hash differs, the override is re-armed (no longer active). PURE —
// callers pass already-fetched data so this stays testable without a DB.

export interface ConflictsSnapshotInput {
  latestCheckId: string | null;
  partyIds: readonly string[];
}
export interface ConflictsSnapshot {
  precondition: 'conflicts';
  latestCheckId: string | null;
  partyIds: string[];
}

/**
 * Conflicts snapshot = the latest check id + the matter's party-id set (sorted). These are exactly the
 * signals the shared "re-run conflicts on party add" hook moves: adding a party mints a new check id AND
 * changes the party-id set, so the hash changes and the conflicts override re-arms. Running a fresh check
 * (new id) also re-arms. Confirming a party does NOT change either, so it does not spuriously re-arm.
 */
export function canonicalConflictsSnapshot(input: ConflictsSnapshotInput): ConflictsSnapshot {
  return {
    precondition: 'conflicts',
    latestCheckId: input.latestCheckId,
    partyIds: [...input.partyIds].sort(),
  };
}

export interface IdentityClientParty {
  partyId: string;
  confirmed: boolean;
  normalizedName: string;
}
export interface IdentitySnapshot {
  precondition: 'identity';
  clientParties: IdentityClientParty[];
}

/**
 * Identity snapshot = the matter's client parties' identity state ({ partyId, confirmed, normalizedName },
 * sorted by partyId). A material identity change — a new client party, a client party soft-deleted, a
 * (future) un-confirm or rename — changes this canonical form and re-arms the identity override.
 * updatedAt is intentionally excluded (it auto-bumps on unrelated touches and would false-positive).
 */
export function canonicalIdentitySnapshot(clientParties: readonly IdentityClientParty[]): IdentitySnapshot {
  const sorted = clientParties
    .map((p) => ({ partyId: p.partyId, confirmed: p.confirmed === true, normalizedName: p.normalizedName }))
    .sort((a, b) => (a.partyId < b.partyId ? -1 : a.partyId > b.partyId ? 1 : 0));
  return { precondition: 'identity', clientParties: sorted };
}

/** SHA-256 hex of the canonical snapshot's deterministic JSON (the re-arm comparison key). PURE. */
export function hashSnapshot(canonical: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}
