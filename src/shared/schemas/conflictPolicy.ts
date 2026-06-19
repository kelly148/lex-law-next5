/**
 * Conflict-clearance POSTURE policy (CONFLICT-TOGGLE-1) — Zod Wall + the pure, default-safe resolution.
 *
 * The disposition (docs/reviews/CONFLICT-TOGGLE-1_disposition.md) rejects a global on/off "slider" and
 * builds a FIRM-scoped conflicts *posture selector*. Three postures:
 *   - ENFORCED  — representational matters: the full CLEARED-only gate, mandatory + non-disableable.
 *   - ADVISORY  — transactional scrivener work (deed/POA): the check still RUNS + RECORDS and a positive
 *                 BLOCKER still hard-stops, but the absence of affirmative clearance does NOT hard-block.
 *   - SANDBOX   — internal/test/synthetic ONLY; visibly non-client; never a real client matter.
 *
 * INVARIANTS THIS MODULE ENCODES (the ethics-load-bearing core — reviewable in isolation):
 *   1. DEFAULT-SAFE / fail-closed (item 4): missing / null / malformed / unknown / reset / new-firm →
 *      ENFORCED. The system becomes LESS protective only through an explicit, audited, affirmative act —
 *      never through absence, reset, or error. Effective state = safety-max(default ENFORCED, persisted).
 *   2. FORCE-ON precedence (item 6): the server CONFLICT_GATE_FORCE_ON flag overrides ANY persisted
 *      relaxation — an admin floor the persisted policy can never drop below.
 *   3. Representational is non-disableable (items 1/2): the law_firm (representational) capacity is ALWAYS
 *      ENFORCED regardless of the firm policy. Only the transactional (title/settlement scrivener) capacity
 *      can carry an ADVISORY firm default.
 *
 * SCOPE FENCE (Increment 1): this is the DORMANT substrate — the policy shape + the pure resolver. NOTHING
 * reads the effective posture to change a gate transition yet (that wiring is a later, separately accept-
 * gated increment), so shipping this is byte-for-byte behavior-preserving. SANDBOX is enumerated forward-
 * safe but is a per-matter internal election introduced with the wiring, NOT a firm default.
 */

import { z } from 'zod';

// The three postures. ENFORCED is the safe floor; ADVISORY and SANDBOX are the only relaxations and are
// reachable solely through an explicit, audited act.
export const CONFLICT_POSTURE_VALUES = ['ENFORCED', 'ADVISORY', 'SANDBOX'] as const;
export type ConflictPosture = (typeof CONFLICT_POSTURE_VALUES)[number];
export const ConflictPostureSchema = z.enum(CONFLICT_POSTURE_VALUES);

/**
 * The firm-scoped conflicts policy (item 9: a structured object, never a boolean — a boolean cannot carry a
 * per-work-type posture). v1 carries the one relaxation the disposition authorizes: the firm's default
 * posture for TRANSACTIONAL (title/settlement scrivener) capacity. Representational (law_firm) is NOT a
 * field — it is non-disableable by construction (the resolver forces ENFORCED for it). SANDBOX is not a
 * firm default. Every field is defaulted so an absent/partial blob parses to the SAFE policy.
 */
export const ConflictPolicySchema = z.object({
  schemaVersion: z.literal(1).default(1),
  // Transactional (title_settlement_agent) capacity default posture. ENFORCED is the safe default; a firm
  // opts into ADVISORY explicitly (an audited relaxation). NOT 'SANDBOX' — sandbox is a per-matter internal
  // election, never a firm transactional default.
  transactionalPosture: z.enum(['ENFORCED', 'ADVISORY']).default('ENFORCED'),
});
export type ConflictPolicy = z.infer<typeof ConflictPolicySchema>;

/** The default-safe policy — what a firm with no persisted policy (or a malformed/failed read) resolves to. */
export const DEFAULT_CONFLICT_POLICY: ConflictPolicy = ConflictPolicySchema.parse({});

/**
 * Is `next` a RELAXATION relative to `prev`? (Used to require a typed reason + heavier audit on any move
 * that LOWERS protection.) Today the only relaxation axis is transactional ENFORCED → ADVISORY.
 */
export function isPolicyRelaxation(prev: ConflictPolicy, next: ConflictPolicy): boolean {
  return prev.transactionalPosture === 'ENFORCED' && next.transactionalPosture === 'ADVISORY';
}

export interface PostureResolutionInput {
  /** The firm's persisted policy, or null when there is none / it could not be safely parsed. */
  policy: ConflictPolicy | null;
  /** The matter's engagement capacity (matters.engagementCapacity). Anything other than the explicit
   *  transactional seat resolves ENFORCED (default-safe). */
  capacity: string | null | undefined;
  /** The server CONFLICT_GATE_FORCE_ON precedence flag. */
  forceOn: boolean;
}

export interface PostureResolution {
  posture: ConflictPosture;
  /** Why this posture was chosen (for audit / UI "effective source" surfacing). */
  source: 'force_on' | 'representational_or_default' | 'no_policy_default' | 'firm_policy';
}

/**
 * PURE, default-safe resolution of the effective posture for a matter. Order is the safety order:
 * force-on first (admin floor), then the non-disableable representational/unknown case, then the firm's
 * transactional election. Any ambiguity resolves ENFORCED.
 */
export function resolveEffectivePosture(input: PostureResolutionInput): PostureResolution {
  // (2) Server force-on is an absolute floor — overrides any persisted relaxation.
  if (input.forceOn) return { posture: 'ENFORCED', source: 'force_on' };

  // (3) Representational (law_firm) capacity is non-disableable. Also the default-safe answer for an
  // absent/unknown capacity — only the EXPLICIT transactional seat is eligible for relaxation.
  if (input.capacity !== 'title_settlement_agent') {
    return { posture: 'ENFORCED', source: 'representational_or_default' };
  }

  // (1) Transactional capacity: honor the firm's elected posture, default-safe ENFORCED if there is no
  // policy (or it failed to parse — the caller passes null in that case).
  if (!input.policy) return { posture: 'ENFORCED', source: 'no_policy_default' };
  return { posture: input.policy.transactionalPosture, source: 'firm_policy' };
}
