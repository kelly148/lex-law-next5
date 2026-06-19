/**
 * firm_conflict_policy query layer (Zod Wall + ownerScope) — CONFLICT-TOGGLE-1 Inc 1.
 *
 * The SOLE read/write path for the firm-scoped conflicts posture policy. APPEND-ONLY: setFirmConflictPolicy
 * INSERTs a new row; the latest row (by firmOwnerUserId, createdAt) is current; there is no UPDATE/DELETE,
 * so the row history is the tamper-evident settings-audit. Owner filtering goes through ownerScope() (the
 * FOLD-AUTH chokepoint — the ratchet bans inline owner-column equality in new files).
 *
 * FAIL-CLOSED (disposition item 4): a read that finds no row OR cannot parse the persisted blob returns the
 * DEFAULT-SAFE policy (ENFORCED), never throws. An ethics gate must be safe under absence/corruption — the
 * deliberate opposite of the throw-on-parse-failure posture used for non-safety blobs (e.g. user_preferences).
 *
 * firmOwnerUserId is the firm identity (v1 single-tenant: == the acting attorney's userId).
 */

import { v4 as uuidv4 } from 'uuid';
import { desc } from 'drizzle-orm';
import { db } from '../connection.js';
import { firmConflictPolicy, type NewFirmConflictPolicy } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  ConflictPolicySchema,
  DEFAULT_CONFLICT_POLICY,
  type ConflictPolicy,
} from '../../../shared/schemas/conflictPolicy.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';

export interface ResolvedFirmPolicy {
  policy: ConflictPolicy;
  /** 'persisted' = an affirmatively-set firm policy; 'default' = none/unparseable → the safe default. */
  source: 'persisted' | 'default';
}

/**
 * Read the firm's CURRENT conflicts posture policy (the latest append-only row). FAIL-CLOSED: no row or an
 * unparseable blob → DEFAULT_CONFLICT_POLICY (ENFORCED). The SOLE read path.
 */
export async function getFirmConflictPolicy(firmOwnerUserId: string): Promise<ResolvedFirmPolicy> {
  const rows = await db
    .select()
    .from(firmConflictPolicy)
    .where(ownerScope(firmConflictPolicy.firmOwnerUserId, firmOwnerUserId))
    .orderBy(desc(firmConflictPolicy.createdAt))
    .limit(1);

  if (rows.length === 0) {
    return { policy: DEFAULT_CONFLICT_POLICY, source: 'default' };
  }

  const parsed = ConflictPolicySchema.safeParse(rows[0]!.policy);
  if (!parsed.success) {
    // Malformed persisted policy → fail CLOSED to the safe default (never throw, never relax).
    void emitTelemetry(
      'zod_parse_failed',
      {
        schemaName: 'ConflictPolicySchema',
        tableName: 'firm_conflict_policy',
        errorPath: parsed.error.errors[0]?.path.join('.') ?? '',
        errorMessage: parsed.error.errors[0]?.message ?? 'ZodError',
      },
      { userId: firmOwnerUserId, matterId: null, documentId: null, jobId: null },
    );
    return { policy: DEFAULT_CONFLICT_POLICY, source: 'default' };
  }
  return { policy: parsed.data, source: 'persisted' };
}

export interface SetFirmConflictPolicyArgs {
  firmOwnerUserId: string;
  changedByUserId: string;
  policy: ConflictPolicy;
  reasonText?: string | null;
}

/**
 * Append a new version of the firm's conflicts posture policy (the SOLE write path). The input is re-
 * validated through the Zod Wall before the INSERT. Returns the now-current policy. Append-only — the prior
 * rows remain as the immutable history.
 */
export async function setFirmConflictPolicy(args: SetFirmConflictPolicyArgs): Promise<ResolvedFirmPolicy> {
  const validated = ConflictPolicySchema.parse(args.policy);
  const row: NewFirmConflictPolicy = {
    id: uuidv4(),
    firmOwnerUserId: args.firmOwnerUserId,
    policy: validated,
    changedByUserId: args.changedByUserId,
    reasonText: args.reasonText ?? null,
  };
  await db.insert(firmConflictPolicy).values(row);
  return getFirmConflictPolicy(args.firmOwnerUserId);
}

/**
 * The full append-only history for a firm (newest first), for the audit surface. Owner-scoped; parses each
 * row's policy fail-closed (an unparseable historical row is surfaced as the safe default rather than
 * dropped). Capped.
 */
export async function listFirmConflictPolicyHistory(
  firmOwnerUserId: string,
  limit = 100,
): Promise<Array<{ id: string; policy: ConflictPolicy; changedByUserId: string; reasonText: string | null; createdAt: Date }>> {
  const rows = await db
    .select()
    .from(firmConflictPolicy)
    .where(ownerScope(firmConflictPolicy.firmOwnerUserId, firmOwnerUserId))
    .orderBy(desc(firmConflictPolicy.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const parsed = ConflictPolicySchema.safeParse(r.policy);
    return {
      id: r.id,
      policy: parsed.success ? parsed.data : DEFAULT_CONFLICT_POLICY,
      changedByUserId: r.changedByUserId,
      reasonText: r.reasonText,
      createdAt: r.createdAt,
    };
  });
}
