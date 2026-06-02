/**
 * Retention service (FOLD-PERSIST-1) — minimal, default-safe.
 *
 * Leverages the EXISTING soft-delete/archive on the matter-state spine
 * (matters.archivedAt, documents.archivedAt, matter_materials.deletedAt). It adds
 * NO destructive capability:
 *   - purge-eligibility is read-only/advisory and returns POLICY_PENDING while
 *     retention values await attorney sign-off;
 *   - any hard-delete must pass an explicit operator confirmation token and is
 *     intentionally NOT implemented here (no destructive SQL) — actual purge is
 *     deferred to a future operator-approved cleanup engagement. Hard-delete is
 *     NEVER auto-run and is excluded from auto-advance (CLAUDE.md Rule 14).
 */

import { RETENTION_POLICY, isPolicySignedOff, type DataClass } from '../config/retentionPolicy.js';

/** The only value that satisfies the hard-delete guard; supplied by an operator, never auto. */
export const HARD_DELETE_OPERATOR_TOKEN = 'OPERATOR_CONFIRMED_HARD_DELETE';

export interface PurgeEligibility {
  status: 'POLICY_PENDING' | 'READY';
  reason: string;
  policy: typeof RETENTION_POLICY;
}

/** Advisory, read-only. Mutates and deletes nothing. */
export function describePurgeEligibility(): PurgeEligibility {
  if (!isPolicySignedOff()) {
    return {
      status: 'POLICY_PENDING',
      reason:
        'Retention periods are PENDING ATTORNEY SIGN-OFF; no purge eligibility is computed until values are signed off.',
      policy: RETENTION_POLICY,
    };
  }
  return { status: 'READY', reason: 'Policy signed off; eligibility computable.', policy: RETENTION_POLICY };
}

/**
 * Guard for ANY hard-delete. Throws unless an explicit operator confirmation token
 * is supplied, the class is deletable, and the retention policy is signed off.
 * Contains NO destructive SQL by design — it only validates approval. The actual
 * purge is a future operator-approved engagement.
 */
export function assertHardDeleteApproved(
  confirmation: string | undefined,
  dataClass: DataClass,
): void {
  if (confirmation !== HARD_DELETE_OPERATOR_TOKEN) {
    throw new Error(
      `HARD_DELETE_REQUIRES_OPERATOR_APPROVAL: hard-delete of ${dataClass} needs explicit operator confirmation and is never auto-run.`,
    );
  }
  if (RETENTION_POLICY[dataClass].deletable === false) {
    throw new Error(`HARD_DELETE_FORBIDDEN: ${dataClass} is permanent (not deletable).`);
  }
  if (!isPolicySignedOff()) {
    throw new Error('HARD_DELETE_BLOCKED: retention policy is PENDING ATTORNEY SIGN-OFF.');
  }
  // No destructive SQL here — actual purge is deferred to a future operator-approved engagement.
}
