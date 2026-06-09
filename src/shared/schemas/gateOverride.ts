/**
 * Zod schema for the gate_override table — CONFLICT-GATE-OVERRIDE-1.
 *
 * Ch 35.1 Zod Wall: every read of gate_override parses through this schema.
 *
 * gate_override is an APPEND-ONLY record of an attorney attesting an override of ONE fail-closed drafting
 * precondition (conflicts clearance OR party identity verification) for ONE matter. The gate DEFAULT is
 * unchanged — this records an explicit attorney act the gate consults, never a global toggle. snapshot /
 * snapshotHash bind the override to the precondition STATE at attestation; a material change re-arms it
 * (the current state's hash no longer matches the stored hash) — the same "supersedes on change" pattern
 * as sendability_override.contentHash.
 *
 * Enum literals are inlined here (repo convention, mirroring SendabilityOverrideRowSchema); the Drizzle
 * column enums live in schema.ts (GATE_OVERRIDE_PRECONDITION_VALUES / GATE_OVERRIDE_REASON_CODE_VALUES)
 * and are kept in sync by hand (a guard test pins the two arrays equal).
 */

import { z } from 'zod';

// The two fail-closed drafting preconditions the gate enforces. An override is attested PER precondition.
export const GATE_OVERRIDE_PRECONDITION_VALUES = ['conflicts', 'identity'] as const;

// One-line reason quick-picks. The four named codes are self-describing (a non-empty reason); 'other'
// requires accompanying reasonText (enforced at the procedure) so there is never an empty reason.
export const GATE_OVERRIDE_REASON_CODE_VALUES = [
  'cleared_out_of_band',
  'verified_out_of_band',
  'waived_professional_judgment',
  'testing',
  'other',
] as const;

export const GateOverrideRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  precondition: z.enum(GATE_OVERRIDE_PRECONDITION_VALUES),
  // The gate-state snapshot at attestation time (the re-arm comparison key). Free-form JSON parsed at the
  // Zod Wall; its canonical shape is built by src/server/conflicts/gateOverride.ts.
  snapshot: z.unknown(),
  // SHA-256 hex of the canonical snapshot; active IFF it equals the CURRENT precondition state's hash.
  snapshotHash: z.string(),
  reasonCode: z.enum(GATE_OVERRIDE_REASON_CODE_VALUES),
  reasonText: z.string().nullable(),
  createdAt: z.date(),
});

export type GateOverrideRow = z.infer<typeof GateOverrideRowSchema>;
export type GateOverridePrecondition = (typeof GATE_OVERRIDE_PRECONDITION_VALUES)[number];
export type GateOverrideReasonCode = (typeof GATE_OVERRIDE_REASON_CODE_VALUES)[number];
