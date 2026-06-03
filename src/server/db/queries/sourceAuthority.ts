/**
 * source_authority query wrapper — FOLD-L1-1 (Fork A).
 *
 * Ch 35.1 Zod Wall: the ONLY read path for source_authority; every row parses through
 * SourceAuthorityRowSchema before returning.
 *
 * Owner scoping uses ownerScope() (FOLD-AUTH-1 Inc 2 chokepoint), never an inline
 * eq(<table>.userId, ...) filter (the baseline ratchet forbids new inline owner filters).
 *
 * Tier = an explicit attorney act with a conservative default, NEVER inferred. The
 * attorney tier-set flow (setSourceAuthorityTier) writes the tier change and its
 * immutable audit-disposition row in ONE transaction (fail-visibly; disposition item 5).
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { db } from '../connection.js';
import { sourceAuthority } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { insertAuditEvent } from './auditEvents.js';
import {
  SourceAuthorityRowSchema,
  type SourceAuthorityRow,
  type SourceAuthorityOrigin,
  type SourceAuthorityLifecycle,
  type SourceAuthoritySubjectType,
  type SourceAuthorityDesignationSource,
} from '../../../shared/schemas/sourceAuthority.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseSourceAuthorityRow(raw: unknown, ctx: { userId: string }): SourceAuthorityRow {
  try {
    return SourceAuthorityRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'SourceAuthorityRowSchema',
          tableName: 'source_authority',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

// ============================================================
// Reads (owner-scoped)
// ============================================================

export async function getSourceAuthorityById(
  id: string,
  userId: string,
): Promise<SourceAuthorityRow | null> {
  const rows = await db
    .select()
    .from(sourceAuthority)
    .where(and(eq(sourceAuthority.id, id), ownerScope(sourceAuthority.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseSourceAuthorityRow(rows[0]!, { userId });
}

/** All source-authority rows for a matter, newest first. */
export async function listSourceAuthorityForMatter(
  matterId: string,
  userId: string,
): Promise<SourceAuthorityRow[]> {
  const rows = await db
    .select()
    .from(sourceAuthority)
    .where(and(ownerScope(sourceAuthority.userId, userId), eq(sourceAuthority.matterId, matterId)))
    .orderBy(desc(sourceAuthority.createdAt));
  return rows.map((r) => parseSourceAuthorityRow(r, { userId }));
}

/** Currently-operative sources (lifecycle in current_draft|operative; not superseded). */
export async function listOperativeSourcesForMatter(
  matterId: string,
  userId: string,
): Promise<SourceAuthorityRow[]> {
  const rows = await db
    .select()
    .from(sourceAuthority)
    .where(
      and(
        ownerScope(sourceAuthority.userId, userId),
        eq(sourceAuthority.matterId, matterId),
        inArray(sourceAuthority.lifecycle, ['current_draft', 'operative']),
      ),
    )
    .orderBy(desc(sourceAuthority.createdAt));
  return rows.map((r) => parseSourceAuthorityRow(r, { userId }));
}

// ============================================================
// Writes
// ============================================================

/**
 * Register a source-authority record. Used by import/system flows; the tier defaults
 * are conservative (authorityOrigin='reference', lifecycle='operative',
 * designationSource defaults to 'system' unless an explicit attorney designation is
 * passed). NEVER infers authority from content.
 */
export async function insertSourceAuthority(data: {
  id?: string;
  userId: string;
  matterId: string;
  documentId?: string | null;
  subjectType: SourceAuthoritySubjectType;
  subjectId: string;
  authorityOrigin?: SourceAuthorityOrigin;
  lifecycle?: SourceAuthorityLifecycle;
  designationSource?: SourceAuthorityDesignationSource;
  label?: string | null;
  notes?: string | null;
}): Promise<SourceAuthorityRow> {
  const id = data.id ?? uuidv4();
  // Conservative defaults mirror the DB column defaults (schema.ts) so a tier is never
  // inferred from content — import/system rows land at reference/operative/system until
  // an attorney explicitly designates.
  await db.insert(sourceAuthority).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    documentId: data.documentId ?? null,
    subjectType: data.subjectType,
    subjectId: data.subjectId,
    authorityOrigin: data.authorityOrigin ?? 'reference',
    lifecycle: data.lifecycle ?? 'operative',
    designationSource: data.designationSource ?? 'system',
    label: data.label ?? null,
    notes: data.notes ?? null,
  });
  const row = await getSourceAuthorityById(id, data.userId);
  if (!row) throw new Error(`insertSourceAuthority: row not found after insert (id=${id})`);
  return row;
}

/**
 * Attorney tier-set — a "new flow" that writes the tier change and its immutable
 * audit-disposition row in ONE transaction (disposition item 5: transactional OR fail
 * visibly). designationSource is forced to 'attorney' (explicit act). Returns the
 * updated row. Throws (and rolls back) if either write fails.
 */
export async function setSourceAuthorityTier(params: {
  id: string;
  userId: string;
  matterId: string;
  documentId?: string | null;
  authorityOrigin: SourceAuthorityOrigin;
  lifecycle: SourceAuthorityLifecycle;
  rationale?: string | null;
}): Promise<SourceAuthorityRow> {
  await db.transaction(async (tx) => {
    await tx
      .update(sourceAuthority)
      .set({
        authorityOrigin: params.authorityOrigin,
        lifecycle: params.lifecycle,
        designationSource: 'attorney',
      })
      .where(
        and(eq(sourceAuthority.id, params.id), ownerScope(sourceAuthority.userId, params.userId)),
      );
    await insertAuditEvent(
      {
        userId: params.userId,
        matterId: params.matterId,
        documentId: params.documentId ?? null,
        eventType: 'disposition',
        actor: 'attorney',
        summary: `Source authority set to ${params.authorityOrigin} / ${params.lifecycle}`,
        targetType: 'source_authority',
        targetId: params.id,
        action: 'set_tier',
        rationale: params.rationale ?? null,
        scope: params.documentId ? 'document' : 'matter',
      },
      tx,
    );
  });
  const row = await getSourceAuthorityById(params.id, params.userId);
  if (!row) throw new Error(`setSourceAuthorityTier: row not found after update (id=${params.id})`);
  return row;
}
