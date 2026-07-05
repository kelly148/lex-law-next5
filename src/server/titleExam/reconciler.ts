/**
 * reconciler.ts — TITLE-EXAM-1 (T4), the fresh-context reconciliation layer (NC-1 / NC-2 / NC-4).
 *
 * The reconciler carries NO memory of its own lane's examination (NC-2): it runs in a fresh context and sees
 * ONLY the two lanes' outputs as data, and must steelman the other lane's unique catches. This module holds
 * (a) the reconciler system prompt and (b) the DETERMINISTIC application of NC-1 to the reconciler's proposed
 * items — the code, not the model, decides the disposition:
 *   - concordance is RE-DERIVED from the actual lane outputs (a reconciler claim of "both agree" is trusted
 *     only when both referenced findings really exist — the groupFromEvaluator discipline);
 *   - JUDGMENT conflicts are ESCALATE-ONLY (never auto-resolved), routed to the ADOPT/MODIFY/HOLD queue;
 *   - only record-resolvable / housekeeping items auto-dispose, with a recorded, VISIBLE rationale;
 *   - EVERY item is returned (full conflict visibility, incl. auto-resolved), plus the NC-4 sendability matrix.
 *
 * PURE. The reconciler's proposed items are produced by a (mocked, in this build) fresh LLM call; this module
 * never makes that call. Flag-dark by construction; no model literal.
 */

import type { TitleExamLaneFinding } from './laneOutput.js';
import { classifyConflictTier, matchedJudgmentTopics, type ConflictTier } from './judgmentTopics.js';
import type {
  TitleExamSourceBasis,
  TitleExamSendability,
  TitleExamClassification,
  TitleExamReconClass,
  TitleExamLaneOrigin,
  TitleExamEscalationState,
} from '../db/schema.js';

/** What the fresh-context reconciler proposes per reconciled finding (mocked in tests). Advisory: the code
 *  re-derives concordance + the disposition and OVER-escalates. */
export interface ReconcilerItemInput {
  title: string;
  detail?: string;
  sourceBasis: TitleExamSourceBasis;
  sendability: TitleExamSendability;
  classification: TitleExamClassification;
  /** NC-8/NC-9 provenance carried from the lane finding (surfaced in the internal memo). */
  downgraded?: boolean;
  ocrSourcePagePincite?: string | null;
  /** Index into laneA / laneB findings this item reconciles (omit if the lane did not raise it). */
  laneARef?: number;
  laneBRef?: number;
  laneAPosition?: string;
  laneBPosition?: string;
  recommendation?: string;
  /** The reconciler's own signals — advisory only. */
  isConflict?: boolean;
  isJudgment?: boolean;
  isHousekeeping?: boolean;
  recordResolvableCategory?: string;
}

export interface ReconciledFinding {
  title: string;
  detail: string | null;
  sourceBasis: TitleExamSourceBasis;
  sendability: TitleExamSendability;
  classification: TitleExamClassification;
  downgraded: boolean;
  ocrSourcePagePincite: string | null;
  laneOrigin: TitleExamLaneOrigin;
  reconClassification: TitleExamReconClass;
  isJudgmentConflict: boolean;
  tier: ConflictTier;
  /** 'auto_resolved' (record-resolvable) or 'escalated' (judgment → awaiting attorney ADOPT/MODIFY/HOLD). */
  escalationState: Extract<TitleExamEscalationState, 'auto_resolved' | 'escalated'>;
  autoResolvedRationale: string | null;
  laneAPosition: string | null;
  laneBPosition: string | null;
  recommendation: string | null;
  judgmentTopics: string[];
}

export interface SendabilityMatrixEntry {
  sendability: TitleExamSendability;
  count: number;
  findingTitles: string[];
}

export interface ReconciliationResult {
  /** ALL reconciled findings — full conflict visibility, including auto-resolved (NC-1). */
  findings: ReconciledFinding[];
  /** Judgment conflicts awaiting the attorney's logged ADOPT/MODIFY/HOLD (NC-1). */
  escalationQueue: ReconciledFinding[];
  /** Record-resolvable items the module auto-disposed (VISIBLE, with rationale). */
  autoResolved: ReconciledFinding[];
  /** NC-4 sendability matrix over all findings. */
  sendabilityMatrix: SendabilityMatrixEntry[];
  concordantCount: number;
  uniqueCatchCount: number;
  conflictCount: number;
}

export interface ReconcileInput {
  laneA: readonly TitleExamLaneFinding[];
  laneB: readonly TitleExamLaneFinding[];
  items: readonly ReconcilerItemInput[];
}

function refExists(ref: number | undefined, len: number): boolean {
  return typeof ref === 'number' && Number.isInteger(ref) && ref >= 0 && ref < len;
}

function reconcileOne(item: ReconcilerItemInput, laneALen: number, laneBLen: number): ReconciledFinding {
  // Re-derive lane presence from the ACTUAL outputs — trust a ref only when it exists.
  const aPresent = refExists(item.laneARef, laneALen);
  const bPresent = refExists(item.laneBRef, laneBLen);

  const laneOrigin: TitleExamLaneOrigin =
    aPresent && bPresent ? 'both' : aPresent ? 'examiner_a' : bPresent ? 'examiner_b' : 'reconciler';

  const tier = classifyConflictTier({ title: item.title, detail: item.detail ?? null }, item.isJudgment === true);
  const isJudgmentConflict = tier === 'judgment';

  // Reconciliation class re-derived from presence; a judgment item is a 'conflict' when both lanes touch it.
  let reconClassification: TitleExamReconClass;
  if (aPresent && bPresent) {
    reconClassification = item.isConflict === true || isJudgmentConflict ? 'conflict' : 'concordant';
  } else if (aPresent || bPresent) {
    reconClassification = 'unique_catch';
  } else {
    reconClassification = item.isHousekeeping === true && !isJudgmentConflict ? 'housekeeping' : 'unique_catch';
  }
  // A non-judgment item the reconciler marks housekeeping is labeled housekeeping regardless of presence.
  if (item.isHousekeeping === true && !isJudgmentConflict) reconClassification = 'housekeeping';

  // NC-1 disposition: judgment → escalate-only (never auto); record-resolvable → auto-dispose with rationale.
  const escalationState: 'auto_resolved' | 'escalated' = isJudgmentConflict ? 'escalated' : 'auto_resolved';
  const autoResolvedRationale =
    escalationState === 'auto_resolved'
      ? `Auto-resolved (record-resolvable${item.recordResolvableCategory ? `/${item.recordResolvableCategory}` : ''}): no vesting, marital, estate/fiduciary/entity-authority, insurability, lien-release, deed-construction, or requirement/exception judgment is implicated.`
      : null;

  return {
    title: item.title,
    detail: item.detail ?? null,
    sourceBasis: item.sourceBasis,
    sendability: item.sendability,
    classification: item.classification,
    downgraded: item.downgraded ?? false,
    ocrSourcePagePincite: item.ocrSourcePagePincite ?? null,
    laneOrigin,
    reconClassification,
    isJudgmentConflict,
    tier,
    escalationState,
    autoResolvedRationale,
    laneAPosition: item.laneAPosition ?? null,
    laneBPosition: item.laneBPosition ?? null,
    recommendation: item.recommendation ?? null,
    judgmentTopics: matchedJudgmentTopics(`${item.title}\n${item.detail ?? ''}`),
  };
}

function buildSendabilityMatrix(findings: readonly ReconciledFinding[]): SendabilityMatrixEntry[] {
  const map = new Map<TitleExamSendability, string[]>();
  for (const f of findings) {
    const list = map.get(f.sendability) ?? [];
    list.push(f.title);
    map.set(f.sendability, list);
  }
  return [...map.entries()].map(([sendability, findingTitles]) => ({
    sendability,
    count: findingTitles.length,
    findingTitles,
  }));
}

/**
 * Apply NC-1 deterministically to the reconciler's proposed items. Returns every reconciled finding (full
 * visibility), the escalation queue (judgment conflicts awaiting ADOPT/MODIFY/HOLD), the auto-resolved set
 * (with rationale), and the sendability matrix. The code — not the model — enforces escalate-only.
 */
export function reconcileLaneFindings(input: ReconcileInput): ReconciliationResult {
  const findings = input.items.map((item) => reconcileOne(item, input.laneA.length, input.laneB.length));
  return {
    findings,
    escalationQueue: findings.filter((f) => f.escalationState === 'escalated'),
    autoResolved: findings.filter((f) => f.escalationState === 'auto_resolved'),
    sendabilityMatrix: buildSendabilityMatrix(findings),
    concordantCount: findings.filter((f) => f.reconClassification === 'concordant').length,
    uniqueCatchCount: findings.filter((f) => f.reconClassification === 'unique_catch').length,
    conflictCount: findings.filter((f) => f.reconClassification === 'conflict').length,
  };
}

/** The fresh-context reconciler system prompt (NC-2). No memory of its own lane; steelman requirement; the
 *  §10.5 reconciliation watch-list. It LABELS; the module code constitutes the disposition. */
export const TITLE_EXAM_RECONCILER_SYSTEM_PROMPT = [
  'You are the reconciler for a two-lane title examination. You run in a FRESH CONTEXT and carry NO memory of',
  'having performed either examination — you see ONLY the two lanes’ outputs, as data, plus the record.',
  '',
  'Your job: reconcile the two independent examinations of the SAME record. For each finding:',
  '- STEELMAN the OTHER lane’s unique catches on the record before discounting them — a catch only one lane',
  '  made is not wrong for being unique; test it against the record.',
  '- Classify: CONCORDANT (both lanes, agreeing), UNIQUE CATCH (one lane, source-verified), CONFLICT (both',
  '  lanes, diverging), or HOUSEKEEPING (record-resolvable: format, caveat scope, or a discrepancy the',
  '  controlling recorded instrument answers on its face).',
  '- Give both lanes’ positions verbatim for any conflict, and a LABELED recommendation (mark a conservative',
  '  recommendation as such — "conservative" is a label on advice, never a disposition).',
  '',
  'ESCALATE-ONLY — never mark as housekeeping/auto-resolvable anything touching: vesting or tenancy',
  'characterization; marital rights; estate/fiduciary/entity authority; insurability; lien sufficiency or',
  'release theory (automatic-vs-presumptive, foreclosure extinguishment); deed construction; or anything that',
  'adds or removes a requirement or exception. These are JUDGMENT conflicts for the attorney.',
  '',
  'Watch-list (§10.5): shared-source concordance is NOT corroboration (both lanes trusting the same abstract',
  'line is one source, not two); every research-lane citation must be human-verified before external use;',
  'scope-driven divergences (one lane went deeper) are NOT catches; force a side-by-side on vesting, authority,',
  'and estate-exit; capture the currency date of any externally-verified proposition.',
  '',
  'You LABEL and recommend; you do NOT decide. The attorney adopts, modifies, or holds every judgment conflict.',
].join('\n');
