/**
 * Practice-memo access gate — FOLD-KB-1 (Fork B/F).
 *
 * THE confidentiality boundary for the knowledge base, STRICTER than the FOLD-L1-4
 * reusable-artifact gate: firm-wide reuse REQUIRES abstraction (not a mere per-use opt-in).
 * Surfacing and invocation are gated IDENTICALLY (Fork F — close the surfacing side-door):
 * a raw / matter_only memo may surface or be invoked ONLY in its origin matter; only an
 * abstracted, firm-wide memo crosses matters; a firm-level (not client-derived) memo is
 * always allowed.
 *
 * evaluateMemoAccess() is PURE and exhaustively unit-tested. formatCurrencyWarning() is PURE
 * and renders a SPECIFIC staleness line from the memo's own metadata — it NEVER computes a
 * fresh/stale boolean from age alone (Fork C named change).
 */

import type { MemoAccessDecision, PracticeMemoRow } from '../../shared/schemas/practiceKb.js';

/**
 * Decide whether a memo may be surfaced/invoked into a target context.
 * targetMatterId === null means a cross-matter / firm-wide context (e.g. a firm-wide
 * browse) — never the memo's origin, so it is treated as cross-matter.
 */
export function evaluateMemoAccess(params: {
  memo: Pick<PracticeMemoRow, 'originMatterId' | 'reuseScope' | 'abstractionStatus'>;
  targetMatterId: string | null;
}): MemoAccessDecision {
  const { memo, targetMatterId } = params;

  // Firm-level (not client-derived): no cross-matter contamination risk by origin.
  if (memo.originMatterId === null) {
    return { allowed: true, crossMatter: false, reason: 'firm_level' };
  }
  // Same matter as origin: always allowed (not cross-matter).
  if (targetMatterId !== null && memo.originMatterId === targetMatterId) {
    return { allowed: true, crossMatter: false, reason: 'origin_matter' };
  }
  // Cross-matter from here down (different matter, or a firm-wide/null context).
  if (memo.reuseScope !== 'firm_wide') {
    return { allowed: false, crossMatter: true, reason: 'blocked_matter_only' };
  }
  if (memo.abstractionStatus !== 'abstracted') {
    // Defense in depth: promotion is gated on abstraction, so this should not occur — but
    // a firm-wide-yet-raw memo must never cross a matter boundary.
    return { allowed: false, crossMatter: true, reason: 'blocked_not_abstracted' };
  }
  return { allowed: true, crossMatter: true, reason: 'firm_wide_abstracted' };
}

/**
 * A SPECIFIC, unavoidable currency warning rendered from the memo's own metadata — shown at
 * surfacing AND at adoption (Fork C). Names the law-relied-on + the discrete verification
 * status; does NOT infer freshness from age. A memo with a legal conclusion but no recorded
 * authority is flagged as uncheckable.
 */
export function formatCurrencyWarning(
  memo: Pick<
    PracticeMemoRow,
    'verificationStatus' | 'verifiedThroughDate' | 'lawReliedOn' | 'jurisdiction'
  >,
): string {
  const statusLabel: Record<PracticeMemoRow['verificationStatus'], string> = {
    unverified: 'NOT re-verified',
    attorney_verified_current: 'attorney-verified current',
    stale: 'flagged STALE',
    superseded: 'SUPERSEDED',
    not_legal_authority: 'not a legal authority (secondary)',
  };

  const authorities = (memo.lawReliedOn ?? [])
    .map((a) => {
      const eff = a.effectiveDate ? ` (as of ${a.effectiveDate})` : '';
      return `${a.jurisdiction} ${a.citationOrSource}${eff}`;
    })
    .filter((s) => s.trim().length > 0);

  const reliesOn =
    authorities.length > 0
      ? `Relies on ${authorities.join('; ')}`
      : 'No authority recorded — this memo is uncheckable until its law-relied-on is added';

  const through = memo.verifiedThroughDate
    ? `; verified through ${memo.verifiedThroughDate.toISOString().slice(0, 10)}`
    : '';

  const secondary =
    memo.verificationStatus === 'not_legal_authority'
      ? ' — secondary authority, never operative law'
      : '';

  return `${reliesOn}. Status: ${statusLabel[memo.verificationStatus]}${through}${secondary}. Re-verify against current law before any outbound use.`;
}
