/**
 * CONFLICT-TOGGLE-1 (Inc 2) — the POSTURE-AWARE drafting gate.
 *
 * Composes the firm-scoped + per-matter conflicts POSTURE with the existing override-aware clearance gate
 * (resolveDraftingGate). The clearance check ALWAYS runs + records — advisory ≠ no-check (item 3). The
 * effective posture then decides whether the ABSENCE of affirmative clearance hard-blocks:
 *   - ENFORCED → the unchanged gate (block unless CLEARED or every blocking precondition is overridden).
 *   - ADVISORY → let the absence pass, but a positive BLOCKER still hard-stops.
 *   - SANDBOX  → internal/non-client; allow regardless (SANDBOX matters are gated elsewhere to test only).
 * Auto-escalation (item 10) forces ENFORCED when a disqualifier is detected (adverse party / multiple
 * represented / blocker). evaluateConflictClearance is NEVER touched; this is a pure composition on top.
 *
 * FAIL-CLOSED throughout: every input read is defensive — a read failure resolves the input to its safe
 * value (no policy / no capacity / no election / no parties), all of which drive the resolver to ENFORCED.
 *
 * GATING: callers consult this only inside their existing `if (isConflictGateEnabled())` branch, so with the
 * flag OFF (prod) every transition keeps its legacy path byte-for-byte (this wrapper is never reached).
 */

import { resolveDraftingGate, type DraftingGateResult } from '../db/queries/gateOverride.js';
import { getFirmConflictPolicy, getMatterConflictPosture } from '../db/queries/conflictPolicy.js';
import { getMatterById } from '../db/queries/matters.js';
import { listPartiesForMatter } from '../db/queries/matterParties.js';
import { isConflictGateForceOn } from '../config/featureFlags.js';
import {
  resolveMatterEffectivePosture,
  detectAutoEscalation,
  applyPostureToGate,
  type ConflictPolicy,
  type ConflictPosture,
  type MatterPostureSource,
  type PostureGateMode,
} from '../../shared/schemas/conflictPolicy.js';

export interface PostureGateResult {
  allowed: boolean;
  posture: ConflictPosture;
  postureSource: MatterPostureSource;
  mode: PostureGateMode;
  /** Reasons that BLOCK under the effective posture (empty IFF allowed). */
  blockingReasons: string[];
  /** Non-blocker reasons that ADVISORY/SANDBOX let pass (recorded for the advisory trail). */
  bypassedReasons: string[];
  autoEscalationTriggers: string[];
  /** The underlying override-aware clearance result (provenance for the banner / audit). */
  base: DraftingGateResult;
}

export async function resolvePostureDraftingGate(matterId: string, userId: string): Promise<PostureGateResult> {
  // The clearance check ALWAYS runs + records (fail-closed inside resolveDraftingGate).
  const base = await resolveDraftingGate(matterId, userId);

  // Effective-posture inputs — each read defensively; a failure resolves to the safe value (→ ENFORCED).
  let capacity: string | null | undefined = null;
  let partyRoles: string[] = [];
  let clientPartyCount = 0;
  let electedPosture: ConflictPosture | null = null;
  let firmPolicy: ConflictPolicy | null = null;
  try {
    const matter = await getMatterById(matterId, userId);
    capacity = matter?.engagementCapacity ?? null;
  } catch {
    capacity = null;
  }
  try {
    const parties = await listPartiesForMatter(matterId, userId);
    partyRoles = parties.map((p) => p.role);
    clientPartyCount = parties.filter((p) => p.role === 'client').length;
  } catch {
    partyRoles = [];
    clientPartyCount = 0;
  }
  try {
    electedPosture = await getMatterConflictPosture(matterId, userId);
  } catch {
    electedPosture = null;
  }
  try {
    firmPolicy = (await getFirmConflictPolicy(userId)).policy;
  } catch {
    firmPolicy = null;
  }

  const auto = detectAutoEscalation({ partyRoles, clientPartyCount, clearanceState: base.clearance.state });
  const { posture, source } = resolveMatterEffectivePosture({
    firmPolicy,
    capacity,
    electedPosture,
    forceOn: isConflictGateForceOn(),
    autoEscalate: auto.escalate,
  });

  const outcome = applyPostureToGate({
    posture,
    clearanceState: base.clearance.state,
    baseAllowed: base.allowed,
    blockingReasons: base.blockingReasons,
  });

  const blockingReasons = outcome.allowed
    ? []
    : outcome.mode === 'advisory_blocker'
      ? ['undispositioned_blocker']
      : base.blockingReasons;

  return {
    allowed: outcome.allowed,
    posture,
    postureSource: source,
    mode: outcome.mode,
    blockingReasons,
    bypassedReasons: outcome.bypassedReasons,
    autoEscalationTriggers: auto.triggers,
    base,
  };
}
