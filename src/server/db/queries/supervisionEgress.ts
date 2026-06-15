/**
 * supervisionEgress.ts — SUPERVISION-VIEW-1 (read-only egress supervision).
 *
 * A thin, PURE read+aggregate layer over the egress audit log for the GLBA
 * vendor-oversight (recurring-review) duty. It reads ONLY through the sole egress
 * read path (listEgressEvents → ownerScope-enforced, Zod-Wall-parsed) and adds the
 * supervisor-facing filters (kind / decision / date-range), pagination, and
 * aggregates IN MEMORY. There is NO write path here — supervision is read-only and
 * the egress log stays append-only-by-construction.
 *
 * Owner-scoped by construction: every read is listEgressEvents(userId, ...), so a
 * supervisor only ever sees THEIR OWN egress events (each attorney supervising their
 * own vendor sends). A cross-user/admin view would require changing ownerScope.ts and
 * is a separate, gated scope.
 */

import { listEgressEvents, type EgressEventFilter } from './chatEgress.js';
import type {
  ChatEgressEventRow,
  ChatEgressKind,
  ChatEgressDecision,
} from '../../../shared/schemas/chatCopilot.js';

export interface SupervisionFilter {
  matterId?: string;
  provider?: string;
  kind?: ChatEgressKind;
  decision?: ChatEgressDecision;
  sinceCreatedAt?: Date;
  untilCreatedAt?: Date;
}

export interface SupervisionAggregates {
  total: number;
  allowedCount: number;
  blockedCount: number;
  includedAttachmentTotal: number;
  npiWithheldTotal: number;
  byProvider: Array<{ provider: string; count: number }>;
  byKind: Array<{ kind: ChatEgressKind; count: number }>;
}

export interface SupervisionResult {
  events: ChatEgressEventRow[];
  total: number; // total matching the filter, BEFORE pagination
  aggregates: SupervisionAggregates;
}

export interface SupervisionPageOpts {
  limit: number;
  offset: number;
}

function computeAggregates(rows: ChatEgressEventRow[]): SupervisionAggregates {
  let allowedCount = 0;
  let blockedCount = 0;
  let includedAttachmentTotal = 0;
  let npiWithheldTotal = 0;
  const providerCounts = new Map<string, number>();
  const kindCounts = new Map<ChatEgressKind, number>();

  for (const r of rows) {
    if (r.decision === 'allowed') allowedCount += 1;
    else if (r.decision === 'blocked') blockedCount += 1;
    includedAttachmentTotal += r.includedAttachmentCount;
    npiWithheldTotal += r.npiWithheldCount;
    providerCounts.set(r.provider, (providerCounts.get(r.provider) ?? 0) + 1);
    kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);
  }

  const byProvider = [...providerCounts.entries()]
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider));
  const byKind = [...kindCounts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total: rows.length,
    allowedCount,
    blockedCount,
    includedAttachmentTotal,
    npiWithheldTotal,
    byProvider,
    byKind,
  };
}

/**
 * Owner-scoped supervision read: returns a page of egress events matching the filter
 * (newest-first) plus aggregates over the FULL filtered set. userId is the caller's
 * own id (from ctx) — never client input.
 */
export async function querySupervision(
  userId: string,
  filter: SupervisionFilter,
  page: SupervisionPageOpts,
): Promise<SupervisionResult> {
  // DB-supported owner-scoped filters (the rest are applied in memory below).
  const base: EgressEventFilter = {};
  if (filter.matterId) base.matterId = filter.matterId;
  if (filter.provider) base.provider = filter.provider;
  if (filter.sinceCreatedAt) base.sinceCreatedAt = filter.sinceCreatedAt;

  const all = await listEgressEvents(userId, base); // ownerScope-enforced, desc createdAt
  const filtered = all.filter(
    (e) =>
      (filter.kind ? e.kind === filter.kind : true) &&
      (filter.decision ? e.decision === filter.decision : true) &&
      (filter.untilCreatedAt ? e.createdAt <= filter.untilCreatedAt : true),
  );

  const aggregates = computeAggregates(filtered);
  const events = filtered.slice(page.offset, page.offset + page.limit);
  return { events, total: filtered.length, aggregates };
}
