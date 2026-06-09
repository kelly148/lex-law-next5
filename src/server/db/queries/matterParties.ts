/**
 * matter_parties query wrapper — FOLD-L0-1 (Fork B).
 *
 * Ch 35.1 Zod Wall. Owner-scoped via ownerScope() (never inline eq(<table>.userId,...)).
 * `listOtherPartiesForOwner` is the cross-matter conflicts read — the broadest cross-matter
 * read in the app (Fork G) — owner-scoped + matter-excluded; scrutinized hardest.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, ne, desc, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../connection.js';
import { matterParties } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { partyHasFinalizedBinding } from './documentParty.js';
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

/**
 * R2-PRE-CONFLICT-1 Inc 2: ensure the matter's client is represented as a conflict PARTY.
 *
 * If the matter has a non-empty clientName and NO role='client' party yet, auto-create one as an
 * UNCONFIRMED party (source='auto_from_clientName', confirmed=false). It is screened from creation
 * (the deterministic conflict check reads matter_parties), so a real hit surfaces while the attorney
 * is confirming identity — but it CANNOT satisfy clearance until the attorney confirms it (Inc 3
 * gate). "Automate the labor (row creation), never the judgment (party identity)."
 *
 * Idempotent + non-destructive: a no-op when the clientName is empty OR a role='client' party
 * already exists (manual OR a prior auto/migration one). Never overwrites, re-screens, or
 * auto-confirms an existing client party. Composes the owner-scoped list/insert wrappers (no new
 * owner-scope chokepoint).
 */
export async function ensureAutoClientParty(
  matterId: string,
  userId: string,
  clientName: string | null | undefined,
): Promise<MatterPartyRow | null> {
  const name = (clientName ?? '').trim();
  if (name === '') return null;
  const parties = await listPartiesForMatter(matterId, userId);
  if (parties.some((p) => p.role === 'client')) return null;
  return insertMatterParty({
    userId,
    matterId,
    role: 'client',
    displayName: name,
    source: 'auto_from_clientName',
    confirmed: false,
  });
}

/**
 * R2-PRE-CONFLICT-1 §3: confirm a party — the explicit attorney act that flips an auto/migration
 * party from screened-but-not-vouched to VOUCHED (sets confirmed=true + the confirmation stamp).
 * Owner-scoped. The clearance gate (evaluateConflictClearance) requires a CONFIRMED role='client'
 * party, so this is the act that enables clearance. The immutable audit_events row is written by the
 * matterIntake.confirmParty procedure (BLOCK-until #5: confirmation is first-class + logged).
 */
export async function confirmMatterParty(partyId: string, userId: string): Promise<MatterPartyRow | null> {
  await db
    .update(matterParties)
    .set({ confirmed: true, confirmedAt: new Date(), confirmedByUserId: userId })
    .where(and(eq(matterParties.id, partyId), ownerScope(matterParties.userId, userId)));
  return getMatterPartyById(partyId, userId);
}

export async function listPartiesForMatter(matterId: string, userId: string): Promise<MatterPartyRow[]> {
  const rows = await db
    .select()
    .from(matterParties)
    // DOC-CLIENT-TARGET-1: exclude soft-deleted parties (a removed party leaves the list + screening).
    .where(and(ownerScope(matterParties.userId, userId), eq(matterParties.matterId, matterId), isNull(matterParties.deletedAt)))
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
    // DOC-CLIENT-TARGET-1: a soft-deleted party is excluded from the cross-matter conflicts read too.
    .where(and(ownerScope(matterParties.userId, userId), ne(matterParties.matterId, excludeMatterId), isNull(matterParties.deletedAt)))
    .orderBy(desc(matterParties.createdAt));
  return rows.map((r) => parseRow(r, { userId }));
}

export async function deleteMatterParty(id: string, userId: string): Promise<void> {
  await db
    .delete(matterParties)
    .where(and(eq(matterParties.id, id), ownerScope(matterParties.userId, userId)));
}

/**
 * DOC-CLIENT-TARGET-1 §10c — the SANCTIONED party removal: SOFT-delete (sets deletedAt), gated by the
 * BLOCK-delete guard. A party bound to a FINALIZED document must never be removed out from under it —
 * partyHasFinalizedBinding refuses the removal, so a party_id correction stays a correction and never
 * an orphaning delete. Soft-deleted parties drop out of list reads + conflicts screening. This is the
 * removal primitive the spine provides; v1 ships no removal UI (none exists today), but the guarantee
 * is real the moment one is added. (The legacy hard `deleteMatterParty` above remains unused; the
 * whole-matter purge cascade deletes documents too, so it cannot orphan a finalized instrument.)
 */
export async function softDeleteMatterParty(id: string, userId: string): Promise<void> {
  if (await partyHasFinalizedBinding(id, userId)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'PARTY_BOUND_TO_FINALIZED_DOCUMENT: this party is bound to a finalized document and cannot be removed. Correct the party instead.',
    });
  }
  await db
    .update(matterParties)
    .set({ deletedAt: new Date() })
    .where(and(eq(matterParties.id, id), ownerScope(matterParties.userId, userId)));
}
