/**
 * reusable_artifacts query wrapper — FOLD-L1-4 (MM-8a registry).
 *
 * Ch 35.1 Zod Wall: the ONLY read path for reusable_artifacts; every row parses through
 * ReusableArtifactRowSchema before returning.
 *
 * Owner scoping uses ownerScope() (FOLD-AUTH-1 Inc 2 chokepoint), never an inline
 * eq(<table>.userId, ...) filter. The cross-matter GATE itself lives in
 * src/server/reusableArtifacts/index.ts (MM-8b); this module is just the registry I/O.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../connection.js';
import { reusableArtifacts } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  ReusableArtifactRowSchema,
  type ReusableArtifactRow,
  type ReusableArtifactKind,
  type ReusableArtifactScope,
} from '../../../shared/schemas/reusableArtifacts.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseReusableArtifactRow(raw: unknown, ctx: { userId: string }): ReusableArtifactRow {
  try {
    return ReusableArtifactRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'ReusableArtifactRowSchema',
          tableName: 'reusable_artifacts',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

export async function getReusableArtifactById(
  id: string,
  userId: string,
): Promise<ReusableArtifactRow | null> {
  const rows = await db
    .select()
    .from(reusableArtifacts)
    .where(and(eq(reusableArtifacts.id, id), ownerScope(reusableArtifacts.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseReusableArtifactRow(rows[0]!, { userId });
}

export async function listReusableArtifactsForUser(
  userId: string,
  opts: { kind?: ReusableArtifactKind } = {},
): Promise<ReusableArtifactRow[]> {
  const conditions = [ownerScope(reusableArtifacts.userId, userId)];
  if (opts.kind) conditions.push(eq(reusableArtifacts.kind, opts.kind));
  const rows = await db
    .select()
    .from(reusableArtifacts)
    .where(and(...conditions))
    .orderBy(desc(reusableArtifacts.createdAt));
  return rows.map((r) => parseReusableArtifactRow(r, { userId }));
}

export async function listReusableArtifactsForMatter(
  originMatterId: string,
  userId: string,
): Promise<ReusableArtifactRow[]> {
  const rows = await db
    .select()
    .from(reusableArtifacts)
    .where(
      and(
        ownerScope(reusableArtifacts.userId, userId),
        eq(reusableArtifacts.originMatterId, originMatterId),
      ),
    )
    .orderBy(desc(reusableArtifacts.createdAt));
  return rows.map((r) => parseReusableArtifactRow(r, { userId }));
}

export async function insertReusableArtifact(data: {
  id?: string;
  userId: string;
  originMatterId?: string | null;
  sourceDocumentId?: string | null;
  kind: ReusableArtifactKind;
  title: string;
  body: string;
  reusableScope?: ReusableArtifactScope;
}): Promise<ReusableArtifactRow> {
  const id = data.id ?? uuidv4();
  await db.insert(reusableArtifacts).values({
    id,
    userId: data.userId,
    originMatterId: data.originMatterId ?? null,
    sourceDocumentId: data.sourceDocumentId ?? null,
    kind: data.kind,
    title: data.title,
    body: data.body,
    // Conservative default mirrors the DB default; scope is never inferred.
    reusableScope: data.reusableScope ?? 'matter_only',
  });
  const row = await getReusableArtifactById(id, data.userId);
  if (!row) throw new Error(`insertReusableArtifact: row not found after insert (id=${id})`);
  return row;
}

/** Attorney act: widen/narrow an artifact's cross-matter reusability scope. */
export async function setReusableArtifactScope(
  id: string,
  userId: string,
  reusableScope: ReusableArtifactScope,
): Promise<ReusableArtifactRow | null> {
  await db
    .update(reusableArtifacts)
    .set({ reusableScope })
    .where(and(eq(reusableArtifacts.id, id), ownerScope(reusableArtifacts.userId, userId)));
  return getReusableArtifactById(id, userId);
}
