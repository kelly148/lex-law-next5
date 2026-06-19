/**
 * deed_gate query layer (Zod Wall + ownerScope) — FOLD-DEED-1 Inc 1 foundation.
 *
 * The SOLE read/write path for a deed document's recordability-gate STATE. One mutable row per deed document
 * (documentId UNIQUE) holding the attorney-recorded affirmative-act checklist as a Zod-validated blob. Owner
 * filtering goes through ownerScope() (the FOLD-AUTH chokepoint — the ratchet bans inline owner-column
 * equality in new files); documentId/matterId are not owner columns so they use inline eq.
 *
 * FAIL-CLOSED (the whole point): a read that finds no row OR cannot parse the blob returns the DEFAULT-SAFE
 * "nothing affirmed" state, never throws — an ethics/land-records gate must be safe under absence/corruption,
 * so the evaluator then blocks every layer.
 */
import { v4 as uuidv4 } from 'uuid';
import { and, eq } from 'drizzle-orm';
import { db } from '../connection.js';
import { deedGate, type NewDeedGate } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { listDocumentParties } from './documentParty.js';
import {
  DeedGateStateSchema,
  DEFAULT_DEED_GATE_STATE,
  type DeedGateState,
  type DeedPartyBinding,
} from '../../../shared/schemas/deedGate.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';

export interface ResolvedDeedGateState {
  state: DeedGateState;
  exists: boolean;
}

/**
 * Read a deed document's current gate state. FAIL-CLOSED: no row or an unparseable blob → the default-safe
 * "nothing affirmed" state. The SOLE read path.
 */
export async function getDeedGateState(documentId: string, userId: string): Promise<ResolvedDeedGateState> {
  const rows = await db
    .select()
    .from(deedGate)
    .where(and(ownerScope(deedGate.userId, userId), eq(deedGate.documentId, documentId)))
    .limit(1);

  if (rows.length === 0) return { state: DEFAULT_DEED_GATE_STATE, exists: false };

  const parsed = DeedGateStateSchema.safeParse(rows[0]!.state);
  if (!parsed.success) {
    void emitTelemetry(
      'zod_parse_failed',
      {
        schemaName: 'DeedGateStateSchema',
        tableName: 'deed_gate',
        errorPath: parsed.error.errors[0]?.path.join('.') ?? '',
        errorMessage: parsed.error.errors[0]?.message ?? 'ZodError',
      },
      { userId, matterId: null, documentId, jobId: null },
    );
    return { state: DEFAULT_DEED_GATE_STATE, exists: true };
  }
  return { state: parsed.data, exists: true };
}

export interface UpsertDeedGateArgs {
  userId: string;
  matterId: string;
  documentId: string;
  state: DeedGateState;
  changedByUserId: string;
}

/**
 * Insert or update a deed document's gate state (the SOLE write path). Re-validates the WHOLE blob through
 * the Zod Wall before writing. One row per document (documentId UNIQUE); owner-scoped on read + write.
 */
export async function upsertDeedGateState(args: UpsertDeedGateArgs): Promise<ResolvedDeedGateState> {
  const validated = DeedGateStateSchema.parse(args.state);
  const existing = await db
    .select({ id: deedGate.id })
    .from(deedGate)
    .where(and(ownerScope(deedGate.userId, args.userId), eq(deedGate.documentId, args.documentId)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(deedGate)
      .set({ state: validated, changedByUserId: args.changedByUserId })
      .where(and(ownerScope(deedGate.userId, args.userId), eq(deedGate.documentId, args.documentId)));
  } else {
    const row: NewDeedGate = {
      id: uuidv4(),
      userId: args.userId,
      matterId: args.matterId,
      documentId: args.documentId,
      state: validated,
      changedByUserId: args.changedByUserId,
    };
    await db.insert(deedGate).values(row);
  }
  return getDeedGateState(args.documentId, args.userId);
}

/**
 * Count the deed document's bound grantor/grantee parties (document_party.roleKey). Drives the Assembly gate
 * (a deed needs >=1 of each). Owner-scoped via listDocumentParties.
 */
export async function countDeedPartyBindings(documentId: string, userId: string): Promise<DeedPartyBinding> {
  const parties = await listDocumentParties(documentId, userId);
  return {
    grantorCount: parties.filter((p) => p.roleKey === 'grantor').length,
    granteeCount: parties.filter((p) => p.roleKey === 'grantee').length,
  };
}
