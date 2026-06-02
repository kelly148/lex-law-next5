/**
 * FOLD-PERSIST-1 — retention policy placeholders + default-safe mechanism.
 *
 * Asserts: all retention values are PLACEHOLDER (PENDING ATTORNEY SIGN-OFF, no
 * settled periods); audit_events is permanent; purge-eligibility is POLICY_PENDING
 * (computes nothing); the hard-delete guard refuses without an operator token,
 * refuses permanent classes, and stays blocked while policy is unsigned; and the
 * service ships no destructive SQL.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RETENTION_POLICY, isPolicySignedOff } from '../config/retentionPolicy.js';
import {
  describePurgeEligibility,
  assertHardDeleteApproved,
  HARD_DELETE_OPERATOR_TOKEN,
} from '../retention/retentionService.js';

describe('FOLD-PERSIST-1 — retention policy is placeholder (PENDING ATTORNEY SIGN-OFF)', () => {
  it('every retention period is null (no settled legal/ethics values)', () => {
    for (const r of Object.values(RETENTION_POLICY)) expect(r.retentionPeriodDays).toBeNull();
  });
  it('every class is PENDING_ATTORNEY_SIGN_OFF; policy is not signed off', () => {
    for (const r of Object.values(RETENTION_POLICY)) expect(r.signoffStatus).toBe('PENDING_ATTORNEY_SIGN_OFF');
    expect(isPolicySignedOff()).toBe(false);
  });
  it('audit_events is permanent (not deletable) per GOV-1a', () => {
    expect(RETENTION_POLICY.audit_events.deletable).toBe(false);
  });
});

describe('FOLD-PERSIST-1 — mechanism is default-safe', () => {
  it('purge eligibility is POLICY_PENDING (computes no purge while values await sign-off)', () => {
    expect(describePurgeEligibility().status).toBe('POLICY_PENDING');
  });
  it('hard-delete guard throws without the operator confirmation token', () => {
    expect(() => assertHardDeleteApproved(undefined, 'matters')).toThrow(/OPERATOR_APPROVAL/);
    expect(() => assertHardDeleteApproved('nope', 'matters')).toThrow(/OPERATOR_APPROVAL/);
  });
  it('hard-delete guard refuses permanent classes even with the token', () => {
    expect(() => assertHardDeleteApproved(HARD_DELETE_OPERATOR_TOKEN, 'audit_events')).toThrow(/FORBIDDEN/);
  });
  it('hard-delete guard stays blocked while policy is unsigned (deletable class + token)', () => {
    expect(() => assertHardDeleteApproved(HARD_DELETE_OPERATOR_TOKEN, 'matters')).toThrow(/PENDING ATTORNEY SIGN-OFF/);
  });
  it('retention service ships no destructive SQL', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../retention/retentionService.ts', import.meta.url)),
      'utf8',
    );
    expect(src).not.toMatch(/db\.delete\(/);
  });
});
