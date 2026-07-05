/**
 * TITLE-EXAM-1 (T4) — fresh-context reconciler: the NC-1 two-tier taxonomy (judgment conflicts are
 * escalate-only, never auto-resolved), concordance re-derived from the real lane outputs, full conflict
 * visibility, the NC-4 sendability matrix, and the attorney ADOPT/MODIFY/HOLD decision logging (Fork-C).
 * All pure / mock-tx — no DB, no provider.
 */

import { describe, it, expect } from 'vitest';
import {
  isJudgmentTopic,
  classifyConflictTier,
  matchedJudgmentTopics,
} from '../titleExam/judgmentTopics.js';
import {
  reconcileLaneFindings,
  TITLE_EXAM_RECONCILER_SYSTEM_PROMPT,
  type ReconcilerItemInput,
} from '../titleExam/reconciler.js';
import {
  buildFindingDecisionAuditEvent,
  writeFindingDecisionTx,
} from '../db/queries/titleExamDecisions.js';
import type { TitleExamLaneFinding } from '../titleExam/laneOutput.js';

const LANE_A: TitleExamLaneFinding[] = [
  { title: 'Census matches', sourceBasis: 'instrument', sendability: 'internal_only', classification: 'informational_note' },
  { title: 'Unreleased 2004 DOT', sourceBasis: 'instrument', sendability: 'internal_only', classification: 'closing_requirement' },
];
const LANE_B: TitleExamLaneFinding[] = [
  { title: 'Census matches', sourceBasis: 'instrument', sendability: 'internal_only', classification: 'informational_note' },
  { title: 'Estate PR deed', sourceBasis: 'court_record', sendability: 'requires_source_review', classification: 'counsel_referral' },
];

describe('T4 — NC-1 judgment-topic taxonomy (escalate-only spine)', () => {
  it('detects the escalate-only judgment topics', () => {
    expect(isJudgmentTopic('current vesting is tenants in common')).toBe(true);
    expect(isJudgmentTopic('spousal joinder / dower not addressed')).toBe(true);
    expect(isJudgmentTopic('personal representative deed required before marketable title')).toBe(true);
    expect(isJudgmentTopic('insurability turns on the missing release')).toBe(true);
    expect(isJudgmentTopic('automatic release theory for the deed of trust')).toBe(true);
    expect(isJudgmentTopic('this adds a new requirement to close')).toBe(true);
    expect(isJudgmentTopic('PR deed required before marketable title')).toBe(true);
    expect(isJudgmentTopic('the decedent estate conveyance')).toBe(true);
    expect(isJudgmentTopic('the recording fee is $30')).toBe(false);
    // "real estate" is noise, not the estate-authority judgment topic — must NOT over-escalate.
    expect(isJudgmentTopic('the real estate market summary')).toBe(false);
  });

  it('classifyConflictTier OVER-escalates: reconciler flag OR topic match ⇒ judgment', () => {
    expect(classifyConflictTier({ title: 'the recording fee is $30' }, true)).toBe('judgment'); // flag
    expect(classifyConflictTier({ title: 'vesting is joint tenancy' }, false)).toBe('judgment'); // topic
    expect(classifyConflictTier({ title: 'caption formatting differs' }, false)).toBe('record_resolvable');
    expect(matchedJudgmentTopics('estate intestate heir vesting')).toContain('vesting/tenancy');
  });
});

describe('T4 — reconciler applies NC-1 deterministically (the code, not the model, disposes)', () => {
  it('a JUDGMENT item is ESCALATED even if the reconciler mislabels it housekeeping', () => {
    const items: ReconcilerItemInput[] = [
      {
        title: 'Vesting: tenants in common vs joint tenancy with survivorship',
        sourceBasis: 'instrument',
        sendability: 'do_not_send_without_attorney_rewrite',
        classification: 'underwriting_escalation',
        laneARef: 1,
        laneBRef: 1,
        isConflict: true,
        isHousekeeping: true, // reconciler WRONGLY proposes auto-resolve — the code must override
      },
    ];
    const r = reconcileLaneFindings({ laneA: LANE_A, laneB: LANE_B, items });
    expect(r.findings[0]!.escalationState).toBe('escalated');
    expect(r.findings[0]!.isJudgmentConflict).toBe(true);
    expect(r.findings[0]!.autoResolvedRationale).toBeNull();
    expect(r.escalationQueue).toHaveLength(1);
  });

  it('a record-resolvable / housekeeping item auto-resolves WITH a visible rationale', () => {
    const items: ReconcilerItemInput[] = [
      {
        title: 'Caveat wording differs between lanes',
        sourceBasis: 'abstractor_stated',
        sendability: 'internal_only',
        classification: 'informational_note',
        laneARef: 0,
        laneBRef: 0,
        isHousekeeping: true,
        recordResolvableCategory: 'format',
      },
    ];
    const r = reconcileLaneFindings({ laneA: LANE_A, laneB: LANE_B, items });
    expect(r.findings[0]!.escalationState).toBe('auto_resolved');
    expect(r.findings[0]!.reconClassification).toBe('housekeeping');
    expect(r.findings[0]!.autoResolvedRationale).toContain('Auto-resolved (record-resolvable/format)');
    expect(r.autoResolved).toHaveLength(1);
    expect(r.escalationQueue).toHaveLength(0);
  });

  it('re-derives concordance from ACTUAL lane presence (a bad ref is not trusted as "both")', () => {
    const items: ReconcilerItemInput[] = [
      // Claims both lanes but laneBRef is out of range → NOT concordant, treated as a single-lane unique catch.
      { title: 'Census matches', sourceBasis: 'instrument', sendability: 'internal_only', classification: 'informational_note', laneARef: 0, laneBRef: 99 },
    ];
    const r = reconcileLaneFindings({ laneA: LANE_A, laneB: LANE_B, items });
    expect(r.findings[0]!.laneOrigin).toBe('examiner_a');
    expect(r.findings[0]!.reconClassification).toBe('unique_catch');
  });

  it('returns full visibility (all findings) + the NC-4 sendability matrix', () => {
    const items: ReconcilerItemInput[] = [
      { title: 'Census matches', sourceBasis: 'instrument', sendability: 'internal_only', classification: 'informational_note', laneARef: 0, laneBRef: 0 },
      { title: 'Estate PR deed required', sourceBasis: 'court_record', sendability: 'requires_source_review', classification: 'counsel_referral', laneBRef: 1 },
      { title: 'Unreleased 2004 DOT', sourceBasis: 'instrument', sendability: 'client_facing_with_caveat', classification: 'closing_requirement', laneARef: 1 },
    ];
    const r = reconcileLaneFindings({ laneA: LANE_A, laneB: LANE_B, items });
    expect(r.findings).toHaveLength(3); // nothing hidden
    const kinds = r.sendabilityMatrix.map((m) => m.sendability).sort();
    expect(kinds).toContain('internal_only');
    expect(kinds).toContain('requires_source_review');
    expect(r.sendabilityMatrix.reduce((s, m) => s + m.count, 0)).toBe(3);
    // the estate PR item is a judgment escalation; the census is concordant auto-resolve
    expect(r.escalationQueue.some((f) => f.title.includes('Estate PR'))).toBe(true);
    expect(r.concordantCount).toBe(1);
  });

  it('the reconciler prompt is fresh-context, requires steelmanning, and states escalate-only', () => {
    expect(TITLE_EXAM_RECONCILER_SYSTEM_PROMPT).toContain('FRESH CONTEXT');
    expect(TITLE_EXAM_RECONCILER_SYSTEM_PROMPT).toContain('NO memory');
    expect(TITLE_EXAM_RECONCILER_SYSTEM_PROMPT).toContain('STEELMAN');
    expect(TITLE_EXAM_RECONCILER_SYSTEM_PROMPT).toContain('ESCALATE-ONLY');
    expect(TITLE_EXAM_RECONCILER_SYSTEM_PROMPT).toContain('shared-source concordance is NOT corroboration');
  });
});

type CapturedInsert = { table: unknown; row: Record<string, unknown> };
type CapturedUpdate = { table: unknown; row: Record<string, unknown> };

function makeMockDecisionTx(): {
  tx: Parameters<typeof writeFindingDecisionTx>[0];
  inserts: CapturedInsert[];
  updates: CapturedUpdate[];
} {
  const inserts: CapturedInsert[] = [];
  const updates: CapturedUpdate[] = [];
  const mock = {
    insert(table: unknown) {
      return {
        values(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve();
        },
      };
    },
    update(table: unknown) {
      return {
        set(row: Record<string, unknown>) {
          return {
            where() {
              updates.push({ table, row });
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  return { tx: mock as unknown as Parameters<typeof writeFindingDecisionTx>[0], inserts, updates };
}

describe('T4 — attorney ADOPT/MODIFY/HOLD logging (Fork-C: audit_events is the decision source of truth)', () => {
  const BASE = { userId: 'u-1', matterId: 'm-1', findingId: 'f-1', sessionId: 's-1' };

  it('builds a disposition/attorney audit row targeting the finding', () => {
    const ev = buildFindingDecisionAuditEvent({ ...BASE, disposition: 'hold', rationale: 'need the instrument' });
    expect(ev.eventType).toBe('disposition');
    expect(ev.actor).toBe('attorney');
    expect(ev.targetType).toBe('title_exam_finding');
    expect(ev.targetId).toBe('f-1');
    expect(ev.action).toBe('hold');
    expect(ev.rationale).toBe('need the instrument');
    expect(ev.scope).toBe('matter');
  });

  it('writes ONE audit row + updates the finding escalationState, linked by decisionEventId', async () => {
    const { tx, inserts, updates } = makeMockDecisionTx();
    const out = await writeFindingDecisionTx(tx, { ...BASE, disposition: 'adopt' });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.row['eventType']).toBe('disposition');
    expect(inserts[0]!.row['action']).toBe('adopt');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.row['escalationState']).toBe('adopted');
    // the finding points at the deciding audit row
    expect(updates[0]!.row['decisionEventId']).toBe(inserts[0]!.row['id']);
    expect(out.decisionEventId).toBe(inserts[0]!.row['id']);
  });

  it('maps each disposition to the terminal escalation state', async () => {
    for (const [disp, state] of [['adopt', 'adopted'], ['modify', 'modified'], ['hold', 'held']] as const) {
      const { tx, updates } = makeMockDecisionTx();
      await writeFindingDecisionTx(tx, { ...BASE, disposition: disp });
      expect(updates[0]!.row['escalationState']).toBe(state);
    }
  });
});
