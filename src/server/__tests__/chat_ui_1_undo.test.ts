/**
 * CHAT-UI-1 W3b — undo-by-band (UNDO-SEMANTICS-1).
 *
 * Acceptance: a cosmetic edit undoes with no prompt and no record; undoing a hard-stop act surfaces a
 * confirm (the original act, through ConsequenceConfirm) AND records the reversal in the provenance
 * ledger with a {type:'undo'} subject. The per-band rule is auditable enumerated data.
 */
import { describe, it, expect } from 'vitest';

import {
  UNDO_RULES,
  bandForAct,
  undoRequiresConfirm,
  undoRequiresRecord,
  planUndo,
} from '../../shared/posture/undoBands.js';
import { HARD_STOP_ACTS, buildProvenanceEntry } from '../../shared/posture/provenance.js';

describe('undo-by-band rules (auditable enumerated data)', () => {
  it('cosmetic undoes silently — no confirm, no record', () => {
    expect(undoRequiresConfirm('cosmetic')).toBe(false);
    expect(undoRequiresRecord('cosmetic')).toBe(false);
  });
  it('hard_stop undo requires a confirm AND a recorded reversal', () => {
    expect(undoRequiresConfirm('hard_stop')).toBe(true);
    expect(undoRequiresRecord('hard_stop')).toBe(true);
  });
  it('every hard-stop act is in the hard_stop band', () => {
    for (const act of HARD_STOP_ACTS) expect(bandForAct(act)).toBe('hard_stop');
  });
  it('the table enumerates exactly the two bands', () => {
    expect(UNDO_RULES).toHaveLength(2);
    expect(UNDO_RULES.map((r) => r.band).sort()).toEqual(['cosmetic', 'hard_stop']);
  });
});

describe('planUndo', () => {
  it('cosmetic: silent — no confirm, no subject', () => {
    const p = planUndo({ band: 'cosmetic' });
    expect(p.requiresConfirm).toBe(false);
    expect(p.requiresRecord).toBe(false);
    expect(p.confirmAct).toBeNull();
    expect(p.subject).toBeNull();
  });

  it('hard_stop: confirm the reversed act + record a {type:"undo"} subject', () => {
    const p = planUndo({ band: 'hard_stop', act: 'send', entryId: 'entry-123' });
    expect(p.requiresConfirm).toBe(true);
    expect(p.requiresRecord).toBe(true);
    expect(p.confirmAct).toBe('send');
    expect(p.subject).toEqual({
      type: 'undo',
      id: 'entry-123',
      label: 'send',
      detail: 'reversal of a hard-stop act',
    });
  });

  it('the hard_stop undo produces a recordable reversal entry (routes through the provenance contract)', () => {
    const p = planUndo({ band: 'hard_stop', act: 'lock', entryId: 'e1' });
    const entry = buildProvenanceEntry({
      act: p.confirmAct!,
      subject: p.subject,
      actor: 'kelly',
      sliderPosition: 'Propose-and-Confirm',
      triggerSource: 'undo',
      at: '2026-06-11T00:00:00.000Z',
    });
    expect(entry.act).toBe('lock');
    expect(entry.eventClass).toBe('meaningful_accept');
    expect(entry.subject?.type).toBe('undo');
    expect(entry.subject?.id).toBe('e1');
  });
});
