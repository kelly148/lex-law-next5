/**
 * egress_hold query layer + the scoped-hold EVALUATOR — EGRESS-CONTROL-PLANE-1.
 *
 * resolveEffectiveHold(subject) returns the most-restrictive active no_external hold across
 * global > matter > conversation for a given egress subject. The DOCUMENT egress path checks matter +
 * global (a document subject has no conversation); chat keeps its conversation.holdFlag. A conversation
 * hold must NOT block unrelated matters; a matter/global hold MUST reach document sends.
 *
 * FAIL-CLOSED CONTRACT: this module returns a clean EffectiveHold OR THROWS — it NEVER silently returns
 * 'none' on a DB error. The caller (the document egress path) treats a throw as "hold-check-uncertain ⇒
 * block" (auditability over availability). conversation.holdFlag (chat) is untouched.
 *
 * TEST SEAM: setEgressHoldStore(...) injects an in-memory store so the evaluator is exercised without a DB.
 */
import { and, eq, or } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import { egressHold, type NewEgressHold } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import {
  EgressHoldRowSchema,
  EGRESS_HOLD_SCOPE_PRECEDENCE,
  type EgressHoldRow,
  type EgressHoldScope,
  type EgressHoldFlag,
  type EgressSubject,
} from '../../../shared/schemas/egress.js';

function parse(raw: unknown, userId: string): EgressHoldRow {
  try {
    return EgressHoldRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'EgressHoldRowSchema',
          tableName: 'egress_hold',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

/** The resolved binding hold for a subject: the flag + which scope supplied it (provenance for the row). */
export interface EffectiveHold {
  holdFlag: EgressHoldFlag; // 'none' when no active hold binds
  scope: EgressHoldScope | null; // which scope supplied the binding hold; null when none
}

export interface EgressHoldStore {
  /** Active holds applicable to (userId, matterId[, conversationId]): global + matter(subjectId=matterId)
   *  + conversation(subjectId=conversationId, only when conversationId given). Owner-scoped. */
  listActiveForSubject(userId: string, matterId: string, conversationId: string | null): Promise<EgressHoldRow[]>;
  insert(row: NewEgressHold): Promise<void>;
}

const drizzleStore: EgressHoldStore = {
  async listActiveForSubject(userId, matterId, conversationId) {
    const scopeConds = [
      eq(egressHold.scope, 'global'),
      and(eq(egressHold.scope, 'matter'), eq(egressHold.subjectId, matterId)),
      ...(conversationId ? [and(eq(egressHold.scope, 'conversation'), eq(egressHold.subjectId, conversationId))] : []),
    ];
    const rows = await db
      .select()
      .from(egressHold)
      .where(and(ownerScope(egressHold.userId, userId), eq(egressHold.active, true), or(...scopeConds)));
    return rows.map((r) => parse(r, userId));
  },
  async insert(row) {
    await db.insert(egressHold).values(row);
  },
};

let _store: EgressHoldStore | null = null;
/** Test seam: inject an in-memory hold store (pass null to restore the real Drizzle store). */
export function setEgressHoldStore(store: EgressHoldStore | null): void {
  _store = store;
}
function store(): EgressHoldStore {
  return _store ?? drizzleStore;
}

/**
 * Resolve the most-restrictive active no_external hold for an egress subject, across global > matter >
 * conversation (precedence: a higher-scope hold binds over a lower one). Returns {holdFlag:'none'} when no
 * active no_external hold applies. THROWS on a store error (the caller fails closed on uncertainty).
 */
export async function resolveEffectiveHold(subject: EgressSubject): Promise<EffectiveHold> {
  const conversationId = subject.type === 'conversation' ? subject.conversationId : null;
  const rows = await store().listActiveForSubject(subject.userId, subject.matterId, conversationId);
  for (const scope of EGRESS_HOLD_SCOPE_PRECEDENCE) {
    if (rows.some((r) => r.scope === scope && r.holdFlag === 'no_external')) {
      return { holdFlag: 'no_external', scope };
    }
  }
  return { holdFlag: 'none', scope: null };
}

/** Record a scoped egress hold. Increment 1 ships the hold MODEL + evaluator (no kill-switch UI while
 *  blocking coverage is partial — a hold that lies is worse than none). Exposed for tests + future
 *  operator-gated hold management. */
export function recordEgressHold(row: NewEgressHold): Promise<void> {
  return store().insert(row);
}
