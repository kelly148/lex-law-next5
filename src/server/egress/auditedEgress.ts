/**
 * EGRESS-CONTROL-PLANE-1 — the shared, surface-agnostic egress-audit-and-hold PRIMITIVE.
 *
 * The single control-flow skeleton EVERY external-model send of client/matter content goes through. It
 * owns ONLY the universal ordering + the load-bearing GLBA/fail-closed invariants; everything
 * surface-specific (hold rules, the audit row shape + writer, the dispatch) is injected by the adapter.
 *
 *   1. evaluateHold()        → { decision, blockReason }   (the adapter FAILS CLOSED here)
 *   2. recordDecision()      — write the decision row SYNCHRONOUSLY, BEFORE dispatch (blocked rows too)
 *   3. blocked? → throw onBlocked()                        — NO dispatch (fail-closed)
 *   4. dispatch()            — on throw: completeDecision(failure) + rethrow
 *   5. completeDecision()    — best-effort outcome update (never masks the dispatch result)
 *
 * This is the byte-for-byte ordering of the original chat egressClient.send(). The chat broker and the
 * document-egress path are thin ADAPTERS over this skeleton, so the invariants live in ONE place:
 *   - the audit-write is SYNCHRONOUS and BEFORE dispatch — a send cannot leave without a durable logged
 *     decision (auditability over availability); a recordDecision throw ABORTS the send (no unlogged egress);
 *   - a blocked decision throws WITHOUT dispatching (fail-closed);
 *   - exactly ONE dispatch closure is wrapped (no silent provider fallback — a different provider is a
 *     separate auditedEgress() call = a separate gate + a separate event);
 *   - completion is best-effort so a failed outcome update never masks the real dispatch result.
 *
 * The primitive imports NO provider primitive — it wraps an opaque dispatch closure, so it is not itself a
 * provider-reaching module (the CI guard's containment invariant).
 */

export interface AuditedEgressDecision {
  decision: 'allowed' | 'blocked';
  blockReason: string | null;
}

export interface AuditedEgressHandlers<Result> {
  /** A stable id for this egress decision (the adapter mints it so it can also stamp it on the row and on
   *  the blocked error it returns from onBlocked). */
  eventId: string;
  /**
   * Evaluate the gate. FAIL-CLOSED CONTRACT: if the adapter cannot CONFIRM there is no applicable hold
   * (e.g. the hold-store read threw), it MUST return { decision:'blocked', blockReason:'hold_check_uncertain' }
   * — it must NOT throw to signal a hold and must NEVER return 'allowed' on uncertainty.
   */
  evaluateHold: () => Promise<AuditedEgressDecision> | AuditedEgressDecision;
  /**
   * Write the decision row SYNCHRONOUSLY, before dispatch. Receives the resolved decision so a blocked row
   * is logged too. A throw here ABORTS the send (fail-closed: auditability over availability — no unlogged
   * egress); the adapter's caller maps that to its degraded outcome.
   */
  recordDecision: (decision: AuditedEgressDecision) => Promise<void>;
  /** Build the error thrown for a blocked send (AFTER the blocked row is durably recorded). */
  onBlocked: (blockReason: string) => Error;
  /** The single provider dispatch — the only path to an external model for this send. */
  dispatch: () => Promise<Result>;
  /** Complete the decision row with the dispatch outcome. Best-effort: a throw here is swallowed so a
   *  failed completion never masks the real dispatch result (the decision row is already durable). */
  completeDecision: (outcome: { ok: true; result: Result } | { ok: false; error: unknown }) => Promise<void>;
}

export interface AuditedEgressResult<Result> {
  eventId: string;
  result: Result;
}

export async function auditedEgress<Result>(
  h: AuditedEgressHandlers<Result>,
): Promise<AuditedEgressResult<Result>> {
  // 1) GATE. The adapter has already failed closed on any hold-check uncertainty (returns 'blocked').
  const decision = await h.evaluateHold();

  // 2) LOG the decision SYNCHRONOUSLY, BEFORE dispatch — a send cannot leave without a durable logged
  //    decision (blocked rows too). A throw here ABORTS the send: no unlogged egress.
  await h.recordDecision(decision);

  // 3) FAIL-CLOSED: a blocked decision throws WITHOUT dispatching. The blocked row is already durable.
  if (decision.decision === 'blocked') {
    throw h.onBlocked(decision.blockReason ?? 'blocked');
  }

  // 4) DISPATCH — the only path to a provider; no silent fallback. On error: complete as failure
  //    (best-effort) and rethrow.
  let result: Result;
  try {
    result = await h.dispatch();
  } catch (error) {
    await safeComplete(() => h.completeDecision({ ok: false, error }));
    throw error;
  }

  // 5) COMPLETE the row with the outcome — best-effort (never masks the dispatch result).
  await safeComplete(() => h.completeDecision({ ok: true, result }));
  return { eventId: h.eventId, result };
}

async function safeComplete(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // swallow — the decision row is already durable; a failed completion must not mask the dispatch outcome.
  }
}
