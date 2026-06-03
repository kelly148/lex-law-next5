/**
 * kb_adoptions query wrapper — FOLD-KB-1 Increment 2 (Fork A durable provenance).
 *
 * Ch 35.1 Zod Wall; owner-scoped via ownerScope(). Append-style provenance: each row records
 * a memo→matter/work-product adoption with the memo's currency posture snapshotted AT
 * adoption. Optionally enlistable in a transaction (the adopt service writes the adoption +
 * the audit row + sets the document flag together).
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../connection.js';
import { kbAdoptions } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { KbAdoptionRowSchema, type KbAdoptionRow } from '../../../shared/schemas/practiceKb.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

type Executor = Pick<typeof db, 'insert'>;

function parseRow(raw: unknown, userId: string): KbAdoptionRow {
  try {
    return KbAdoptionRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry('zod_parse_failed', { schemaName: 'KbAdoptionRowSchema', tableName: 'kb_adoptions', errorPath: err.errors[0]?.path.join('.') ?? '', errorMessage: err.errors[0]?.message ?? 'ZodError' }, { userId, matterId: null, documentId: null, jobId: null });
    }
    throw err;
  }
}

export async function insertKbAdoption(
  data: {
    id?: string;
    userId: string;
    matterId: string;
    documentId?: string | null;
    kbMemoId: string;
    kbMemoUpdatedAtAtAdoption?: Date | null;
    verificationStatusAtAdoption: string;
    lastVerifiedAtAtAdoption?: Date | null;
    currencyVerifiedForOutbound?: boolean;
    adoptedByEventId?: string | null;
  },
  executor: Executor = db,
): Promise<string> {
  const id = data.id ?? uuidv4();
  await executor.insert(kbAdoptions).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    documentId: data.documentId ?? null,
    kbMemoId: data.kbMemoId,
    kbMemoUpdatedAtAtAdoption: data.kbMemoUpdatedAtAtAdoption ?? null,
    verificationStatusAtAdoption: data.verificationStatusAtAdoption,
    lastVerifiedAtAtAdoption: data.lastVerifiedAtAtAdoption ?? null,
    kbDerived: true,
    currencyVerifiedForOutbound: data.currencyVerifiedForOutbound ?? false,
    adoptedByEventId: data.adoptedByEventId ?? null,
  });
  return id;
}

export async function listAdoptionsForMatter(matterId: string, userId: string): Promise<KbAdoptionRow[]> {
  const rows = await db
    .select()
    .from(kbAdoptions)
    .where(and(ownerScope(kbAdoptions.userId, userId), eq(kbAdoptions.matterId, matterId)))
    .orderBy(desc(kbAdoptions.createdAt));
  return rows.map((r) => parseRow(r, userId));
}

export async function listAdoptionsForDocument(documentId: string, userId: string): Promise<KbAdoptionRow[]> {
  const rows = await db
    .select()
    .from(kbAdoptions)
    .where(and(ownerScope(kbAdoptions.userId, userId), eq(kbAdoptions.documentId, documentId)))
    .orderBy(desc(kbAdoptions.createdAt));
  return rows.map((r) => parseRow(r, userId));
}
