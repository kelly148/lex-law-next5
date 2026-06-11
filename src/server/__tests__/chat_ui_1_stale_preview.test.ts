/**
 * CHAT-UI-1 W3c — concurrency / stale-preview guard (CONCURRENCY-GUARD-1).
 *
 * Acceptance: acting on a preview whose underlying triple changed mid-flight is caught and re-confirmed
 * against the RESOLVED CURRENT state, not the stale one — and the §3 danger (the field that didn't
 * change in the operator's mind) is surfaced: privilege left "on" while recipient silently moves to
 * adverse re-confirms as a HARD block, even though privilege itself never changed.
 */
import { describe, it, expect } from 'vitest';

import type { Posture } from '../../shared/posture/postureCoherence.js';
import { capturePreview, isPreviewStale, resolveStaleAction } from '../../shared/posture/stalePreview.js';

const COUNSEL = { entity: 'the firm', capacity: 'counsel' } as const;
const p = (over: Partial<Posture>): Posture => ({
  issuer: { ...COUNSEL },
  privilege: true,
  recipient: 'internal_client',
  ...over,
});

describe('isPreviewStale', () => {
  it('an unchanged triple is not stale', () => {
    const snap = capturePreview(p({}));
    expect(isPreviewStale(snap, p({}))).toBe(false);
  });
  it('a moved recipient is stale', () => {
    const snap = capturePreview(p({ recipient: 'internal_client' }));
    expect(isPreviewStale(snap, p({ recipient: 'adverse' }))).toBe(true);
  });
  it('a moved privilege is stale', () => {
    const snap = capturePreview(p({ privilege: true }));
    expect(isPreviewStale(snap, p({ privilege: false }))).toBe(true);
  });
});

describe('resolveStaleAction — re-confirm against CURRENT, not the stale view', () => {
  it('the dangerous case: recipient silently moved to adverse while privilege stayed on -> stale + HARD', () => {
    const snapshot = capturePreview(p({ privilege: true, recipient: 'internal_client' })); // coherent when previewed
    const current = p({ privilege: true, recipient: 'adverse' }); // recipient moved; privilege UNCHANGED

    const r = resolveStaleAction(snapshot, current);

    expect(r.stale).toBe(true);
    // The re-confirm binds to the CURRENT resolved triple, never the stale snapshot.
    expect(r.reConfirmTriple).toEqual(current);
    // The field that DID change is recipient; privilege did NOT change in the operator's mind...
    expect(r.changed.recipient).toBe(true);
    expect(r.changed.privilege).toBe(false);
    // ...yet the coherence re-check on the WHOLE current triple catches the now-HARD privileged x adverse.
    expect(r.blocked).toBe(true);
    expect(r.findings.map((f) => f.id)).toContain('priv-to-adverse');
  });

  it('not stale: same triple -> proceed (no drift, current coherence still computed)', () => {
    const snapshot = capturePreview(p({ privilege: true, recipient: 'internal_client' }));
    const r = resolveStaleAction(snapshot, p({ privilege: true, recipient: 'internal_client' }));
    expect(r.stale).toBe(false);
    expect(r.blocked).toBe(false);
    expect(r.findings).toEqual([]);
  });
});
