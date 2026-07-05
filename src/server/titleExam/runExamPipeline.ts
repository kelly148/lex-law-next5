/**
 * runExamPipeline.ts — TITLE-EXAM-1 (TEX1-10), the end-to-end exam pipeline (intake record → two lanes →
 * reconcile → memo → persist), with EVERY provider/DB touch behind an INJECTED dependency so the whole flow is
 * mock-testable with NO live call. The flag-gated router (procedures/titleExam.ts) calls this with the real
 * seams (makeLlmLaneExaminer, makeReconcilerDispatch, persistTitleExamRun); tests call it with mocks.
 *
 * Fail-closed / honest: a both-lanes-failed exam persists status 'error' with the banner; a reconciler failure
 * falls back to surfacing the raw lane findings as unique catches (never a silent drop). The candidate memo is
 * NON-FINAL (NC-3) — no client-facing artifact is produced here.
 */

import { buildExamRecordSet } from './lanePrompts.js';
import { runTwoLaneExam, type LaneExaminer } from './examOrchestrator.js';
import { reconcileLaneFindings, type ReconcilerItemInput, type ReconciledFinding } from './reconciler.js';
import { buildInternalExamMemo } from './internalMemo.js';
import type { TitleExamLaneFinding } from './laneOutput.js';
import { persistTitleExamRun, type PersistTitleExamRunInput, type TitleExamFindingInput } from '../db/queries/titleExam.js';

export interface RunExamPipelineInput {
  userId: string;
  matterId: string;
  jurisdiction?: string | null;
  entityHat?: string | null;
  effectiveDate?: string | null;
  materialsCensus?: readonly string[];
  abstractText: string;
  seedFacts?: ReadonlyArray<{ sourceMatterId: string; text: string }>;
  incompletenessBanner?: string | null;
  completeness?: 'complete' | 'incomplete';
  droppedPageCount?: number;
  matterTitle?: string | null;
  models: { examiner_a: string; examiner_b: string; reconciler: string };
}

export interface RunExamPipelineResult {
  sessionId: string;
  memo: string;
  laneMode: 'two_lane' | 'single_lane';
  laneFailureBanner: string | null;
  escalationCount: number;
  autoResolvedCount: number;
  findingCount: number;
}

export interface RunExamPipelineDeps {
  examiner: LaneExaminer;
  reconcile: (
    laneA: readonly TitleExamLaneFinding[],
    laneB: readonly TitleExamLaneFinding[],
    recordSet: string,
    modelString: string,
  ) => Promise<ReconcilerItemInput[]>;
  /** Defaults to the real persistTitleExamRun; tests pass a mock. */
  persist?: (input: PersistTitleExamRunInput) => Promise<string>;
}

function laneFindingToItem(f: TitleExamLaneFinding, ref: number, lane: 'a' | 'b'): ReconcilerItemInput {
  return {
    title: f.title,
    ...(f.detail != null ? { detail: f.detail } : {}),
    sourceBasis: f.sourceBasis,
    sendability: f.sendability,
    classification: f.classification,
    ...(f.downgraded != null ? { downgraded: f.downgraded } : {}),
    ...(f.ocrSourcePagePincite != null ? { ocrSourcePagePincite: f.ocrSourcePagePincite } : {}),
    ...(lane === 'a' ? { laneARef: ref } : { laneBRef: ref }),
  };
}

function toFindingInput(f: ReconciledFinding): TitleExamFindingInput {
  return {
    laneOrigin: f.laneOrigin,
    title: f.title,
    detail: f.detail,
    sourceBasis: f.sourceBasis,
    downgraded: f.downgraded,
    ocrSourcePagePincite: f.ocrSourcePagePincite,
    sendability: f.sendability,
    classification: f.classification,
    reconClassification: f.reconClassification,
    isJudgmentConflict: f.isJudgmentConflict,
    escalationState: f.escalationState,
    autoResolvedRationale: f.autoResolvedRationale,
    laneAPosition: f.laneAPosition,
    laneBPosition: f.laneBPosition,
    recommendation: f.recommendation,
  };
}

export async function runTitleExamPipeline(
  deps: RunExamPipelineDeps,
  input: RunExamPipelineInput,
): Promise<RunExamPipelineResult> {
  const recordSet = buildExamRecordSet({
    jurisdiction: input.jurisdiction ?? null,
    entityHat: input.entityHat ?? null,
    effectiveDate: input.effectiveDate ?? null,
    abstractText: input.abstractText,
    incompletenessBanner: input.incompletenessBanner ?? null,
    ...(input.materialsCensus !== undefined ? { materialsCensus: input.materialsCensus } : {}),
    ...(input.seedFacts !== undefined ? { seedFacts: input.seedFacts } : {}),
  });

  const exam = await runTwoLaneExam(
    { examiner: deps.examiner },
    { recordSet, models: { examiner_a: input.models.examiner_a, examiner_b: input.models.examiner_b } },
  );
  const laneA = exam.lanes.find((l) => l.role === 'examiner_a')?.findings ?? [];
  const laneB = exam.lanes.find((l) => l.role === 'examiner_b')?.findings ?? [];

  let reconItems: ReconcilerItemInput[] = [];
  if (exam.okLaneCount > 0) {
    try {
      reconItems = await deps.reconcile(laneA, laneB, recordSet, input.models.reconciler);
    } catch {
      // Reconciler failure must NEVER drop findings: surface the raw lane findings as unique catches. The
      // deterministic NC-1 apply still escalate-only-gates any judgment topic among them.
      reconItems = [
        ...laneA.map((f, i) => laneFindingToItem(f, i, 'a')),
        ...laneB.map((f, i) => laneFindingToItem(f, i, 'b')),
      ];
    }
  }

  const recon = reconcileLaneFindings({ laneA, laneB, items: reconItems });
  const memo = buildInternalExamMemo({
    matterTitle: input.matterTitle ?? null,
    jurisdiction: input.jurisdiction ?? null,
    entityHat: input.entityHat ?? null,
    effectiveDate: input.effectiveDate ?? null,
    laneMode: exam.laneMode,
    laneFailureBanner: exam.laneFailureBanner,
    incompletenessBanner: input.incompletenessBanner ?? null,
    findings: recon.findings,
    escalationQueue: recon.escalationQueue,
    sendabilityMatrix: recon.sendabilityMatrix,
  });

  const persist = deps.persist ?? persistTitleExamRun;
  const sessionId = await persist({
    session: {
      userId: input.userId,
      matterId: input.matterId,
      jurisdiction: input.jurisdiction ?? null,
      entityHat: input.entityHat ?? null,
      laneMode: exam.laneMode,
      laneFailureBanner: exam.laneFailureBanner,
      completeness: input.completeness ?? 'complete',
      incompletenessReason: input.incompletenessBanner ?? null,
      droppedPageCount: input.droppedPageCount ?? 0,
      status: exam.okLaneCount === 0 ? 'error' : 'memo_ready',
      examinerAModel: input.models.examiner_a,
      examinerBModel: input.models.examiner_b,
      reconcilerModel: input.models.reconciler,
      candidateMemoText: memo,
      lanes: exam.lanes.map((l) => ({
        role: l.role,
        status: l.status,
        model: l.modelString,
        findingCount: l.findings.length,
      })),
    },
    findings: recon.findings.map(toFindingInput),
  });

  return {
    sessionId,
    memo,
    laneMode: exam.laneMode,
    laneFailureBanner: exam.laneFailureBanner,
    escalationCount: recon.escalationQueue.length,
    autoResolvedCount: recon.autoResolved.length,
    findingCount: recon.findings.length,
  };
}
