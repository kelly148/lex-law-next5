/**
 * Retention policy (FOLD-PERSIST-1) — PLACEHOLDER VALUES.
 *
 * ⚠️ ALL retention periods here are PENDING ATTORNEY SIGN-OFF (an RPC / records-
 * management decision). They are NOT settled firm policy and MUST NOT be treated
 * as final legal/ethics retention periods. `retentionPeriodDays === null` means
 * "no signed-off value yet"; the retention service treats a null period as
 * POLICY_PENDING and computes NO purge eligibility until a real value is signed off.
 *
 * `audit_events` is permanent (deletable:false) per FOLD-GOV-1a (immutable Matter Record).
 */

export type DataClass =
  | 'matters'
  | 'documents_versions'
  | 'matter_materials'
  | 'audit_events'
  | 'telemetry_events';

export interface RetentionRule {
  /** Days to retain after the matter closes / the row is soft-deleted. null = PENDING ATTORNEY SIGN-OFF. */
  retentionPeriodDays: number | null;
  /** Whether this class may EVER be hard-deleted. */
  deletable: boolean;
  signoffStatus: 'PENDING_ATTORNEY_SIGN_OFF' | 'SIGNED_OFF';
  notes: string;
}

export const RETENTION_POLICY: Record<DataClass, RetentionRule> = {
  matters: {
    retentionPeriodDays: null,
    deletable: true,
    signoffStatus: 'PENDING_ATTORNEY_SIGN_OFF',
    notes: 'Matter record; client-file-return on close. Period TBD by attorney sign-off.',
  },
  documents_versions: {
    retentionPeriodDays: null,
    deletable: true,
    signoffStatus: 'PENDING_ATTORNEY_SIGN_OFF',
    notes: 'Work product + drafts/versions. Period TBD by attorney sign-off.',
  },
  matter_materials: {
    retentionPeriodDays: null,
    deletable: true,
    signoffStatus: 'PENDING_ATTORNEY_SIGN_OFF',
    notes: 'Client/source materials; client-file-return implications. Period TBD.',
  },
  audit_events: {
    retentionPeriodDays: null,
    deletable: false,
    signoffStatus: 'PENDING_ATTORNEY_SIGN_OFF',
    notes: 'PERMANENT immutable Matter Record (FOLD-GOV-1a). Not deletable.',
  },
  telemetry_events: {
    retentionPeriodDays: null,
    deletable: true,
    signoffStatus: 'PENDING_ATTORNEY_SIGN_OFF',
    notes: 'Operational telemetry; shorter retention likely. Period TBD.',
  },
};

/** True only once every class has a signed-off retention value. */
export function isPolicySignedOff(): boolean {
  return Object.values(RETENTION_POLICY).every((r) => r.signoffStatus === 'SIGNED_OFF');
}
