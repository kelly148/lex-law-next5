/**
 * KB retention policy on origin-matter deletion — FOLD-KB-1 Increment 3 (operator decision #1,
 * retention-posture doc §5). PURE and authoritative.
 *
 * Decision: ABSTRACTED memos OUTLIVE their origin matter's deletion — conditional on the
 * attorney-attested de-identification (recorded via abstractionAttestedByEventId) and the
 * owner-only provenance link (abstractedFromMemoId) retained for remediation. RAW / matter_only
 * memos are deleted WITH the origin matter (they carry that matter's client-confidential facts).
 *
 * ENFORCEMENT wiring lands when a matter hard-deletion / PERSIST-1 retention-enforcement path
 * exists (none today — the app archives, it does not hard-delete matters). This function is the
 * rule that path will call; it is encoded + tested now so the policy is fixed, not re-derived.
 */

import type { PracticeMemoRow } from '../../shared/schemas/practiceKb.js';

/** True if the memo survives deletion of its origin matter (abstracted memos survive). */
export function memoSurvivesMatterDeletion(memo: Pick<PracticeMemoRow, 'abstractionStatus'>): boolean {
  return memo.abstractionStatus === 'abstracted';
}

/**
 * Partition a matter's origin memos into those to DELETE (raw / not abstracted) and those to
 * RETAIN (abstracted, de-identified) when the origin matter is deleted.
 */
export function partitionMemosForMatterDeletion<T extends Pick<PracticeMemoRow, 'abstractionStatus'>>(
  memos: T[],
): { retain: T[]; delete: T[] } {
  const retain: T[] = [];
  const del: T[] = [];
  for (const m of memos) {
    if (memoSurvivesMatterDeletion(m)) retain.push(m);
    else del.push(m);
  }
  return { retain, delete: del };
}
