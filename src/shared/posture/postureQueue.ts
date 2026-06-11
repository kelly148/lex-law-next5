/**
 * CHAT-UI-1 W1 — Auto-Act posture-confirm queue + the ratified D1 carve-out + the egress check
 * (brief §2.3 / §2.6). Pure logic, shared so the client surface and any server recorder agree.
 *
 * D1 (ratified): in Auto-Act, posture confirms STACK ("N posture confirms waiting") for batch
 * clearing. D1 CARVE-OUT (ratified 2026-06-11): any set/transition to an adverse or third-party
 * recipient interrupts INDIVIDUALLY and can never be batch-cleared, even though other posture
 * confirms queue. Incoherent combos are already HARD-blocked by the coherence table.
 */
import {
  type Posture,
  type RecipientClass,
  type CoherenceFinding,
  type PostureTriggers,
  evaluateCoherence,
  hasHardBlock,
  posturePropertyTriggers,
} from './postureCoherence.js';

/**
 * The D1 carve-out scope: recipients that can NEVER be batch-cleared. "Adverse / third-party" =
 * any external recipient outside the representation circle (neutral third party and more exposed).
 * Enumerated, adjustable data — the legal scope is an attorney call, recorded here, not inferred.
 */
export const NON_BATCHABLE_RECIPIENTS: readonly RecipientClass[] = [
  'neutral_third_party',
  'regulator_court',
  'adverse',
  'public',
];

/** A recipient is batchable unless it falls under the carve-out (adverse / third-party). */
export function isBatchableRecipient(r: RecipientClass): boolean {
  return !NON_BATCHABLE_RECIPIENTS.includes(r);
}

export interface PostureConfirmRequest {
  id: string;
  prior: Posture | null;
  next: Posture;
  triggers: PostureTriggers | null;
  findings: CoherenceFinding[];
  /** A HARD finding is present -> the confirm cannot be cleared at all until the incoherence is resolved. */
  blocked: boolean;
  /** false when the carve-out applies (adverse / third-party recipient) -> must be handled individually. */
  batchable: boolean;
}

/** Build a queued posture-confirm request, computing its triggers, coherence findings, and carve-out status. */
export function makePostureConfirmRequest(args: {
  id: string;
  prior?: Posture | null;
  next: Posture;
  atEgress?: boolean;
}): PostureConfirmRequest {
  const findings = evaluateCoherence(args.next, { atEgress: args.atEgress ?? false });
  const prior = args.prior ?? null;
  return {
    id: args.id,
    prior,
    next: args.next,
    triggers: prior ? posturePropertyTriggers(prior, args.next) : null,
    findings,
    blocked: hasHardBlock(findings),
    batchable: isBatchableRecipient(args.next.recipient),
  };
}

export interface QueueSummary {
  total: number;
  /** Clearable in a batch (batchable AND not HARD-blocked). */
  batchClearable: number;
  /** Must be handled individually under the carve-out, and not HARD-blocked. */
  individual: number;
  /** HARD-blocked — cannot be cleared until the incoherence is resolved. */
  blocked: number;
  /** "N posture confirms waiting" (brief §2.6 D1). */
  label: string;
}

export function summarizeQueue(queue: readonly PostureConfirmRequest[]): QueueSummary {
  const blocked = queue.filter((q) => q.blocked).length;
  const batchClearable = queue.filter((q) => !q.blocked && q.batchable).length;
  const individual = queue.filter((q) => !q.blocked && !q.batchable).length;
  const total = queue.length;
  return {
    total,
    batchClearable,
    individual,
    blocked,
    label: `${total} posture ${total === 1 ? 'confirm' : 'confirms'} waiting`,
  };
}

/**
 * The batch-clear partition (brief §2.6 D1 + carve-out): ONLY batchable, non-blocked requests clear
 * in a batch. Adverse / third-party requests (the carve-out) and HARD-blocked requests REMAIN for
 * individual handling. Pure — never clears a carve-out request, never clears a HARD-blocked one.
 */
export function clearBatch(queue: readonly PostureConfirmRequest[]): {
  cleared: PostureConfirmRequest[];
  remaining: PostureConfirmRequest[];
} {
  const isBatch = (q: PostureConfirmRequest): boolean => q.batchable && !q.blocked;
  return {
    cleared: queue.filter(isBatch),
    remaining: queue.filter((q) => !isBatch(q)),
  };
}

export interface EgressVerdict {
  findings: CoherenceFinding[];
  /** A HARD finding blocks the send / lock. */
  blocked: boolean;
}

/**
 * Egress backstop (brief §2.3): run the coherence check on the RESOLVED triple vs the resolved
 * recipient at send / lock. A coherence check, not a drift-diff — the dangerous case is the field
 * that did NOT change (e.g. privilege left on while the recipient is adverse).
 */
export function evaluateEgress(resolved: Posture): EgressVerdict {
  const findings = evaluateCoherence(resolved, { atEgress: true });
  return { findings, blocked: hasHardBlock(findings) };
}
