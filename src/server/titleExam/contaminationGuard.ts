/**
 * contaminationGuard.ts — TITLE-EXAM-1 (T5), NC-7 cross-matter contamination guards.
 *
 * Seed facts arrive labeled by SOURCE matter and are HYPOTHESES: none may support a requirement, exception,
 * or vesting conclusion until re-verified against the CURRENT matter's own record. A source-matter-ID
 * mismatch auto-flags; the attorney must complete an import-justification (or do-not-import) before
 * reconciliation can close. The lane may PROPOSE a seed fact; it may not SILENTLY apply one.
 *
 * PURE + deterministic (NC-7 wants deterministic guards, not model judgment). Flag-dark by construction.
 */

import { isJudgmentTopic } from './judgmentTopics.js';
import type { TitleExamClassification, TitleExamSourceBasis } from '../db/schema.js';

// Classifications that ASSERT a closing/recording/disbursement requirement or a policy exception — the
// conclusions a seed fact may NOT support until re-verified (NC-7).
const REQUIREMENT_CLASSIFICATIONS: readonly TitleExamClassification[] = [
  'closing_requirement',
  'recording_requirement',
  'disbursement_condition',
  'policy_exception',
];

export interface ContaminationInput {
  currentMatterId: string;
  title?: string;
  detail?: string | null;
  sourceBasis: TitleExamSourceBasis;
  classification: TitleExamClassification;
  /** The matter a seed fact came from (labeled at intake); null/empty when the finding is not seed-derived. */
  seedSourceMatterId?: string | null;
  importJustification?: string | null;
  importResolved?: boolean;
}

export interface ContaminationVerdict {
  isSeedDerived: boolean;
  sourceMatterMismatch: boolean;
  /** True while the finding is blocked as contaminated (auto-flag), before the attorney resolves the import. */
  seedContaminationFlag: boolean;
  /** True when a seed fact would support a requirement/exception/vesting conclusion and is not yet re-verified. */
  mustReverifyBeforeUse: boolean;
  reason: string | null;
}

function isResolved(input: Pick<ContaminationInput, 'importResolved' | 'importJustification'>): boolean {
  return input.importResolved === true && !!input.importJustification && input.importJustification.trim().length > 0;
}

/**
 * Evaluate NC-7 contamination for one finding. A seed-derived finding is auto-flagged when its source matter
 * differs from the current matter, OR when it would support a requirement/exception/vesting conclusion and has
 * not been re-verified (import resolved). The flag clears only once the attorney records an import-justification.
 */
export function evaluateContamination(input: ContaminationInput): ContaminationVerdict {
  const seedId = input.seedSourceMatterId?.trim() ?? '';
  const isSeedDerived = input.sourceBasis === 'prior_matter_seed' || seedId.length > 0;
  const sourceMatterMismatch = seedId.length > 0 && seedId !== input.currentMatterId;

  const supportsRequirement = REQUIREMENT_CLASSIFICATIONS.includes(input.classification);
  const supportsVesting = isJudgmentTopic(`${input.title ?? ''}\n${input.detail ?? ''}`);
  const resolved = isResolved(input);
  const mustReverifyBeforeUse = isSeedDerived && (supportsRequirement || supportsVesting) && !resolved;

  const seedContaminationFlag = !resolved && (sourceMatterMismatch || mustReverifyBeforeUse);

  let reason: string | null = null;
  if (seedContaminationFlag) {
    const causes: string[] = [];
    if (sourceMatterMismatch) causes.push(`carries a source-matter-ID (${seedId}) that differs from the current matter (${input.currentMatterId})`);
    if (mustReverifyBeforeUse) causes.push('would support a requirement/exception/vesting conclusion and has not been re-verified against this matter’s record');
    reason = `Seed fact (hypothesis) ${causes.join(' and ')}; complete an import-justification (or do-not-import) before use.`;
  }

  return { isSeedDerived, sourceMatterMismatch, seedContaminationFlag, mustReverifyBeforeUse, reason };
}

// ── Reconciliation-close block ───────────────────────────────────────────────────────────────────

export interface ClosureFindingInput {
  id: string;
  title?: string;
  seedContaminationFlag: boolean;
  importResolved?: boolean;
  importJustification?: string | null;
}

export interface ReconciliationClosureResult {
  canClose: boolean;
  blockers: Array<{ id: string; title: string; reason: string }>;
}

/**
 * Reconciliation CANNOT close while any contamination-flagged finding lacks a completed import-justification
 * (NC-7: the attorney completes the import-justification / do-not-import field BEFORE reconciliation closes).
 */
export function assessReconciliationClosure(
  findings: readonly ClosureFindingInput[],
): ReconciliationClosureResult {
  const blockers = findings
    .filter((f) => f.seedContaminationFlag && !isResolved(f))
    .map((f) => ({
      id: f.id,
      title: f.title ?? '',
      reason: 'contamination-flagged seed fact requires an import-justification (or do-not-import) before reconciliation can close',
    }));
  return { canClose: blockers.length === 0, blockers };
}

// ── Import resolution (the attorney's affirmative decision) ──────────────────────────────────────

export type ImportDecision = 'import' | 'do_not_import';

export interface ImportResolution {
  importResolved: boolean;
  importJustification: string;
  /** After the decision the finding is no longer contamination-blocked. */
  seedContaminationFlag: boolean;
}

/**
 * Apply the attorney's import decision to a finding. 'import' requires a non-empty justification (why the
 * seed fact is validly carried into this matter); 'do_not_import' records the exclusion. Either way the
 * contamination block clears — but 'import' without a justification is refused (NC-7: silence is not import).
 */
export function resolveImport(decision: ImportDecision, justification: string | null | undefined): ImportResolution {
  const j = justification?.trim() ?? '';
  if (decision === 'import') {
    if (j.length === 0) {
      throw new Error('NC-7: importing a seed fact requires a non-empty import-justification.');
    }
    return { importResolved: true, importJustification: j, seedContaminationFlag: false };
  }
  return {
    importResolved: true,
    importJustification: `do-not-import${j.length > 0 ? `: ${j}` : ''}`,
    seedContaminationFlag: false,
  };
}
