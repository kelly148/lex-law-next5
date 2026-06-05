/**
 * matter_parties query wrapper — FOLD-L0-1 (Fork B).
 *
 * Ch 35.1 Zod Wall. Owner-scoped via ownerScope() (never inline eq(<table>.userId,...)).
 * `listOtherPartiesForOwner` is the cross-matter conflicts read — the broadest cross-matter
 * read in the app (Fork G) — owner-scoped + matter-excluded; scrutinized hardest.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, ne, desc } from 'drizzle-orm';
import { db } from '../connection.js';
import { matterParties } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  MatterPartyRowSchema,
  type MatterPartyRow,
  type MatterPartyRole,
  type MatterPartyType,
} from '../../../shared/schemas/layer0.js';
import { normalizeName } from '../../conflicts/engine.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseRow(raw: unknown, ctx: { userId: string }): MatterPartyRow {
  try {
    return MatterPartyRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'MatterPartyRowSchema',
          tableName: 'matter_parties',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

export async function insertMatterParty(data: {
  id?: string;
  userId: string;
  matterId: string;
  role: MatterPartyRole;
  displayName: string;
  partyType?: MatterPartyType;
  source?: string;
  // R2-PRE-CONFLICT-1 §3F: confirmation state at insert. Defaults TRUE (a manual attorney add is
  // confirmed). Auto-create (Inc 2) and migration (Inc 5) pass confirmed=false (screened-but-not-
  // vouched). confirmedByUserId defaults to the inserting attorney when confirmed.
  confirmed?: boolean;
  confirmedByUserId?: string | null;
}): Promise<MatterPartyRow> {
  const id = data.id ?? uuidv4();
  const confirmed = data.confirmed ?? true;
  await db.insert(matterParties).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    role: data.role,
    displayName: data.displayName,
    normalizedName: normalizeName(data.displayName),
    partyType: data.partyType ?? 'unknown',
    source: data.source ?? 'attorney',
    confirmed,
    confirmedAt: confirmed ? new Date() : null,
    confirmedByUserId: confirmed ? (data.confirmedByUserId ?? data.userId) : null,
  });
  const row = await getMatterPartyById(id, data.userId);
  if (!row) throw new Error(`insertMatterParty: row not found after insert (id=${id})`);
  return row;
}

export async function getMatterPartyById(id: string, userId: string): Promise<MatterPartyRow | null> {
  const rows = await db
    .select()
    .from(matterParties)
    .where(and(eq(matterParties.id, id), ownerScope(matterParties.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseRow(rows[0]!, { userId });
}

export async function listPartiesForMatter(matterId: string, userId: string): Promise<MatterPartyRow[]> {
  const rows = await db
    .select()
    .from(matterParties)
    .where(and(ownerScope(matterParties.userId, userId), eq(matterParties.matterId, matterId)))
    .orderBy(desc(matterParties.createdAt));
  return rows.map((r) => parseRow(r, { userId }));
}

/**
 * Fork G — the cross-matter conflicts read: every OTHER matter's parties for this owner.
 * Owner-scoped AND excludes the matter being checked. This is the highest-blast-radius
 * read in the app; keep the ownerScope chokepoint here exact.
 */
export async function listOtherPartiesForOwner(
  userId: string,
  excludeMatterId: string,
): Promise<MatterPartyRow[]> {
  const rows = await db
    .select()
    .from(matterParties)
    .where(and(ownerScope(matterParties.userId, userId), ne(matterParties.matterId, excludeMatterId)))
    .orderBy(desc(matterParties.createdAt));
  return rows.map((r) => parseRow(r, { userId }));
}

export async function deleteMatterParty(id: string, userId: string): Promise<void> {
  await db
    .delete(matterParties)
    .where(and(eq(matterParties.id, id), ownerScope(matterParties.userId, userId)));
}
