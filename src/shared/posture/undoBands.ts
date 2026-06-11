/**
 * CHAT-UI-1 W3 — undo-by-band (UNDO-SEMANTICS-1, context integrity).
 *
 * Undo is tiered by consequence band, not uniform (brief W3 §2):
 *  - cosmetic (typography, doc type, margins): undo freely + silently.
 *  - hard_stop (the 8 hard-stop acts): undo is ITSELF consequential — you cannot silently reverse a
 *    posture / send / lock / disposition. It routes through the shared ConsequenceConfirm and writes a
 *    provenance entry (the reversal is an act of record).
 *
 * The per-band rule is enumerated, auditable data — same discipline as the incoherence table — and the
 * undo path reuses W1 (ConsequenceConfirm) + W2 (provenance contract, recording the reversal with a
 * {type:'undo'} subject). Extensible: add a band + an UNDO_RULES row if a middle tier emerges.
 */
import type { HardStopAct, ProvenanceSubject } from './provenance.js';

export type ConsequenceBand = 'cosmetic' | 'hard_stop';

export interface UndoRule {
  band: ConsequenceBand;
  /** Undoing in this band routes through the consequence-tier confirm. */
  requiresConfirm: boolean;
  /** Undoing in this band writes a provenance entry (the reversal is itself recorded). */
  requiresRecord: boolean;
}

/** Enumerated, auditable per-band undo rules. */
export const UNDO_RULES: readonly UndoRule[] = [
  { band: 'cosmetic', requiresConfirm: false, requiresRecord: false },
  { band: 'hard_stop', requiresConfirm: true, requiresRecord: true },
];

export function undoRuleFor(band: ConsequenceBand): UndoRule {
  const rule = UNDO_RULES.find((r) => r.band === band);
  if (!rule) throw new Error(`no undo rule for band: ${band}`); // exhaustive over ConsequenceBand
  return rule;
}

export function undoRequiresConfirm(band: ConsequenceBand): boolean {
  return undoRuleFor(band).requiresConfirm;
}

export function undoRequiresRecord(band: ConsequenceBand): boolean {
  return undoRuleFor(band).requiresRecord;
}

/** Every hard-stop act is in the hard_stop band; its undo is consequential. */
export function bandForAct(_act: HardStopAct): ConsequenceBand {
  return 'hard_stop';
}

export interface UndoTarget {
  band: ConsequenceBand;
  /** For a hard_stop undo: the original act being reversed + its provenance entry id. */
  act?: HardStopAct;
  entryId?: string;
}

export interface UndoPlan {
  band: ConsequenceBand;
  requiresConfirm: boolean;
  requiresRecord: boolean;
  /** The act to route the undo confirm through (the act being reversed); null for a silent cosmetic undo. */
  confirmAct: HardStopAct | null;
  /** The provenance subject recording the reversal; null for a silent cosmetic undo. */
  subject: ProvenanceSubject | null;
}

/**
 * Plan an undo by consequence band. Cosmetic -> silent, no record. Hard-stop -> route the original act
 * through ConsequenceConfirm and record the reversal (subject {type:'undo', id: <reversed entry>}).
 */
export function planUndo(target: UndoTarget): UndoPlan {
  const rule = undoRuleFor(target.band);
  if (!rule.requiresConfirm) {
    return {
      band: target.band,
      requiresConfirm: false,
      requiresRecord: rule.requiresRecord,
      confirmAct: null,
      subject: null,
    };
  }
  return {
    band: target.band,
    requiresConfirm: true,
    requiresRecord: rule.requiresRecord,
    confirmAct: target.act ?? null,
    subject: {
      type: 'undo',
      id: target.entryId ?? null,
      label: target.act ?? null,
      detail: 'reversal of a hard-stop act',
    },
  };
}
