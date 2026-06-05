/**
 * Export-safety gate at the export boundary — FOLD-SEND-1 (Increment 3).
 *
 * Runs the deterministic gate when a document is exported and LOGS every evaluation
 * (sendability_evaluation), per the triad disposition:
 *  - SHADOW MODE (SENDABILITY_GATE_ENABLED off, the v1 default): evaluate + log, but NEVER block —
 *    export proceeds exactly as before. This gathers the false-positive data before any flip.
 *  - ENFORCE (flag on, operator-gated flip later): a v1 block category (wrong_matter_id) hard-stops
 *    the export UNLESS a matching recorded override exists (versionId + content-hash bound).
 *  - FAIL-SAFE: the caller wraps runExportGate so ANY failure here lets the export proceed
 *    (fail-to-warn, never fail-to-block); the log write is itself best-effort.
 *
 * The override is created by a separate POST mutation (sendabilityGate.recordOverride), never here.
 */

import { assembleSendabilityContext } from './sendabilityContext.js';
import { evaluateSendability, type RuleLevelLookup, type SendabilityFinding } from './sendabilityEngine.js';
import { computeContentHash } from './contentHash.js';
import { listFirmSendabilityRules, listSendabilityOverridesForVersion, insertSendabilityEvaluation } from '../db/queries/sendability.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';
import type { SendabilityCheckCategory, SendabilityVerdict } from '../../shared/schemas/sendability.js';

/** Typed-confirmation phrase the attorney must enter to override a block (decision 3). */
export const EXPORT_OVERRIDE_CONFIRM_PHRASE = 'CONFIRM EXPORT';

/** Block categories that require a typed confirmation to override. v1: wrong_matter_id. */
export function requiresTypedConfirmation(category: SendabilityCheckCategory): boolean {
  return category === 'wrong_matter_id';
}

/** Validate the typed confirmation for an override. PURE. */
export function isTypedConfirmationValid(category: SendabilityCheckCategory, typed: string | null | undefined): boolean {
  if (!requiresTypedConfirmation(category)) return true;
  return (typed ?? '').trim().toUpperCase() === EXPORT_OVERRIDE_CONFIRM_PHRASE;
}

/** Whether the export is blocked: enforcing, and at least one block is NOT covered by an override. PURE. */
export function isExportBlocked(
  blocks: readonly SendabilityFinding[],
  enforced: boolean,
  overriddenCategories: ReadonlySet<SendabilityCheckCategory>,
): boolean {
  if (!enforced) return false; // shadow mode never blocks
  return blocks.some((b) => !overriddenCategories.has(b.category));
}

export interface ExportGateResult {
  blocked: boolean;
  verdict: SendabilityVerdict;
  blocks: SendabilityFinding[];
  warnings: SendabilityFinding[];
  unoverriddenBlocks: SendabilityFinding[];
}

/**
 * Evaluate + log the export-safety gate for the version being exported. NEVER throws on a gate
 * failure (the caller still wraps it). `enforced` is the flag; when false this is shadow-only.
 */
export async function runExportGate(params: {
  documentId: string;
  userId: string;
  matterId: string;
  exportVersionId: string;
  exportContent: string;
  enforced: boolean;
}): Promise<ExportGateResult> {
  const { documentId, userId, matterId, exportVersionId, exportContent, enforced } = params;
  const startedAt = Date.now();

  const { context } = await assembleSendabilityContext(documentId, userId);
  // No resolvable context -> treat as a degraded pass (fail-to-warn); never block.
  if (!context) {
    return { blocked: false, verdict: 'pass', blocks: [], warnings: [], unoverriddenBlocks: [] };
  }

  const rules = await listFirmSendabilityRules(userId);
  const ruleLevels: RuleLevelLookup[] = rules.map((r) => ({ category: r.category, documentType: r.documentType, level: r.level }));
  const evaluation = evaluateSendability(context, ruleLevels);

  // Overrides recorded for THIS version whose content-hash still matches the exported content.
  const contentHash = computeContentHash(exportContent);
  const overrides = await listSendabilityOverridesForVersion(exportVersionId, userId);
  const overriddenCategories = new Set<SendabilityCheckCategory>(
    overrides.filter((o) => o.contentHash === contentHash).map((o) => o.category),
  );

  const blocked = isExportBlocked(evaluation.blocks, enforced, overriddenCategories);
  const unoverriddenBlocks = evaluation.blocks.filter((b) => !overriddenCategories.has(b.category));

  // Best-effort append-only log (shadow or enforced). Never breaks the export.
  try {
    await insertSendabilityEvaluation({
      userId, matterId, documentId, versionId: exportVersionId,
      verdict: evaluation.verdict,
      blocks: evaluation.blocks as unknown[],
      warnings: evaluation.warnings as unknown[],
      llmComponentUsed: false,
      degraded: evaluation.degraded,
      durationMs: Date.now() - startedAt,
      enforced,
    });
  } catch {
    // swallow — logging must never block the export
  }

  void emitTelemetry(
    'sendability_evaluation_recorded',
    {
      verdict: evaluation.verdict,
      enforced,
      blockCategories: evaluation.blocks.map((b) => b.category),
      warningCategories: evaluation.warnings.map((w) => w.category),
      llmComponentUsed: false,
      degraded: evaluation.degraded,
      durationMs: Date.now() - startedAt,
    },
    { userId, matterId, documentId, jobId: null },
  );

  return { blocked, verdict: evaluation.verdict, blocks: evaluation.blocks, warnings: evaluation.warnings, unoverriddenBlocks };
}
