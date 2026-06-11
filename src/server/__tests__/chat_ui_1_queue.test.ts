/**
 * CHAT-UI-1 W1 — Auto-Act posture queue + ratified D1 carve-out + egress check (pure logic).
 *
 * The D1 carve-out is the load-bearing assertion: an adverse / third-party recipient confirm can
 * NEVER be batch-cleared, even though other posture confirms queue (brief §2.6, ratified 2026-06-11).
 */
import { describe, it, expect } from 'vitest';

import type { Posture } from '../../shared/posture/postureCoherence.js';
import {
  NON_BATCHABLE_RECIPIENTS,
  isBatchableRecipient,
  makePostureConfirmRequest,
  summarizeQueue,
  clearBatch,
  evaluateEgress,
} from '../../shared/posture/postureQueue.js';

const COUNSEL = { entity: 'the firm', capacity: 'counsel' } as const;
const PRINCIPAL = { entity: 'the company', capacity: 'principal' } as const;

const p = (over: Partial<Posture>): Posture => ({
  issuer: { ...COUNSEL },
  privilege: null,
  recipient: 'internal_client',
  ...over,
});

describe('D1 carve-out recipient classification', () => {
  it('internal/client and co-counsel/agent are batchable; third-party and beyond are not', () => {
    expect(isBatchableRecipient('internal_client')).toBe(true);
    expect(isBatchableRecipient('co_counsel_agent')).toBe(true);
    expect(isBatchableRecipient('neutral_third_party')).toBe(false);
    expect(isBatchableRecipient('regulator_court')).toBe(false);
    expect(isBatchableRecipient('adverse')).toBe(false);
    expect(isBatchableRecipient('public')).toBe(false);
  });

  it('the carve-out set is the external recipients', () => {
    expect([...NON_BATCHABLE_RECIPIENTS].sort()).toEqual(
      ['adverse', 'neutral_third_party', 'public', 'regulator_court'].sort(),
    );
  });
});

describe('makePostureConfirmRequest', () => {
  it('a coherent internal/client confirm is batchable and not blocked', () => {
    const r = makePostureConfirmRequest({
      id: 'a',
      prior: p({ privilege: null }),
      next: p({ privilege: true }),
    });
    expect(r.batchable).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.findings).toEqual([]);
    expect(r.triggers?.privilege).toBe(true);
  });

  it('a non-privileged adverse confirm is NOT batchable (carve-out) but not blocked', () => {
    const r = makePostureConfirmRequest({ id: 'b', next: p({ privilege: false, recipient: 'adverse' }) });
    expect(r.batchable).toBe(false);
    expect(r.blocked).toBe(false);
  });

  it('a privileged adverse confirm is blocked (HARD) and not batchable', () => {
    const r = makePostureConfirmRequest({ id: 'c', next: p({ privilege: true, recipient: 'adverse' }) });
    expect(r.blocked).toBe(true);
    expect(r.batchable).toBe(false);
    expect(r.findings.map((f) => f.id)).toContain('priv-to-adverse');
  });
});

describe('clearBatch honors the carve-out and HARD blocks', () => {
  const queue = [
    makePostureConfirmRequest({ id: 'internal', next: p({ privilege: true, recipient: 'internal_client' }) }),
    makePostureConfirmRequest({ id: 'cocounsel', next: p({ privilege: false, recipient: 'co_counsel_agent' }) }),
    makePostureConfirmRequest({ id: 'adverse', next: p({ privilege: false, recipient: 'adverse' }) }),
    makePostureConfirmRequest({ id: 'hard', next: p({ privilege: true, recipient: 'adverse' }) }),
  ];

  it('clears only the batchable, non-blocked confirms; carve-out + HARD remain', () => {
    const { cleared, remaining } = clearBatch(queue);
    expect(cleared.map((r) => r.id).sort()).toEqual(['cocounsel', 'internal']);
    expect(remaining.map((r) => r.id).sort()).toEqual(['adverse', 'hard']);
  });

  it('summarizeQueue counts each lane and renders the waiting label', () => {
    const s = summarizeQueue(queue);
    expect(s.total).toBe(4);
    expect(s.batchClearable).toBe(2);
    expect(s.individual).toBe(1); // the adverse carve-out (not blocked)
    expect(s.blocked).toBe(1); // the privileged-adverse HARD
    expect(s.label).toBe('4 posture confirms waiting');
  });

  it('the label is singular for one confirm', () => {
    expect(summarizeQueue([queue[0]!]).label).toBe('1 posture confirm waiting');
  });
});

describe('evaluateEgress (brief §2.3 send/lock backstop)', () => {
  it('blocks a send to an adverse party with privilege undetermined', () => {
    const v = evaluateEgress(p({ issuer: { ...PRINCIPAL }, privilege: null, recipient: 'adverse' }));
    expect(v.blocked).toBe(true);
    expect(v.findings.map((f) => f.id)).toContain('adverse-privilege-unset');
  });

  it('passes a coherent resolved triple (privileged counsel to client)', () => {
    const v = evaluateEgress(p({ privilege: true, recipient: 'internal_client' }));
    expect(v.blocked).toBe(false);
    expect(v.findings).toEqual([]);
  });

  it('blocks a privileged document resolved to an adverse recipient', () => {
    const v = evaluateEgress(p({ issuer: { ...PRINCIPAL }, privilege: true, recipient: 'adverse' }));
    expect(v.blocked).toBe(true);
  });
});
