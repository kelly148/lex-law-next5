/**
 * TITLE-EXAM-1 (T6) — outputs + gates (spec §7, NC-3): the internal memo (AI-assisted, five-field
 * escalations), the NC-3e render-blocks (forbidden assurances / unverified citations / annotation leaks),
 * the client-delivery generation gate (version-locked, no send path, attorney-of-record framing, no AI
 * disclosure), and the durable Approve-for-Client-Delivery attestation (Fork-C). Pure / mock-tx.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildInternalExamMemo, type InternalMemoInput } from '../titleExam/internalMemo.js';
import {
  checkForbiddenAssurances,
  checkAnnotationMarkers,
  checkUnverifiedCitations,
  checkClientFacingRenderBlocks,
} from '../titleExam/renderBlocks.js';
import {
  buildMemoVersionHash,
  buildClientEmailDraft,
  buildBrandedReportDraft,
  type ClientDeliveryApproval,
} from '../titleExam/clientDelivery.js';
import {
  buildClientDeliveryApprovalAuditEvent,
  writeClientDeliveryApprovalTx,
} from '../db/queries/titleExamApproval.js';
import type { ReconciledFinding } from '../titleExam/reconciler.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

function finding(over: Partial<ReconciledFinding>): ReconciledFinding {
  return {
    title: 'f',
    detail: null,
    sourceBasis: 'instrument',
    sendability: 'internal_only',
    classification: 'informational_note',
    downgraded: false,
    ocrSourcePagePincite: null,
    laneOrigin: 'both',
    reconClassification: 'concordant',
    isJudgmentConflict: false,
    tier: 'record_resolvable',
    escalationState: 'auto_resolved',
    autoResolvedRationale: 'record-resolvable',
    laneAPosition: null,
    laneBPosition: null,
    recommendation: null,
    judgmentTopics: [],
    ...over,
  };
}

describe('T6 — internal exam memo (AI-assisted, non-final, five-field escalations)', () => {
  const escalation = finding({
    title: 'Vesting requires attorney determination',
    detail: 'tenants in common vs joint tenancy',
    classification: 'underwriting_escalation',
    sendability: 'do_not_send_without_attorney_rewrite',
    isJudgmentConflict: true,
    tier: 'judgment',
    escalationState: 'escalated',
    autoResolvedRationale: null,
    recommendation: 'conservative: treat as tenants in common pending the deed',
    judgmentTopics: ['vesting/tenancy'],
  });
  const req = finding({ title: 'Release the 2004 DOT', classification: 'closing_requirement', downgraded: true });

  const input: InternalMemoInput = {
    matterTitle: 'Synthetic Matter',
    jurisdiction: 'DC',
    entityHat: 'universal_title',
    laneMode: 'single_lane',
    laneFailureBanner: 'SINGLE-LANE EXAMINATION — the research-capable (B) lane failed.',
    incompletenessBanner: 'INCOMPLETE EXAMINATION — 15 page(s) were not examined.',
    findings: [escalation, req, finding({ title: 'auto note', classification: 'informational_note' })],
    escalationQueue: [escalation],
    sendabilityMatrix: [{ sendability: 'internal_only', count: 2, findingTitles: [] }],
  };

  it('leads with the AI-assisted / non-final label and both NC-10 banners', () => {
    const memo = buildInternalExamMemo(input);
    expect(memo).toContain('AI-ASSISTED DRAFT, FOR ATTORNEY REVIEW');
    expect(memo).toContain('NON-FINAL');
    expect(memo).toContain('SINGLE-LANE EXAMINATION');
    expect(memo).toContain('INCOMPLETE EXAMINATION');
  });

  it('renders escalations in the five-field format with a route', () => {
    const memo = buildInternalExamMemo(input);
    expect(memo).toContain('1. Conflict or gap:');
    expect(memo).toContain('2. Why it matters:');
    expect(memo).toContain('3. Current working position:');
    expect(memo).toContain('4. Needed before action:');
    expect(memo).toContain('5. Route to:');
    expect(memo).toContain('Underwriter'); // underwriting_escalation routes to underwriter
  });

  it('surfaces the downgraded requirement, the auto-resolved visibility, and the scope note', () => {
    const memo = buildInternalExamMemo(input);
    expect(memo).toContain('Release the 2004 DOT');
    expect(memo).toContain('DOWNGRADED');
    expect(memo).toContain('AUTO-RESOLVED');
    expect(memo).toContain('SCOPE NOTE');
    expect(memo).toContain('exam-only');
  });
});

describe('T6 — NC-3e render-blocks (a block, not a label)', () => {
  it('blocks forbidden assurances', () => {
    expect(checkForbiddenAssurances('the title is clear and marketable').ok).toBe(false);
    expect(checkForbiddenAssurances('there is clear title here').ok).toBe(false);
    expect(checkForbiddenAssurances('title is free and clear').ok).toBe(false);
    expect(checkForbiddenAssurances('nothing in the land records affects the parcel').ok).toBe(false);
    expect(checkForbiddenAssurances('the record shows an unreleased deed of trust').ok).toBe(true);
  });

  it('blocks drafts-only annotation markers', () => {
    expect(checkAnnotationMarkers('see [[ MISSING payoff ]]').ok).toBe(false);
    expect(checkAnnotationMarkers('NOTE: verify with the clerk').ok).toBe(false);
    expect(checkAnnotationMarkers('a clean client sentence').ok).toBe(true);
  });

  it('blocks an unverified citation but allows a verified one', () => {
    expect(checkUnverifiedCitations('per § 55.1-1000 the tax applies').ok).toBe(false);
    expect(checkUnverifiedCitations('per § 55.1-1000 [externally verified] the tax applies').ok).toBe(true);
  });

  it('aggregate gate fails closed on any violation', () => {
    expect(checkClientFacingRenderBlocks('this parcel has clear title').ok).toBe(false);
    expect(checkClientFacingRenderBlocks('The record shows one requirement to close: record the release.').ok).toBe(true);
  });
});

describe('T6 — client-delivery generation gate (version-locked, no send path, no AI disclosure)', () => {
  const approval: ClientDeliveryApproval = {
    attorneyUserId: 'att-1',
    hat: 'universal_title',
    recipientClass: 'client',
    posture: 'exam_only',
    advicePermitted: false,
    caveats: ['Subject to a bringdown search before closing.'],
    exclusions: [],
  };

  it('version-lock hash is deterministic and changes when the memo changes', () => {
    const h1 = buildMemoVersionHash('approved memo v1');
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(buildMemoVersionHash('approved memo v1')).toBe(h1);
    expect(buildMemoVersionHash('approved memo v2')).not.toBe(h1);
  });

  it('generates a client email DRAFT with attorney-of-record framing and NO AI disclosure', () => {
    const r = buildClientEmailDraft('The record shows one requirement to close: record the release of the 2004 deed of trust.', approval);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('attorney of record');
    expect(r.content).toContain('not legal advice to any party'); // title-hat, advice not permitted
    expect(r.content).toContain('Subject to a bringdown');
    // No affirmative AI disclosure (operator resolution)
    expect(r.content!.toLowerCase()).not.toContain('ai-assisted');
    expect(r.content!.toLowerCase()).not.toContain('artificial intelligence');
    expect(r.content!.toLowerCase()).not.toContain('generated by');
  });

  it('render-BLOCKS a client artifact carrying a forbidden assurance (fail-closed, no content produced)', () => {
    const r = buildBrandedReportDraft('We confirm the property has clear title.', approval);
    expect(r.ok).toBe(false);
    expect(r.content).toBeNull();
    expect(r.renderBlock.failures.join(' ')).toContain('forbidden assurance');
  });
});

type Captured = { table: unknown; row: Record<string, unknown> };
function makeMockTx(): { tx: Parameters<typeof writeClientDeliveryApprovalTx>[0]; inserts: Captured[] } {
  const inserts: Captured[] = [];
  const mock = { insert(table: unknown) { return { values(row: Record<string, unknown>) { inserts.push({ table, row }); return Promise.resolve(); } }; } };
  return { tx: mock as unknown as Parameters<typeof writeClientDeliveryApprovalTx>[0], inserts };
}

describe('T6 — Approve-for-Client-Delivery attestation (Fork-C)', () => {
  const approval: ClientDeliveryApproval = {
    attorneyUserId: 'att-1', hat: 'satterwhite_law_firm', recipientClass: 'client', posture: 'exam_only',
    advicePermitted: true, caveats: [], exclusions: ['internal underwriting reasoning'],
  };
  const BASE = { userId: 'u-1', matterId: 'm-1', sessionId: 's-1', approvedMemoText: 'the approved memo', approval };

  it('builds a disposition/attorney approval audit row capturing hat/recipient/posture', () => {
    const ev = buildClientDeliveryApprovalAuditEvent({ ...BASE, memoVersionHash: 'abc' });
    expect(ev.eventType).toBe('disposition');
    expect(ev.actor).toBe('attorney');
    expect(ev.action).toBe('approve_for_client_delivery');
    expect(ev.targetType).toBe('title_exam_client_delivery');
    expect((ev.payload as Record<string, unknown>)['hat']).toBe('satterwhite_law_firm');
  });

  it('writes ONE audit row + ONE attestation row, linked by approvalEventId + version hash', async () => {
    const { tx, inserts } = makeMockTx();
    const out = await writeClientDeliveryApprovalTx(tx, { ...BASE, attestationId: 'att-row-1', memoVersionHash: 'hash-xyz' });
    expect(inserts).toHaveLength(2); // audit event + attestation
    const attestation = inserts[1]!.row;
    expect(attestation['memoVersionHash']).toBe('hash-xyz');
    expect(attestation['approvalEventId']).toBe(inserts[0]!.row['id']);
    expect(attestation['approvalEventId']).toBe(out.approvalEventId);
    expect(attestation['exclusions']).toEqual(['internal underwriting reasoning']);
  });
});

describe('T6 — migration 0055 additive-only + allowlisted (MIGRATION-ALLOWLIST-1); purge coverage', () => {
  it('migration creates the table idempotently, no destructive DDL, and is registered on the allowlist', () => {
    const MIG = read('src/server/db/migrations/0055_title_exam_6_client_delivery_approval.sql');
    expect(MIG).toContain('CREATE TABLE IF NOT EXISTS `title_exam_client_delivery_approval`');
    const stripped = MIG.replace(/--[^\n]*/g, '');
    expect(/\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(stripped)).toBe(false);
    expect(read('scripts/apply-prod-migrations.mjs')).toContain('0055_title_exam_6_client_delivery_approval.sql');
  });

  it('the new matter-scoped table is registered in the purge cascade', () => {
    expect(read('src/server/db/queries/matterPurge.ts')).toContain('titleExamClientDeliveryApproval');
  });
});
