/**
 * D3-SIGNOFF A.1 Inc 4 — the sign-off gate decision (NC-D3-1 dual-prong + NC-D3-3 three-tier) + the content-hash
 * binding that makes a sign-off supersede on any material change. Pure; the router uses evaluateSignoffDecision
 * directly, so this IS the enforced logic.
 */
import { describe, it, expect } from 'vitest';
import { evaluateSignoffDecision, hashDeedContent, hashSourceFacts } from '../deed/d3Signoff.js';

describe('A.1 Inc4 — evaluateSignoffDecision', () => {
  const attested = { attorneyAttestedVsOriginal: true, notOcrOnly: true };

  it('hard_block is NON-overridable — refused even with attestation + override (NC-D3-3)', () => {
    expect(evaluateSignoffDecision({ tier: 'hard_block', ...attested, hasOverride: true })).toEqual({ ok: false, code: 'D3_HARD_BLOCK' });
    // hard_block short-circuits before the attestation check.
    expect(evaluateSignoffDecision({ tier: 'hard_block', attorneyAttestedVsOriginal: false, notOcrOnly: false, hasOverride: false })).toEqual({ ok: false, code: 'D3_HARD_BLOCK' });
  });

  it('the dual-prong attestation is mandatory (NC-D3-1)', () => {
    expect(evaluateSignoffDecision({ tier: 'pass', attorneyAttestedVsOriginal: false, notOcrOnly: true, hasOverride: false })).toEqual({ ok: false, code: 'D3_ATTESTATION_REQUIRED' });
    expect(evaluateSignoffDecision({ tier: 'pass', attorneyAttestedVsOriginal: true, notOcrOnly: false, hasOverride: false })).toEqual({ ok: false, code: 'D3_ATTESTATION_REQUIRED' });
  });

  it('pass with attestation -> verdict pass', () => {
    expect(evaluateSignoffDecision({ tier: 'pass', ...attested, hasOverride: false })).toEqual({ ok: true, verdict: 'pass' });
  });

  it('overridable_block needs the high-friction override -> overridden (NC-D3-3)', () => {
    expect(evaluateSignoffDecision({ tier: 'overridable_block', ...attested, hasOverride: false })).toEqual({ ok: false, code: 'D3_OVERRIDE_REQUIRED' });
    expect(evaluateSignoffDecision({ tier: 'overridable_block', ...attested, hasOverride: true })).toEqual({ ok: true, verdict: 'overridden' });
  });
});

describe('A.1 Inc4 — content-hash binding (supersede-on-change)', () => {
  it('hashDeedContent is deterministic + CRLF-normalized, and changes with content', () => {
    expect(hashDeedContent('a\r\nb')).toBe(hashDeedContent('a\nb')); // CRLF vs LF normalized
    expect(hashDeedContent('deed v1')).toBe(hashDeedContent('deed v1'));
    expect(hashDeedContent('deed v1')).not.toBe(hashDeedContent('deed v2')); // a material change supersedes the sign-off
  });

  it('hashSourceFacts is order-independent for the party set but content-sensitive', () => {
    const a = hashSourceFacts({ legal: 'L', parcel: 'P', owners: ['X', 'Y'] });
    const b = hashSourceFacts({ legal: 'L', parcel: 'P', owners: ['Y', 'X'] });
    expect(a).toBe(b);
    expect(a).not.toBe(hashSourceFacts({ legal: 'L2', parcel: 'P', owners: ['X', 'Y'] }));
  });
});
