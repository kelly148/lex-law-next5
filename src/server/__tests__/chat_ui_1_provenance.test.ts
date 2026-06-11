/**
 * CHAT-UI-1 W1 — the hard-stop floor + provenance entry (pure logic, brief §0/§2.5).
 */
import { describe, it, expect } from 'vitest';

import {
  HARD_STOP_ACTS,
  POSTURE_ACTS,
  isPostureAct,
  buildProvenanceEntry,
} from '../../shared/posture/provenance.js';
import type { Posture } from '../../shared/posture/postureCoherence.js';

describe('hard-stop floor (brief §0)', () => {
  it('contains exactly the original five + the posture trio', () => {
    expect([...HARD_STOP_ACTS].sort()).toEqual(
      ['disposition', 'issuer', 'lock', 'matter_identity', 'privilege', 'recipient', 'send', 'tier_source'].sort(),
    );
    expect(HARD_STOP_ACTS).toHaveLength(8);
  });

  it('the posture trio is issuer / privilege / recipient', () => {
    expect([...POSTURE_ACTS].sort()).toEqual(['issuer', 'privilege', 'recipient']);
    expect(isPostureAct('issuer')).toBe(true);
    expect(isPostureAct('privilege')).toBe(true);
    expect(isPostureAct('recipient')).toBe(true);
    expect(isPostureAct('lock')).toBe(false);
    expect(isPostureAct('send')).toBe(false);
  });
});

describe('buildProvenanceEntry (brief §2.5)', () => {
  const next: Posture = {
    issuer: { entity: 'the owners', capacity: 'principal' },
    privilege: false,
    recipient: 'adverse',
  };

  it('records actor/slider/trigger/timestamp and derives the resolved recipient from the next triple', () => {
    const entry = buildProvenanceEntry({
      act: 'recipient',
      actor: 'kelly',
      sliderPosition: 'Propose-and-Confirm',
      triggerSource: 'posture-change',
      at: '2026-06-11T12:00:00.000Z',
      priorTriple: { issuer: { entity: 'the firm', capacity: 'counsel' }, privilege: false, recipient: 'internal_client' },
      nextTriple: next,
    });
    expect(entry.actor).toBe('kelly');
    expect(entry.sliderPosition).toBe('Propose-and-Confirm');
    expect(entry.triggerSource).toBe('posture-change');
    expect(entry.at).toBe('2026-06-11T12:00:00.000Z');
    expect(entry.priorTriple?.issuer.capacity).toBe('counsel');
    expect(entry.nextTriple?.issuer.capacity).toBe('principal');
    expect(entry.resolvedRecipient).toBe('adverse');
    expect(entry.acknowledged).toEqual([]);
  });

  it('a non-posture act has no triple and a null resolved recipient', () => {
    const entry = buildProvenanceEntry({
      act: 'lock',
      actor: 'kelly',
      sliderPosition: 'Auto-Act',
      triggerSource: 'lock-button',
      at: '2026-06-11T12:00:00.000Z',
    });
    expect(entry.priorTriple).toBeNull();
    expect(entry.nextTriple).toBeNull();
    expect(entry.resolvedRecipient).toBeNull();
  });
});
