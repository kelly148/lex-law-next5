/**
 * Proactive memo surfacing — FOLD-KB-1 Increment 2 (Fork F).
 *
 * MVP is DETERMINISTIC and owner-scoped (semantic retrieval deferred). Candidates are gated
 * IDENTICALLY to invocation (the abstraction-required access gate) and matched conservatively
 * (over-surfacing trains dismissal). A surfaced candidate carries a SPECIFIC currency warning
 * and intentionally OMITS originMatterId (provenance is owner-only drill-down elsewhere).
 */

import { listMemosForOriginMatter, listFirmWideReusableMemos } from '../db/queries/practiceMemos.js';
import { evaluateMemoAccess, formatCurrencyWarning } from './gate.js';
import type { PracticeMemoRow } from '../../shared/schemas/practiceKb.js';

export interface MemoSurfaceQuery {
  practiceArea?: string | null;
  jurisdiction?: string | null;
  tags?: string[];
}

export interface SurfacedMemo {
  memoId: string;
  title: string;
  practiceArea: string | null;
  jurisdiction: string | null;
  verificationStatus: PracticeMemoRow['verificationStatus'];
  privilegeTag: PracticeMemoRow['privilegeTag'];
  crossMatter: boolean;
  currencyWarning: string;
  matchReasons: string[];
  // NOTE: originMatterId is intentionally NOT surfaced (Fork B — owner-only drill-down).
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * PURE conservative match. A memo is included when it is THIS matter's own (origin match) OR
 * it shares the practice area, jurisdiction, or a topic tag with the query. Returns the match
 * reasons (empty => do not surface, unless it is an origin-matter memo handled by the caller).
 */
export function evaluateMemoSurfaceMatch(
  memo: Pick<PracticeMemoRow, 'practiceArea' | 'jurisdiction' | 'topicTags'>,
  query: MemoSurfaceQuery,
): string[] {
  const reasons: string[] = [];
  if (norm(memo.practiceArea) && norm(memo.practiceArea) === norm(query.practiceArea)) {
    reasons.push('practice_area');
  }
  if (norm(memo.jurisdiction) && norm(memo.jurisdiction) === norm(query.jurisdiction)) {
    reasons.push('jurisdiction');
  }
  const memoTags = new Set((memo.topicTags ?? []).map((t) => norm(t)));
  for (const t of query.tags ?? []) {
    if (memoTags.has(norm(t))) reasons.push(`topic:${norm(t)}`);
  }
  return reasons;
}

/**
 * Owner-scoped deterministic surfacing for a matter. Returns this matter's own memos plus
 * firm-wide-abstracted memos that match the query, each gated and currency-annotated.
 */
export async function surfaceCandidatesForMatter(params: {
  userId: string;
  targetMatterId: string;
  query: MemoSurfaceQuery;
}): Promise<SurfacedMemo[]> {
  const own = await listMemosForOriginMatter(params.targetMatterId, params.userId);
  const firmWide = await listFirmWideReusableMemos(params.userId);

  const seen = new Set<string>();
  const candidates: PracticeMemoRow[] = [];
  for (const m of [...own, ...firmWide]) {
    if (m.supersededById !== null) continue; // never surface a superseded memo
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    candidates.push(m);
  }

  const out: SurfacedMemo[] = [];
  for (const m of candidates) {
    const decision = evaluateMemoAccess({
      memo: { originMatterId: m.originMatterId, reuseScope: m.reuseScope, abstractionStatus: m.abstractionStatus },
      targetMatterId: params.targetMatterId,
    });
    if (!decision.allowed) continue; // gate: surfacing == invocation

    const isOwnMatter = m.originMatterId === params.targetMatterId;
    const matchReasons = evaluateMemoSurfaceMatch(m, params.query);
    if (!isOwnMatter && matchReasons.length === 0) continue; // conservative — no blind firm-wide dump

    out.push({
      memoId: m.id,
      title: m.title,
      practiceArea: m.practiceArea,
      jurisdiction: m.jurisdiction,
      verificationStatus: m.verificationStatus,
      privilegeTag: m.privilegeTag,
      crossMatter: decision.crossMatter,
      currencyWarning: formatCurrencyWarning(m),
      matchReasons: isOwnMatter && matchReasons.length === 0 ? ['origin_matter'] : matchReasons,
    });
  }

  // Deterministic order: more match reasons first, then newest title-stable by memoId.
  out.sort((a, b) => b.matchReasons.length - a.matchReasons.length || a.memoId.localeCompare(b.memoId));
  return out;
}
