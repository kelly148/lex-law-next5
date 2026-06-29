/**
 * authority_source query wrappers — KNOWLEDGE-BACKBONE-PHASE2 (I1) activation.
 *
 * Activates the DORMANT authority_source registry (table + schema shipped by KB-PROVENANCE-1 migration 0039; no
 * operational code existed). Ch 35.1 Zod Wall (every read parses through AuthoritySourceRowSchema); owner-scoped
 * via ownerScope() — a cross-owner read/update returns null / refuses, never another firm's citation. The table
 * is firm-level (userId, NO matterId) so it survives matter closure and is NOT matter-purged.
 *
 * The §2 promotion gate (an authoritative citation needs a pinned pinpoint + a checker signature) is enforced at
 * the app-layer PROMOTION boundary (procedure layer), NOT here — these wrappers are the persistence primitives.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, asc, isNotNull, lte } from 'drizzle-orm';
import { db } from '../connection.js';
import { authoritySource } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  AuthoritySourceRowSchema,
  type AuthoritySourceRow,
  type AuthorityType,
} from '../../../shared/schemas/authoritySource.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseRow(raw: unknown, userId: string): AuthoritySourceRow {
  try {
    return AuthoritySourceRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        { schemaName: 'AuthoritySourceRowSchema', tableName: 'authority_source', errorPath: err.errors[0]?.path.join('.') ?? '', errorMessage: err.errors[0]?.message ?? 'ZodError' },
        { userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

export interface CreateAuthoritySourceData {
  id?: string;
  userId: string;
  jurisdiction: string;
  authorityType: AuthorityType;
  citationText: string;
  pinpoint?: string | null;
  sourceUrlOrLocation?: string | null;
  sourceSnapshotHash?: string | null;
  effectiveDate?: string | null;
  lastCheckedDate?: string | null;
  reviewByDate?: string | null;
  checkedBy?: string | null;
  notes?: string | null;
}

/** Create a registry citation (owner-scoped by the userId on the row). */
export async function createAuthoritySource(data: CreateAuthoritySourceData): Promise<AuthoritySourceRow> {
  const id = data.id ?? uuidv4();
  await db.insert(authoritySource).values({
    id,
    userId: data.userId,
    jurisdiction: data.jurisdiction,
    authorityType: data.authorityType,
    citationText: data.citationText,
    pinpoint: data.pinpoint ?? null,
    sourceUrlOrLocation: data.sourceUrlOrLocation ?? null,
    sourceSnapshotHash: data.sourceSnapshotHash ?? null,
    effectiveDate: data.effectiveDate ?? null,
    lastCheckedDate: data.lastCheckedDate ?? null,
    reviewByDate: data.reviewByDate ?? null,
    checkedBy: data.checkedBy ?? null,
    notes: data.notes ?? null,
  });
  const row = await getAuthoritySourceById(id, data.userId);
  if (!row) throw new Error(`createAuthoritySource: row not found after insert (id=${id})`);
  return row;
}

/** Owner-scoped by-id read. Returns null if not found OR not owned (no cross-owner leak). */
export async function getAuthoritySourceById(id: string, userId: string): Promise<AuthoritySourceRow | null> {
  const rows = await db
    .select()
    .from(authoritySource)
    .where(and(eq(authoritySource.id, id), ownerScope(authoritySource.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseRow(rows[0]!, userId);
}

/** Owner-scoped citations for a jurisdiction (uses idx_authority_source_owner). */
export async function listAuthoritySourcesByJurisdiction(jurisdiction: string, userId: string): Promise<AuthoritySourceRow[]> {
  const rows = await db
    .select()
    .from(authoritySource)
    .where(and(ownerScope(authoritySource.userId, userId), eq(authoritySource.jurisdiction, jurisdiction)))
    .orderBy(asc(authoritySource.citationText));
  return rows.map((r) => parseRow(r, userId));
}

/**
 * Owner-scoped citations whose recheck is APPROACHING — those with a non-null reviewByDate, soonest first
 * (uses idx_authority_source_review). Optional `onOrBefore` ('YYYY-MM-DD') bounds the worklist to citations
 * due on or before a cutoff. Citations with no reviewByDate are intentionally excluded (nothing to chase yet).
 */
export async function listAuthoritySourcesApproachingReview(
  userId: string,
  opts?: { onOrBefore?: string },
): Promise<AuthoritySourceRow[]> {
  const conditions = [ownerScope(authoritySource.userId, userId), isNotNull(authoritySource.reviewByDate)];
  if (opts?.onOrBefore) conditions.push(lte(authoritySource.reviewByDate, opts.onOrBefore));
  const rows = await db
    .select()
    .from(authoritySource)
    .where(and(...conditions))
    .orderBy(asc(authoritySource.reviewByDate));
  return rows.map((r) => parseRow(r, userId));
}

export interface UpdateAuthoritySourceData {
  id: string;
  userId: string;
  jurisdiction?: string;
  authorityType?: AuthorityType;
  citationText?: string;
  pinpoint?: string | null;
  sourceUrlOrLocation?: string | null;
  sourceSnapshotHash?: string | null;
  effectiveDate?: string | null;
  lastCheckedDate?: string | null;
  reviewByDate?: string | null;
  checkedBy?: string | null;
  notes?: string | null;
}

/**
 * Owner-scoped partial update. Only the keys present in `data` (beyond id/userId) are written, so a caller can
 * patch one field without clobbering the rest. Returns null if the row is not found / not owned.
 */
export async function updateAuthoritySource(data: UpdateAuthoritySourceData): Promise<AuthoritySourceRow | null> {
  const existing = await getAuthoritySourceById(data.id, data.userId);
  if (!existing) return null;
  // Conditional spreads keep the patch well-typed for Drizzle's .set() — only keys present in `data` are written.
  const setFields = {
    ...(data.jurisdiction !== undefined ? { jurisdiction: data.jurisdiction } : {}),
    ...(data.authorityType !== undefined ? { authorityType: data.authorityType } : {}),
    ...(data.citationText !== undefined ? { citationText: data.citationText } : {}),
    ...(data.pinpoint !== undefined ? { pinpoint: data.pinpoint } : {}),
    ...(data.sourceUrlOrLocation !== undefined ? { sourceUrlOrLocation: data.sourceUrlOrLocation } : {}),
    ...(data.sourceSnapshotHash !== undefined ? { sourceSnapshotHash: data.sourceSnapshotHash } : {}),
    ...(data.effectiveDate !== undefined ? { effectiveDate: data.effectiveDate } : {}),
    ...(data.lastCheckedDate !== undefined ? { lastCheckedDate: data.lastCheckedDate } : {}),
    ...(data.reviewByDate !== undefined ? { reviewByDate: data.reviewByDate } : {}),
    ...(data.checkedBy !== undefined ? { checkedBy: data.checkedBy } : {}),
    ...(data.notes !== undefined ? { notes: data.notes } : {}),
  };
  if (Object.keys(setFields).length > 0) {
    await db
      .update(authoritySource)
      .set(setFields)
      .where(and(eq(authoritySource.id, data.id), ownerScope(authoritySource.userId, data.userId)));
  }
  return getAuthoritySourceById(data.id, data.userId);
}
