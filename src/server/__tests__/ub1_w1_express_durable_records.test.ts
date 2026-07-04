/**
 * ULTRABUILD-1 W1 — EXPRESS durable records (E4b decision ledger + E7b attorney-approval attestation).
 *
 * DB-less coverage (CI runs no database): the pure helpers (completeness, content hash, audit-event builders)
 * and the transaction bodies exercised against a MOCK tx that captures inserts. Asserts the Fork-C write
 * contract — every attorney decision + the approval act become audit_events disposition rows — and the
 * structural inertness (an incomplete decision set records NOTHING).
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateAttestationCompleteness,
  buildAttestationContentHash,
  buildEscalationDecisionAuditEvent,
  buildApprovalAuditEvent,
  writeExpressAttestationTx,
  writeExpressLoopRunTx,
  type ExpressLedgerEntryInput,
} from '../db/queries/expressDurableRecords.js';
import {
  auditEvents,
  expressLoopRun,
  expressLedgerEntry,
  expressApprovalAttestation,
} from '../db/schema.js';

type CapturedInsert = { table: unknown; row: Record<string, unknown> };

/** A minimal executor that captures every insert(table).values(row); satisfies the tx param via a cast. */
function makeMockTx(): { tx: Parameters<typeof writeExpressAttestationTx>[0]; inserts: CapturedInsert[] } {
  const inserts: CapturedInsert[] = [];
  const mock = {
    insert(table: unknown) {
      return {
        values(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve();
        },
      };
    },
  };
  return { tx: mock as unknown as Parameters<typeof writeExpressAttestationTx>[0], inserts };
}

const RUN = {
  id: 'run-1111',
  matterId: '11111111-1111-1111-1111-111111111111',
  documentId: '22222222-2222-2222-2222-222222222222',
  documentVersionId: '33333333-3333-3333-3333-333333333333',
  candidateText: 'the non-final candidate text',
};
const USER = '44444444-4444-4444-4444-444444444444';

describe('W1 — evaluateAttestationCompleteness (mirrors approvalGate structural inertness)', () => {
  it('approves only when EVERY escalation carries an explicit adopt/reject', () => {
    expect(evaluateAttestationCompleteness(['e1-1', 'e1-2'], { 'e1-1': 'adopt', 'e1-2': 'reject' })).toEqual({
      approved: true,
      undispositionedEscalationIds: [],
    });
  });

  it('a MISSING decision is un-dispositioned — never an implicit approval', () => {
    const r = evaluateAttestationCompleteness(['e1-1', 'e1-2'], { 'e1-1': 'adopt' });
    expect(r.approved).toBe(false);
    expect(r.undispositionedEscalationIds).toEqual(['e1-2']);
  });

  it('a malformed value counts as un-dispositioned', () => {
    const r = evaluateAttestationCompleteness(['e1-1'], { 'e1-1': 'maybe' } as unknown as Record<string, 'adopt' | 'reject'>);
    expect(r.approved).toBe(false);
    expect(r.undispositionedEscalationIds).toEqual(['e1-1']);
  });

  it('an empty escalation set approves (nothing to disposition)', () => {
    expect(evaluateAttestationCompleteness([], {}).approved).toBe(true);
  });
});

describe('W1 — buildAttestationContentHash', () => {
  it('is deterministic and order-independent over decision keys', () => {
    const a = buildAttestationContentHash({ runId: RUN.id, candidateText: RUN.candidateText, decisions: { 'e1-1': 'adopt', 'e1-2': 'reject' } });
    const b = buildAttestationContentHash({ runId: RUN.id, candidateText: RUN.candidateText, decisions: { 'e1-2': 'reject', 'e1-1': 'adopt' } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the candidate text, run id, or a decision changes (supersede-on-change)', () => {
    const base = buildAttestationContentHash({ runId: RUN.id, candidateText: RUN.candidateText, decisions: { 'e1-1': 'adopt' } });
    expect(buildAttestationContentHash({ runId: RUN.id, candidateText: 'changed', decisions: { 'e1-1': 'adopt' } })).not.toBe(base);
    expect(buildAttestationContentHash({ runId: 'run-9999', candidateText: RUN.candidateText, decisions: { 'e1-1': 'adopt' } })).not.toBe(base);
    expect(buildAttestationContentHash({ runId: RUN.id, candidateText: RUN.candidateText, decisions: { 'e1-1': 'reject' } })).not.toBe(base);
  });
});

describe('W1 — audit-event builders (Fork-C disposition rows)', () => {
  it('a per-escalation decision is a disposition/attorney row targeting the escalation', () => {
    const ev = buildEscalationDecisionAuditEvent({
      userId: USER, matterId: RUN.matterId, documentId: RUN.documentId, documentVersionId: RUN.documentVersionId,
      escalationLedgerId: 'e1-2', decision: 'reject',
    });
    expect(ev.eventType).toBe('disposition');
    expect(ev.actor).toBe('attorney');
    expect(ev.targetType).toBe('express_escalation');
    expect(ev.targetId).toBe('e1-2');
    expect(ev.action).toBe('reject');
    expect(ev.scope).toBe('document');
    expect(ev.versionId).toBe(RUN.documentVersionId);
  });

  it('the approval act is a disposition/attorney row targeting the loop run', () => {
    const ev = buildApprovalAuditEvent({
      userId: USER, matterId: RUN.matterId, documentId: RUN.documentId, documentVersionId: RUN.documentVersionId,
      runId: RUN.id, escalationCount: 2,
    });
    expect(ev.eventType).toBe('disposition');
    expect(ev.targetType).toBe('express_loop_run');
    expect(ev.targetId).toBe(RUN.id);
    expect(ev.action).toBe('approve');
  });
});

describe('W1 — writeExpressAttestationTx (Fork-C transactional composition)', () => {
  it('writes one audit_events row per escalation + one approval act + one attestation row, all linked', async () => {
    const { tx, inserts } = makeMockTx();
    const decisions = { 'e1-1': 'adopt', 'e1-2': 'reject' } as const;
    const out = await writeExpressAttestationTx(tx, {
      run: RUN,
      escalationLedgerIds: ['e1-1', 'e1-2'],
      decisions,
      attorneyUserId: USER,
      userId: USER,
      contentHash: 'deadbeef',
      attestationId: 'att-1',
    });

    const auditRows = inserts.filter((i) => i.table === auditEvents).map((i) => i.row);
    const attRows = inserts.filter((i) => i.table === expressApprovalAttestation).map((i) => i.row);

    // 2 per-escalation disposition rows + 1 approval act.
    expect(auditRows).toHaveLength(3);
    const escRows = auditRows.filter((r) => r['targetType'] === 'express_escalation');
    expect(escRows.map((r) => r['targetId']).sort()).toEqual(['e1-1', 'e1-2']);
    expect(escRows.find((r) => r['targetId'] === 'e1-1')!['action']).toBe('adopt');
    expect(escRows.find((r) => r['targetId'] === 'e1-2')!['action']).toBe('reject');
    const approvalRow = auditRows.find((r) => r['targetType'] === 'express_loop_run')!;
    expect(approvalRow['action']).toBe('approve');

    // one attestation row, pointer-linked to the approval audit row, hash + count carried.
    expect(attRows).toHaveLength(1);
    const att = attRows[0]!;
    expect(att['approved']).toBe(true);
    expect(att['approvalEventId']).toBe(out.approvalEventId);
    expect(att['approvalEventId']).toBe(approvalRow['id']);
    expect(att['contentHash']).toBe('deadbeef');
    expect(att['escalationCount']).toBe(2);
    expect(att['id']).toBe('att-1');
  });

  it('records NOTHING beyond the audit rows for a run with zero escalations (approval act only)', async () => {
    const { tx, inserts } = makeMockTx();
    await writeExpressAttestationTx(tx, {
      run: RUN, escalationLedgerIds: [], decisions: {}, attorneyUserId: USER, userId: USER,
      contentHash: 'h', attestationId: 'att-0',
    });
    const auditRows = inserts.filter((i) => i.table === auditEvents);
    expect(auditRows).toHaveLength(1); // just the approval act
    expect(auditRows[0]!.row['targetType']).toBe('express_loop_run');
  });
});

describe('W1 — writeExpressLoopRunTx (E4b run + ledger persistence)', () => {
  const entry: ExpressLedgerEntryInput = {
    ledgerEntryId: 'e1-1', round: 1, route: 'escalate', riskScore: 1100, riskBucket: 'high',
    immutabilityForced: false, isDeletion: false, beforeText: 'a', afterText: 'b', offsetStart: 0, offsetEnd: 1,
    locus: { decision: 'escalate', reason: 'x', intersectedSpans: [] }, classA: null, inlineEvent: null,
  };

  it('writes the run row then one row per ledger entry, denormalizing owner+matter+document', async () => {
    const { tx, inserts } = makeMockTx();
    await writeExpressLoopRunTx(tx, {
      userId: USER, matterId: RUN.matterId, documentId: RUN.documentId, documentVersionId: RUN.documentVersionId,
      reviewerModel: 'anthropic:claude-opus-4-5', rounds: 2, converged: true, hitCap: false,
      adoptedCount: 3, escalationCount: 1, candidateText: RUN.candidateText,
      redline: { segments: [], unchanged: true }, roundSummaries: [], entries: [entry], runId: 'run-1111',
    });

    const runRows = inserts.filter((i) => i.table === expressLoopRun).map((i) => i.row);
    const entryRows = inserts.filter((i) => i.table === expressLedgerEntry).map((i) => i.row);
    expect(runRows).toHaveLength(1);
    expect(runRows[0]!['id']).toBe('run-1111');
    expect(runRows[0]!['escalationCount']).toBe(1);
    expect(entryRows).toHaveLength(1);
    expect(entryRows[0]!['runId']).toBe('run-1111');
    expect(entryRows[0]!['ledgerEntryId']).toBe('e1-1');
    expect(entryRows[0]!['route']).toBe('escalate');
    expect(entryRows[0]!['matterId']).toBe(RUN.matterId);
    expect(entryRows[0]!['classA']).toBeNull();
  });
});
