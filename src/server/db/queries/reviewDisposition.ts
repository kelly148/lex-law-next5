/**
 * Review-suggestion disposition read projection — REVIEW-LOOP-UX-1 / R1.
 *
 * ADDITIVE + REVERSIBLE. This is a NEW read-only file (no new table, no new column, no
 * migration): it REUSES the EXISTING FOLD-L1-1 disposition projection over the append-only
 * audit_events stream (listDispositionHistoryForMatter, eventType='disposition') and narrows
 * it to the reject/defer dispositions an attorney recorded against THIS document's reviewer
 * suggestions. The inline review pane reads this to surface, per suggestion, whether it has
 * already been rejected or deferred (and why), so the per-suggestion adopt / reject / defer
 * affordance reflects recorded state.
 *
 * Owner scoping: inherited entirely from listDispositionHistoryForMatter, which filters via
 * ownerScope(auditEvents.userId, userId). This module adds NO owner predicate of its own (and
 * therefore no inline eq(.userId) — it never touches the userId column directly).
 *
 * The disposition rows are written by reviewSession.dispositionSuggestion (the reject/defer
 * mutation), with:
 *   targetType = 'reviewer_suggestion'
 *   targetId   = the suggestionId
 *   action     = 'reject' | 'defer'
 * so a read can both (a) recognize a review-suggestion disposition (targetType) and (b) recover
 * the latest action per suggestion (newest-first ordering is preserved from the projection).
 */

import { listDispositionHistoryForMatter } from './auditEvents.js';
import type { AuditEventRow } from '../../../shared/schemas/auditEvents.js';

/** The targetType every reviewer-suggestion disposition row carries (so reads can recognize them). */
export const REVIEWER_SUGGESTION_TARGET_TYPE = 'reviewer_suggestion';

/** A reject/defer action recorded against a reviewer suggestion (mirrors dispositionSuggestion input). */
export type ReviewSuggestionDispositionAction = 'reject' | 'defer';

/** One recorded reject/defer disposition for a reviewer suggestion (newest first). */
export interface ReviewSuggestionDisposition {
  auditEventId: string;
  suggestionId: string;
  action: ReviewSuggestionDispositionAction;
  rationale: string | null;
  documentId: string | null;
  reviewSessionId: string | null;
  createdAt: Date;
}

function isReviewSuggestionAction(action: string | null | undefined): action is ReviewSuggestionDispositionAction {
  return action === 'reject' || action === 'defer';
}

function toDisposition(row: AuditEventRow): ReviewSuggestionDisposition | null {
  if (row.targetType !== REVIEWER_SUGGESTION_TARGET_TYPE) return null;
  if (!row.targetId) return null;
  if (!isReviewSuggestionAction(row.action)) return null;
  return {
    auditEventId: row.id,
    suggestionId: row.targetId,
    action: row.action,
    rationale: row.rationale ?? null,
    documentId: row.documentId,
    reviewSessionId: row.reviewSessionId,
    createdAt: row.createdAt,
  };
}

/**
 * All reject/defer dispositions recorded against this matter's reviewer suggestions, newest first.
 * Owner-scoped via the underlying projection. The caller (reviewSession.listSuggestionDispositions)
 * has already resolved + owner-checked the document → matter, so it passes the matterId here.
 */
export async function listReviewSuggestionDispositionsForMatter(
  matterId: string,
  userId: string,
): Promise<ReviewSuggestionDisposition[]> {
  const rows = await listDispositionHistoryForMatter(matterId, userId);
  const out: ReviewSuggestionDisposition[] = [];
  for (const row of rows) {
    const d = toDisposition(row);
    if (d) out.push(d);
  }
  return out;
}

/**
 * The LATEST reject/defer disposition per suggestionId (newest wins), as a Map. A suggestion that
 * was later adopted (re-selected) is NOT cleared here — the inline pane treats a present selection
 * as authoritative for "adopted" and uses this only to label an otherwise-undecided suggestion as
 * rejected/deferred. Keeping the full audit trail is the point (append-only): this projection just
 * surfaces the most recent recorded action.
 */
export function latestDispositionBySuggestion(
  dispositions: ReviewSuggestionDisposition[],
): Map<string, ReviewSuggestionDisposition> {
  // dispositions arrive newest-first; the FIRST occurrence per suggestion is the latest.
  const map = new Map<string, ReviewSuggestionDisposition>();
  for (const d of dispositions) {
    if (!map.has(d.suggestionId)) map.set(d.suggestionId, d);
  }
  return map;
}
