/**
 * CHAT-UI-1 W1 — the hard-stop floor + the provenance-ledger entry (brief §0/§2.5).
 *
 * The hard-stop floor (brief §0): acts that ALWAYS require an explicit, recorded, deliberate human
 * confirm at every autonomy-slider position — the original five plus the posture trio. Every such act
 * routes through the shared ConsequenceConfirm component (brief §3 law-6) and, on confirm, emits a
 * ProvenanceEntry. Durable, exportable storage is W2 (PROVENANCE-LEDGER-1); this file is the contract.
 *
 * SHARED so the client confirm component and any server-side recorder agree on the entry shape.
 */
import type { CoherenceFinding, Posture, RecipientClass } from './postureCoherence.js';

export type HardStopAct =
  | 'lock'
  | 'tier_source'
  | 'disposition'
  | 'send'
  | 'matter_identity'
  | 'issuer'
  | 'privilege'
  | 'recipient';

/** The full hard-stop floor (brief §0) — the original five + the posture trio. */
export const HARD_STOP_ACTS: readonly HardStopAct[] = [
  'lock',
  'tier_source',
  'disposition',
  'send',
  'matter_identity',
  'issuer',
  'privilege',
  'recipient',
];

/** The posture-trio subset — the acts that carry the {issuer, privilege, recipient} triple. */
export const POSTURE_ACTS: readonly HardStopAct[] = ['issuer', 'privilege', 'recipient'];

export function isPostureAct(act: HardStopAct): boolean {
  return POSTURE_ACTS.includes(act);
}

/**
 * The two §3 provenance event classes, logged distinguishably (brief §2.5 / W2):
 *  - 'meaningful_accept' — a deliberate, individual confirm of a consequential act / posture change.
 *  - 'dirty_confirmed'   — a previously-dirty (pending) posture confirm cleared as a transition
 *                          (e.g. an Auto-Act batch clear), logged non-blocking.
 */
export type ProvenanceEventClass = 'meaningful_accept' | 'dirty_confirmed';

/**
 * The TARGET a non-posture hard-stop act acted on (W3): the bound matter for a matter-identity
 * confirm, the reversed entry for an undo, etc. Posture acts carry their detail in the triple; this
 * generic descriptor lets the other hard-stop acts record what they confirmed. Mirrors the
 * audit_events targetType/targetId idiom. All fields non-optional (id/label/detail nullable) so the
 * shape round-trips losslessly through the JSON column under exactOptionalPropertyTypes.
 */
export interface ProvenanceSubject {
  type: string; // 'matter' | 'undo' | 'source' | 'document' | ...
  id: string | null;
  label: string | null;
  detail: string | null;
}

/**
 * A meaningful confirm record (brief §2.5): actor, slider position, timestamp, trigger source,
 * prior -> new triple, and the resolved recipient at egress. `acknowledged` captures the coherence
 * findings the attorney saw and accepted at confirm time. `eventClass` distinguishes the two §3
 * classes for the durable audit ledger (W2). `subject` records the target of a non-posture
 * hard-stop act (W3); null for posture acts (whose target is the triple).
 */
export interface ProvenanceEntry {
  act: HardStopAct;
  eventClass: ProvenanceEventClass;
  subject: ProvenanceSubject | null;
  actor: string;
  sliderPosition: string;
  triggerSource: string;
  at: string; // ISO-8601
  priorTriple: Posture | null;
  nextTriple: Posture | null;
  resolvedRecipient: RecipientClass | null;
  acknowledged: CoherenceFinding[];
}

export interface BuildProvenanceInput {
  act: HardStopAct;
  /** Defaults to 'meaningful_accept' (a deliberate individual confirm). */
  eventClass?: ProvenanceEventClass;
  /** The non-posture act's target (W3); defaults to null. */
  subject?: ProvenanceSubject | null;
  actor: string;
  sliderPosition: string;
  triggerSource: string;
  at: string;
  priorTriple?: Posture | null;
  nextTriple?: Posture | null;
  acknowledged?: CoherenceFinding[];
}

/**
 * Pure builder for a provenance entry. `at` is injected (never read from a wall clock here) so the
 * record is deterministic and testable; the UI passes new Date().toISOString() at confirm time. The
 * resolved recipient at egress derives from the next triple.
 */
export function buildProvenanceEntry(input: BuildProvenanceInput): ProvenanceEntry {
  const nextTriple = input.nextTriple ?? null;
  return {
    act: input.act,
    eventClass: input.eventClass ?? 'meaningful_accept',
    subject: input.subject ?? null,
    actor: input.actor,
    sliderPosition: input.sliderPosition,
    triggerSource: input.triggerSource,
    at: input.at,
    priorTriple: input.priorTriple ?? null,
    nextTriple,
    resolvedRecipient: nextTriple ? nextTriple.recipient : null,
    acknowledged: input.acknowledged ?? [],
  };
}
