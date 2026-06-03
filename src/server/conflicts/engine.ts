/**
 * Conflicts-at-intake matching engine — FOLD-L0-1 (Fork A + Fork G).
 *
 * PURE + DETERMINISTIC. NO LLM, no I/O — given this matter's parties and every OTHER owned
 * matter's parties, it computes conflict hits with a severity and a human-readable
 * matchBasis (WHY the hit appeared). This is the ethics-critical core and is exhaustively
 * unit-tested. The DB-side, owner-scoped gathering of the inputs lives in the query layer
 * (conflicts.ts); cross-matter conflict-hit details are NEVER sent to an LLM (Fork G).
 *
 * Severity (triad disposition, Fork A):
 *   BLOCKER = the same normalized party is CLIENT in one matter and ADVERSE in another
 *             (the client-here / adverse-there crossing). [MVP also covers this for the
 *             "same entity, opposing posture" case via role; "plausible prior representation
 *             in a substantially related matter" is BEYOND name-only MVP — see the
 *             false-negative disclosure shown at the disposition surface.]
 *   REVIEW  = same client in another matter with no adverse role; a related/other role
 *             match; or any weaker/partial name match.
 *
 * MVP scope (held): exact + normalized NAME matching across the owner's matters only. The
 * fix for its limits is DISCLOSURE (CONFLICT_FALSE_NEGATIVE_DISCLOSURE), not expanded
 * matching — fuzzy/entity/alias detection is a deliberate follow-on.
 */

import type { ComputedConflictHit } from '../../shared/schemas/layer0.js';

export interface PartyLite {
  id: string;
  matterId: string;
  role: 'client' | 'adverse' | 'related' | 'other';
  displayName: string;
  normalizedName: string;
}

/**
 * Canonical match key: lowercase, Unicode-normalize, strip punctuation, collapse
 * whitespace. Deterministic and stable. (Two parties "conflict-match" iff their
 * normalizedName is equal and non-empty.)
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute conflict hits for one matter against all other matters' parties.
 * `thisParties` = the parties of the matter being checked; `otherParties` = parties from
 * every OTHER owned matter (the caller must pre-filter to the same owner and exclude the
 * matter being checked). Returns one hit per (thisParty × matchedOtherParty) name match.
 */
export function computeConflictHits(
  thisParties: ReadonlyArray<PartyLite>,
  otherParties: ReadonlyArray<PartyLite>,
): ComputedConflictHit[] {
  const byNorm = new Map<string, PartyLite[]>();
  for (const p of otherParties) {
    if (!p.normalizedName) continue;
    const arr = byNorm.get(p.normalizedName);
    if (arr) arr.push(p);
    else byNorm.set(p.normalizedName, [p]);
  }

  const hits: ComputedConflictHit[] = [];
  for (const tp of thisParties) {
    if (!tp.normalizedName) continue;
    const matches = byNorm.get(tp.normalizedName);
    if (!matches) continue;
    for (const mp of matches) {
      const exact = tp.displayName.trim().toLowerCase() === mp.displayName.trim().toLowerCase();
      const matchType = exact ? 'party_exact' : 'party_normalized';
      const opposing =
        (tp.role === 'client' && mp.role === 'adverse') ||
        (tp.role === 'adverse' && mp.role === 'client');

      let severity: 'blocker' | 'review';
      let matchBasis: string;
      if (opposing) {
        severity = 'blocker';
        matchBasis =
          tp.role === 'client'
            ? `"${tp.displayName}" is your CLIENT in this matter but ADVERSE in matter ${mp.matterId} — client-here / adverse-there crossing.`
            : `"${tp.displayName}" is ADVERSE in this matter but your CLIENT in matter ${mp.matterId} — adverse-here / client-there crossing.`;
      } else if (tp.role === 'client' && mp.role === 'client') {
        severity = 'review';
        matchBasis = `Same client "${tp.displayName}" also appears in matter ${mp.matterId} (no adverse role) — review.`;
      } else {
        severity = 'review';
        matchBasis = `Name match "${tp.displayName}" (${tp.role} here / ${mp.role} in matter ${mp.matterId}) — review.`;
      }

      hits.push({
        thisPartyId: tp.id,
        thisPartyName: tp.displayName,
        thisRole: tp.role,
        matchedMatterId: mp.matterId,
        matchedPartyId: mp.id,
        matchedRole: mp.role,
        matchType,
        severity,
        matchBasis,
      });
    }
  }
  return hits;
}

/** True if any hit is a BLOCKER (used by the hard-block gate). */
export function hasBlocker(hits: ReadonlyArray<{ severity: string }>): boolean {
  return hits.some((h) => h.severity === 'blocker');
}

/**
 * Fork A — a BLOCKER-severity hit REQUIRES a recorded rationale to disposition (empty
 * "cleared" is not allowed; the RPC-defense record). Pure rule; the throw lives in the
 * query layer.
 */
export function dispositionNeedsRationale(severity: string): boolean {
  return severity === 'blocker';
}
