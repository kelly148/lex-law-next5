/**
 * examOrchestrator.ts — TITLE-EXAM-1 (T3), the two-lane exam orchestration (§4).
 *
 * Runs TWO independent full examinations — examiner-A (manual-anchored) and examiner-B (research-capable) —
 * over a byte-IDENTICAL record set (differences are deliberate and come only from the lane instruction). One
 * lane erroring → a single-lane exam with a PROMINENT banner, never a silent drop (NC-10). Lane failure is
 * any examiner error OR any malformed lane output.
 *
 * The LLM call is an INJECTED port (LaneExaminer) so this build is tested against mocks/fixtures only — no
 * live provider call is made from here. A live examiner (executeCanonicalMutation-backed) is supplied by a
 * procedure later; the model per role is resolved from config (roles.resolveTitleExamModel), never a literal.
 *
 * PURE control flow + the injected port. Flag-dark by construction.
 */

import { buildLaneSystemPrompt } from './lanePrompts.js';
import { parseTitleExamLaneOutput, type TitleExamLaneFinding } from './laneOutput.js';
import type { TitleExamRole } from './roles.js';

export type ExamLaneRole = Extract<TitleExamRole, 'examiner_a' | 'examiner_b'>;

export interface LaneExaminerInput {
  role: ExamLaneRole;
  systemPrompt: string;
  /** The record set — IDENTICAL across both lanes (§4). */
  recordSet: string;
  /** The resolved model string for this role (provenance; from config, never a literal). */
  modelString: string;
}

/** The injected examiner port: given the lane input, return the lane's RAW string output (JSON array). */
export type LaneExaminer = (input: LaneExaminerInput) => Promise<string>;

export interface LaneResult {
  role: ExamLaneRole;
  modelString: string;
  status: 'ok' | 'failed';
  findings: TitleExamLaneFinding[];
  error?: string;
}

export interface TwoLaneExamResult {
  laneMode: 'two_lane' | 'single_lane';
  /** NC-10 — prominent banner when not both lanes succeeded; null only when both lanes are ok. */
  laneFailureBanner: string | null;
  /** Always two entries (honest N-of-2 display); a failed lane carries its error + empty findings. */
  lanes: LaneResult[];
  okLaneCount: number;
}

export interface RunTwoLaneExamInput {
  /** The single record set handed identically to both lanes. */
  recordSet: string;
  /** The resolved model string per role (from config.resolveTitleExamModel; recorded for provenance). */
  models: { examiner_a: string; examiner_b: string };
}

const ROLE_LABEL: Record<ExamLaneRole, string> = {
  examiner_a: 'manual-anchored (A)',
  examiner_b: 'research-capable (B)',
};

async function runLane(
  examiner: LaneExaminer,
  role: ExamLaneRole,
  recordSet: string,
  modelString: string,
): Promise<LaneResult> {
  try {
    const raw = await examiner({ role, systemPrompt: buildLaneSystemPrompt(role), recordSet, modelString });
    const findings = parseTitleExamLaneOutput(raw);
    return { role, modelString, status: 'ok', findings };
  } catch (err) {
    return {
      role,
      modelString,
      status: 'failed',
      findings: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildBanner(lanes: LaneResult[]): string | null {
  const failed = lanes.filter((l) => l.status === 'failed');
  if (failed.length === 0) return null;
  if (failed.length === lanes.length) {
    return (
      'EXAMINATION FAILED — both examination lanes errored: ' +
      failed.map((l) => `${ROLE_LABEL[l.role]} (${l.error ?? 'unknown error'})`).join('; ') +
      '. No examination was produced; do not rely on any partial output.'
    );
  }
  const ok = lanes.filter((l) => l.status === 'ok');
  return (
    'SINGLE-LANE EXAMINATION — the ' +
    failed.map((l) => `${ROLE_LABEL[l.role]} lane failed (${l.error ?? 'unknown error'})`).join('; ') +
    `. This examination reflects ONLY the ${ok.map((l) => ROLE_LABEL[l.role]).join(' + ')} lane; ` +
    'the independent cross-check did not run — treat the result with corresponding caution.'
  );
}

/**
 * Run the two-lane examination. Both lanes receive the IDENTICAL record set. Returns both lane results
 * (honest N-of-2), the lane mode, and — whenever a lane failed — a prominent banner (NC-10). Never throws
 * for a lane failure; the failure is surfaced in the result.
 */
export async function runTwoLaneExam(
  deps: { examiner: LaneExaminer },
  input: RunTwoLaneExamInput,
): Promise<TwoLaneExamResult> {
  // Both lanes get the SAME record set object — identical by construction (§4).
  const lanes = await Promise.all([
    runLane(deps.examiner, 'examiner_a', input.recordSet, input.models.examiner_a),
    runLane(deps.examiner, 'examiner_b', input.recordSet, input.models.examiner_b),
  ]);
  const okLaneCount = lanes.filter((l) => l.status === 'ok').length;
  return {
    laneMode: okLaneCount === 2 ? 'two_lane' : 'single_lane',
    laneFailureBanner: buildBanner(lanes),
    lanes,
    okLaneCount,
  };
}
