/**
 * TITLE-EXAM-1 (T9) — Phase-A acceptance harness (spec §9). The four SEEDED FAILURE CLASSES are PASS/FAIL
 * GATES, not seeds: the module must DEMONSTRABLY catch each. Plus an end-to-end pipeline smoke (mocked lanes
 * → reconcile → memo). All SYNTHETIC / anonymized fixtures — NO real matter content; mocks only, no provider.
 *
 * Gates:
 *   (a) the OCR'd-denied-order testacy trap        — OCR honesty flags + downgrades; testacy escalates.
 *   (b) §10-105-style over-confidence              — a currency/authority conclusion escalates (judgment).
 *   (c) unverified-citation carriage               — the NC-3e render-block bars it from client output.
 *   (d) cross-matter contamination                 — the seed auto-flags + blocks reconciliation close.
 */

import { describe, it, expect } from 'vitest';
import { applyOcrHonesty, toFindingOcrBasis } from '../titleExam/ocrHonesty.js';
import { classifyConflictTier, isJudgmentTopic } from '../titleExam/judgmentTopics.js';
import { checkClientFacingRenderBlocks } from '../titleExam/renderBlocks.js';
import { evaluateContamination, assessReconciliationClosure } from '../titleExam/contaminationGuard.js';
import { reconcileLaneFindings, type ReconcilerItemInput } from '../titleExam/reconciler.js';
import { buildInternalExamMemo } from '../titleExam/internalMemo.js';
import { runTwoLaneExam, type LaneExaminer } from '../titleExam/examOrchestrator.js';
import type { TitleExamLaneFinding } from '../titleExam/laneOutput.js';

describe('T9 acceptance gate (a) — the OCR\'d-denied-order testacy trap', () => {
  it('an OCR-asserted testacy status is flagged OCR-derived + downgraded, and testacy escalates as judgment', () => {
    // A scanned probate order OCR-read as establishing testacy — the trap is trusting the extraction.
    const honest = applyOcrHonesty({
      field: 'testacy_status',
      value: 'testate (per order)',
      confidence: 71,
      sourcePage: 3,
      ocrDerived: true,
    });
    const basis = toFindingOcrBasis(honest);
    // GATE: never presented as instrument-confirmed — OCR-derived, downgraded, with a pincite.
    expect(basis.ocrDerived).toBe(true);
    expect(basis.downgraded).toBe(true);
    expect(basis.ocrSourcePagePincite).toBe('OCR p.3');
    // GATE: testacy is a judgment topic → escalate-only (never auto-resolved).
    expect(classifyConflictTier({ title: 'testacy status from the probate order' })).toBe('judgment');
  });
});

describe('T9 acceptance gate (b) — §10-105-style over-confidence', () => {
  it('an over-confident estate/authority conclusion is caught as a judgment escalation, not auto-adopted', () => {
    // A lane over-confidently concludes marketable title passed without the recorded PR deed.
    const overConfident: ReconcilerItemInput = {
      title: 'Marketable title passed to the heirs on the decedent\'s death (PR deed unnecessary)',
      detail: 'lane asserts no recorded personal representative deed is required',
      sourceBasis: 'model_inference',
      sendability: 'do_not_send_without_attorney_rewrite',
      classification: 'underwriting_escalation',
      laneBRef: 0,
      isHousekeeping: true, // even if a lane proposes auto-resolve, the code must escalate
    };
    const laneB: TitleExamLaneFinding[] = [
      { title: 'estate conveyance', sourceBasis: 'model_inference', sendability: 'internal_only', classification: 'underwriting_escalation' },
    ];
    const r = reconcileLaneFindings({ laneA: [], laneB, items: [overConfident] });
    // GATE: escalated, never auto-resolved.
    expect(r.findings[0]!.escalationState).toBe('escalated');
    expect(r.escalationQueue).toHaveLength(1);
    expect(isJudgmentTopic(overConfident.title)).toBe(true);
  });
});

describe('T9 acceptance gate (c) — unverified-citation carriage', () => {
  it('an unverified citation is structurally blocked from client-facing output; a verified one passes', () => {
    const blocked = checkClientFacingRenderBlocks('The transfer tax applies under § 42-1103 of the DC Code.');
    expect(blocked.ok).toBe(false);
    expect(blocked.failures.join(' ')).toContain('unverified citation');

    const verified = checkClientFacingRenderBlocks('The transfer tax applies under § 42-1103 [externally verified] of the DC Code.');
    expect(verified.ok).toBe(true);
  });
});

describe('T9 acceptance gate (d) — cross-matter contamination', () => {
  it('a seed fact from another matter auto-flags and blocks reconciliation close until re-verified', () => {
    const v = evaluateContamination({
      currentMatterId: 'matter-THIS',
      title: 'the 2004 deed of trust was released',
      sourceBasis: 'prior_matter_seed',
      classification: 'closing_requirement',
      seedSourceMatterId: 'matter-OTHER',
    });
    // GATE: auto-flagged (mismatch + supports a requirement).
    expect(v.seedContaminationFlag).toBe(true);
    const closure = assessReconciliationClosure([
      { id: 'seed-1', title: v.reason ?? 'seed', seedContaminationFlag: true },
    ]);
    // GATE: reconciliation cannot close while the seed is unresolved.
    expect(closure.canClose).toBe(false);
  });
});

describe('T9 — end-to-end pipeline smoke (mocked lanes → reconcile → memo)', () => {
  it('runs both lanes over an identical record, escalates the judgment finding, and renders a non-final memo', async () => {
    const laneOut = JSON.stringify([
      { title: 'Vesting requires attorney determination', sourceBasis: 'abstractor_stated', sendability: 'do_not_send_without_attorney_rewrite', classification: 'underwriting_escalation', downgraded: true },
    ]);
    const examiner: LaneExaminer = async () => laneOut;
    const exam = await runTwoLaneExam({ examiner }, { recordSet: 'SYNTHETIC RECORD', models: { examiner_a: 'a', examiner_b: 'b' } });
    expect(exam.laneMode).toBe('two_lane');
    expect(exam.okLaneCount).toBe(2);

    const items: ReconcilerItemInput[] = [
      {
        title: 'Vesting requires attorney determination',
        detail: 'tenants in common vs joint tenancy',
        sourceBasis: 'abstractor_stated',
        sendability: 'do_not_send_without_attorney_rewrite',
        classification: 'underwriting_escalation',
        laneARef: 0,
        laneBRef: 0,
        isConflict: true,
        downgraded: true,
      },
    ];
    const recon = reconcileLaneFindings({ laneA: exam.lanes[0]!.findings, laneB: exam.lanes[1]!.findings, items });
    expect(recon.escalationQueue).toHaveLength(1);

    const memo = buildInternalExamMemo({
      matterTitle: 'Synthetic Matter',
      jurisdiction: 'DC',
      laneMode: exam.laneMode,
      laneFailureBanner: exam.laneFailureBanner,
      findings: recon.findings,
      escalationQueue: recon.escalationQueue,
      sendabilityMatrix: recon.sendabilityMatrix,
    });
    expect(memo).toContain('AI-ASSISTED DRAFT');
    expect(memo).toContain('NON-FINAL');
    expect(memo).toContain('Vesting requires attorney determination');
    expect(memo).toContain('5. Route to:');
  });
});
