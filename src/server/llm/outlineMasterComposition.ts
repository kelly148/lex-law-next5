/**
 * outlineMasterComposition.ts — INSTR-2C (Phase C): master injection for the OUTLINE role ONLY.
 *
 * outline_generation is the single judgment-bearing non-draft role enabled in INSTR-2C v1 (analysis +
 * matrix are deferred; reviewer/evaluator are permanently/structurally excluded by the R1 allowlist).
 * This module is OUTLINE'S OWN stricter predicate (R9) over the shared masterCompositionPrimitives —
 * NOT a shared selector. It mirrors the CHAT-INJ-1 discipline:
 *
 *   R3  the matter must be the EXPLICIT representational law_firm seat — ambiguous / unelected / NULL
 *       capacity -> neutral; NEVER the drafting "safe default to lawfirm".
 *   R4  a title/settlement matter (capacity title OR a title signal in the practice area) -> neutral;
 *       the title posture is NOT applied in outline v1 (the settlement-agent role is non-representational).
 *   R5  inject only when the EXISTING conflicts/identity gate is CLEARED (resolveDraftingGate.allowed,
 *       fail-closed). Non-circular: outline is downstream of clearance. Missing/pending/stale/failed/
 *       ambiguous -> legacy.
 *   R6  the non-suppressible internal-planning-scaffold addendum is placed as a PRECEDENCE FLOOR (first,
 *       so it governs — not append-last). A post-assembly assertion (canonicalMutation) re-verifies it
 *       verbatim and fail-closes if it is ever missing.
 *
 * The flag (MASTER_OUTLINE_ENABLED) and the model/matterId guards are checked by the caller
 * (resolvePromptComposition) BEFORE this resolver runs, so flag-OFF never reaches here (R7: zero reads).
 */

import { getPromptAsset } from './promptAssets.js';
import {
  hasTitleSignal,
  isRepresentationalLawFirmCapacity,
  selectRepresentationalMaster,
  type CompositionMatter,
  type RepresentationalMaster,
} from './masterCompositionPrimitives.js';

/**
 * R6 — the non-suppressible outline addendum, VERBATIM per the locked spec. Exported so both the
 * composition (which prepends it as the precedence floor) and the canonicalMutation post-assembly
 * assertion reference the SAME string; a paraphrase would fail the assertion.
 */
export const OUTLINE_ADDENDUM =
  'This output is an internal planning scaffold only, intended solely for attorney review, editing, and explicit approval. It is not a client-facing draft, does not constitute legal advice, and must not be sent or exported to any client or third party.';

/** A logical master an outline turn may compose, or 'neutral' (legacy, no master). NEVER title (R4). */
export type OutlineMasterSource = RepresentationalMaster | 'neutral';

/**
 * Discriminated on `inject`: an injected decision carries a representational master + the layered text
 * (never 'neutral'); a non-injected decision is always 'neutral'/null. This lets the caller narrow the
 * source to a MasterSource after checking `inject` (no cast).
 */
export type OutlineMasterDecision =
  | {
      inject: true;
      source: RepresentationalMaster;
      layeredMasterText: string;
      assetSha256: string;
      reason: string;
    }
  | {
      inject: false;
      source: 'neutral';
      layeredMasterText: null;
      assetSha256: null;
      reason: string;
    };

/** The injected (inject: true) variant — source is a representational master and the layered text is set. */
export type OutlineInjectedDecision = Extract<OutlineMasterDecision, { inject: true }>;

const NEUTRAL: OutlineMasterDecision = {
  inject: false,
  source: 'neutral',
  layeredMasterText: null,
  assetSha256: null,
  reason: 'neutral',
};

export type OutlinePreGateResult =
  | { candidate: false; reason: string }
  | { candidate: true; source: RepresentationalMaster };

/**
 * PURE pre-gate (R3/R4) — outline's own stricter predicate, EXCEPT the async conflict-gate read.
 * Ambiguous / unelected / NULL / title -> neutral; NEVER the safe-default-to-lawfirm of drafting. The
 * gate (R5) is left to the async resolver so it runs LAST and never for a non-candidate (R7).
 */
export function decideOutlinePreGate(matter: CompositionMatter | null | undefined): OutlinePreGateResult {
  if (matter == null) return { candidate: false, reason: 'no_matter' }; // R3 fail-closed
  // R3 + R4: must be the EXPLICIT representational law_firm seat. A missing/unknown capacity, or the
  // title/settlement seat, is NOT representational -> neutral (never the drafting default-to-lawfirm).
  if (!isRepresentationalLawFirmCapacity(matter.engagementCapacity)) {
    return { candidate: false, reason: 'capacity_not_representational' };
  }
  // R4: a title signal in the practice area, on the law_firm seat, is an unresolved/mixed signal -> neutral.
  if (hasTitleSignal(matter)) return { candidate: false, reason: 'title_signal' };
  return { candidate: true, source: selectRepresentationalMaster(matter) };
}

/**
 * R6 — build the injected master block with the addendum as a PRECEDENCE FLOOR: the addendum is FIRST
 * (the master text follows), so within the outermost layered block it is the very first instruction.
 * (canonicalMutation re-asserts the addendum verbatim in the final system block and fail-closes if
 * it is ever missing.)
 */
export function finalizeOutlineInjection(source: RepresentationalMaster): OutlineInjectedDecision {
  const asset = getPromptAsset(source);
  const layeredMasterText = `${OUTLINE_ADDENDUM}\n\n${asset.text}`;
  return { inject: true, source, layeredMasterText, assetSha256: asset.sha256, reason: 'outline_injected' };
}

// ── Conflicts/identity gate reader (R5) — test seam ───────────────────────────────────────────────
// Defaults to resolveDraftingGate (the override-aware, fail-closed pass-state drafting uses — the
// EXISTING gate, not a reimplementation). Overridable for unit tests so the predicate runs without a DB.

export type OutlineGateReader = (matterId: string, userId: string) => Promise<{ allowed: boolean }>;

let _gateReader: OutlineGateReader | null = null;

/** Test seam: override the conflicts-gate reader. Pass null to restore the real query. */
export function setOutlineGateReader(reader: OutlineGateReader | null): void {
  _gateReader = reader;
}

async function getGateReader(): Promise<OutlineGateReader> {
  if (_gateReader !== null) return _gateReader;
  // Lazy import so this module never pulls the DB connection into pure-test contexts.
  const gate = await import('../db/queries/gateOverride.js');
  return (matterId, userId) => gate.resolveDraftingGate(matterId, userId);
}

/**
 * Async resolver: pre-gate (pure) -> if a candidate, read the EXISTING conflict gate (R5, fail-closed)
 * -> finalize with the addendum floor (R6). Reached ONLY for an enabled outline candidate (the caller
 * checks MASTER_OUTLINE_ENABLED + the model/matterId guards first), so flag-OFF never calls it (R7).
 * The gate is read for EXACTLY the bound matter (current-matter scope only).
 */
export async function resolveOutlineMaster(args: {
  matterId: string;
  userId: string;
  matter: CompositionMatter | null | undefined;
}): Promise<OutlineMasterDecision> {
  const pre = decideOutlinePreGate(args.matter);
  if (!pre.candidate) return { ...NEUTRAL, reason: pre.reason };

  let allowed = false;
  try {
    const reader = await getGateReader();
    allowed = (await reader(args.matterId, args.userId)).allowed === true;
  } catch {
    allowed = false; // R5 fail-closed: an evaluation error never opens the gate.
  }
  if (!allowed) return { ...NEUTRAL, reason: 'gate_not_cleared' };

  return finalizeOutlineInjection(pre.source);
}
