/**
 * TITLE-EXAM-1 (TEX1-10) — live wiring: the §4b lane binding + reconciler dispatch through the fail-closed
 * broker (mock send — NO live call), the end-to-end exam pipeline (mock examiner/reconcile/persist), the title
 * Express ports, and the flag-gated tRPC surface (gating source-audit). Mocks/fixtures only.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { makeLlmLaneExaminer } from '../titleExam/laneExaminer.js';
import { makeReconcilerDispatch, parseReconcilerOutput, buildReconcilerUserPrompt, TitleExamReconcilerOutputError } from '../titleExam/reconcilerDispatch.js';
import { makeTitleExpressPorts } from '../titleExam/titleExpressPorts.js';
import { runTitleExamPipeline, type RunExamPipelineDeps } from '../titleExam/runExamPipeline.js';
import type { EgressSubject } from '../../shared/schemas/egress.js';
import type { TitleExamLaneFinding } from '../titleExam/laneOutput.js';
import type { PersistTitleExamRunInput } from '../db/queries/titleExam.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const SUBJECT: EgressSubject = { type: 'matter', subjectId: 'm-1', matterId: '11111111-1111-1111-1111-111111111111', userId: '44444444-4444-4444-4444-444444444444' };

// A mock broker matching documentEgressSend's shape; captures the call + returns a canned content.
function mockSend(content: unknown) {
  const calls: Array<Record<string, unknown>> = [];
  const send = (async (p: Record<string, unknown>) => {
    calls.push(p);
    return { content } as never;
  }) as never;
  return { send, calls };
}

describe('TEX1-10 — makeLlmLaneExaminer binds a lane through the fail-closed broker (§4b, mockable)', () => {
  it('dispatches with surface reviewer + allowlist enforced + the given model, and returns the raw string', async () => {
    const { send, calls } = mockSend('[]');
    const examiner = makeLlmLaneExaminer({ subject: SUBJECT, send });
    const raw = await examiner({ role: 'examiner_a', systemPrompt: 'SYS', recordSet: 'REC', modelString: 'm-a' });
    expect(raw).toBe('[]');
    expect(calls[0]!['surface']).toBe('reviewer');
    expect(calls[0]!['enforceProviderAllowlist']).toBe(true);
    expect(calls[0]!['modelString']).toBe('m-a');
  });

  it('a broker error (fail-closed hold) PROPAGATES — the orchestrator turns it into a single-lane banner', async () => {
    const send = (async () => { throw new Error('DocumentEgressBlockedError: no_external hold'); }) as never;
    const examiner = makeLlmLaneExaminer({ subject: SUBJECT, send });
    await expect(examiner({ role: 'examiner_b', systemPrompt: 'S', recordSet: 'R', modelString: 'm-b' })).rejects.toThrow(/no_external/);
  });
});

describe('TEX1-10 — reconciler dispatch + parser', () => {
  const LANE_A: TitleExamLaneFinding[] = [{ title: 'A finding', sourceBasis: 'instrument', sendability: 'internal_only', classification: 'closing_requirement' }];
  const LANE_B: TitleExamLaneFinding[] = [];

  it('the user prompt carries both lanes\' findings as indexed data', () => {
    const p = buildReconcilerUserPrompt(LANE_A, LANE_B, 'THE RECORD');
    expect(p).toContain('THE RECORD');
    expect(p).toContain('[0]');
    expect(p).toContain('A finding');
    expect(p).toContain('LANE B (research-capable) FINDINGS]');
  });

  it('parses a valid reconciler item array; empty [] valid; malformed throws', () => {
    const items = parseReconcilerOutput('[{"title":"x","sourceBasis":"instrument","sendability":"internal_only","classification":"closing_requirement","laneARef":0}]');
    expect(items).toHaveLength(1);
    expect(parseReconcilerOutput('[]')).toEqual([]);
    expect(() => parseReconcilerOutput('not json')).toThrow(TitleExamReconcilerOutputError);
  });

  it('dispatches through the broker (surface evaluator) and returns parsed items', async () => {
    const { send, calls } = mockSend('[{"title":"y","sourceBasis":"instrument","sendability":"internal_only","classification":"closing_requirement","laneARef":0}]');
    const reconcile = makeReconcilerDispatch({ subject: SUBJECT, send });
    const items = await reconcile(LANE_A, LANE_B, 'REC', 'm-recon');
    expect(items).toHaveLength(1);
    expect(calls[0]!['surface']).toBe('evaluator');
  });
});

describe('TEX1-10 — end-to-end exam pipeline (mock examiner/reconcile/persist; NO live call)', () => {
  const OK_LANE = JSON.stringify([{ title: 'Unreleased 2004 DOT', sourceBasis: 'instrument', sendability: 'internal_only', classification: 'closing_requirement' }]);

  function deps(over: Partial<RunExamPipelineDeps> = {}): RunExamPipelineDeps & { persisted: PersistTitleExamRunInput[] } {
    const persisted: PersistTitleExamRunInput[] = [];
    return {
      examiner: over.examiner ?? (async () => OK_LANE),
      reconcile: over.reconcile ?? (async (a) => a.map((f, i) => ({ title: f.title, sourceBasis: f.sourceBasis, sendability: f.sendability, classification: f.classification, laneARef: i }))),
      persist: async (input) => { persisted.push(input); return 'sess-persisted'; },
      persisted,
    };
  }

  const INPUT = {
    userId: SUBJECT.userId, matterId: SUBJECT.matterId, jurisdiction: 'DC', entityHat: 'universal_title',
    matterTitle: 'Synthetic', abstractText: 'ABSTRACT', materialsCensus: ['abstract.pdf'],
    models: { examiner_a: 'm-a', examiner_b: 'm-b', reconciler: 'm-r' },
  };

  it('runs both lanes, reconciles, synthesizes a NON-FINAL memo, and persists memo_ready', async () => {
    const d = deps();
    const res = await runTitleExamPipeline(d, INPUT);
    expect(res.sessionId).toBe('sess-persisted');
    expect(res.memo).toContain('AI-ASSISTED DRAFT');
    expect(res.laneMode).toBe('two_lane');
    expect(d.persisted[0]!.session.status).toBe('memo_ready');
    expect(d.persisted[0]!.session.examinerAModel).toBe('m-a');
    expect(d.persisted[0]!.session.candidateMemoText).toContain('NON-FINAL');
    expect(d.persisted[0]!.findings.length).toBeGreaterThan(0);
  });

  it('a reconciler failure falls back to the raw lane findings (never a silent drop)', async () => {
    const d = deps({ reconcile: async () => { throw new Error('reconciler down'); } });
    const res = await runTitleExamPipeline(d, INPUT);
    expect(res.findingCount).toBeGreaterThan(0); // raw findings surfaced
  });

  it('both lanes failing persists status error with a banner', async () => {
    const d = deps({ examiner: async () => { throw new Error('provider down'); } });
    const res = await runTitleExamPipeline(d, INPUT);
    expect(res.laneMode).toBe('single_lane');
    expect(res.laneFailureBanner).toContain('EXAMINATION FAILED');
    expect(d.persisted[0]!.session.status).toBe('error');
  });
});

describe('TEX1-10 — title Express ports + the flag-gated router', () => {
  it('makeTitleExpressPorts returns a review + regenerate port (rides the platform loop)', () => {
    const ports = makeTitleExpressPorts({ subject: SUBJECT, reviewerModelString: 'm-rev' });
    expect(typeof ports.reviewPort).toBe('function');
    expect(typeof ports.regeneratePort).toBe('function');
  });

  it('the tRPC surface is flag-gated (PRECONDITION_FAILED/TITLE_EXAM_DISABLED) and registered', () => {
    const proc = read('src/server/procedures/titleExam.ts');
    expect(proc).toContain('isTitleExamEnabled');
    expect(proc).toContain('TITLE_EXAM_DISABLED');
    expect(proc).toContain('isEnabled: protectedProcedure.query');
    // resolves models from config (no literal in the surface)
    expect(proc).toContain("resolveTitleExamModel('examiner_a')");
    expect(read('src/server/router.ts')).toContain('titleExam: titleExamRouter');
  });
});
