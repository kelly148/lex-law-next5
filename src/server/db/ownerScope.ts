/**
 * ownerScope — FOLD-AUTH-1 Increment 2 (Fork B): the single owner-access chokepoint.
 *
 * Every owner-scoped query SHOULD express its ownership predicate via
 * `ownerScope(table.userId, userId)` instead of inlining `eq(table.userId, userId)`,
 * and post-fetch ownership checks via `assertOwned(row, userId)`. This is the ONE
 * place a future per-user *sharing* layer is added (OR-in shared grants) — change it
 * here and every owner-scoped read inherits sharing, with no scattered edits.
 *
 * ENFORCEMENT (baseline ratchet): src/server/__tests__/mr_fold_auth_2.test.ts freezes
 * the count of pre-existing inline `eq(<table>.userId, ...)` owner filters per file
 * against a baseline. A NEW inline owner filter (count above baseline, or in a new
 * file) FAILS CI — new code must use ownerScope() instead. Migrating an existing
 * inline filter to ownerScope() drops that file's count; the baseline is then lowered
 * to match (baseline only shrinks). The existing sites are grandfathered, not rewritten
 * en masse.
 *
 * LIMITATIONS — read these so the guard does not create false confidence:
 *   - It detects inline owner filters that BYPASS this helper. It does NOT detect a
 *     query that omits an owner predicate ENTIRELY (a truly unfiltered query) — that
 *     still requires human review. The guard nudges all owner filtering toward one
 *     chokepoint; it does not prove every query is scoped.
 *   - It is a static text scan: dynamically-built conditions, raw SQL, ownership via
 *     joins, or aliased columns are not caught.
 *   - assertOwned guards post-fetch by-id reads; it is not a substitute for a WHERE
 *     filter on list queries.
 */

import { eq, type SQL } from 'drizzle-orm';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import { TRPCError } from '@trpc/server';

/**
 * Ownership WHERE predicate for an owner-scoped table.
 * Pass the table's owner column, e.g. ownerScope(documents.userId, ctx.userId).
 * Today: owner-only. Future sharing: OR-in shared-grant predicates HERE only.
 */
export function ownerScope(ownerColumn: AnyMySqlColumn, userId: string): SQL {
  return eq(ownerColumn, userId);
}

/**
 * Post-fetch ownership assertion for by-id reads. Returns the row if owned by
 * userId; otherwise throws NOT_FOUND (no existence leak to non-owners).
 */
export function assertOwned<R extends { userId: string }>(
  row: R | null | undefined,
  userId: string,
): R {
  if (!row || row.userId !== userId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });
  }
  return row;
}
