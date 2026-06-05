/**
 * Export-safety context assembler — FOLD-SEND-1 (Increment 2).
 *
 * Reads the deterministic inputs the pure engine needs and assembles a SendabilityContext. This is
 * the I/O boundary; the verdict logic lives in the PURE engine (sendabilityEngine.ts). Per the
 * triad disposition (decision 6), each optional check is wrapped FAIL-TO-WARN: if a read throws,
 * the category is marked degraded (-> a warning, never a block) and assembly continues. The core
 * document/matter/version reads are owner-scoped; everything else is best-effort.
 *
 * No enforcement here and no write — this only computes context. Shadow-mode logging + the export
 * wiring are Inc 3.
 */

import { getDocumentById } from '../db/queries/documents.js';
import { getMatterById } from '../db/queries/matters.js';
import { getVersionById } from '../db/queries/versions.js';
import { listAdoptLedgerForDocument } from '../db/queries/phase4b.js';
import { listOpenOpenItemsForMatter } from '../db/queries/openItems.js';
import { listFirmJurisdictionRules } from '../db/queries/sendability.js';
import { listClosurePackageItemsForMatter } from '../db/queries/closurePackage.js';
import { computeClosure } from '../draft/closureCheck.js';
import { isExportSafetyInScope } from './exportSafetyScope.js';
import {
  detectJurisdiction,
  requirementSatisfiedInContent,
  type SendabilityContext,
  type JurisdictionRequirementCheck,
} from './sendabilityEngine.js';
import type { SendabilityCheckCategory } from '../../shared/schemas/sendability.js';

export interface AssembledContextResult {
  context: SendabilityContext | null; // null when the document does not resolve to the owner
}

/** Assemble the deterministic export-safety context for a document's current version. Owner-scoped. */
export async function assembleSendabilityContext(documentId: string, userId: string): Promise<AssembledContextResult> {
  const doc = await getDocumentById(documentId, userId);
  if (!doc) return { context: null };

  const degraded: SendabilityCheckCategory[] = [];

  // wrong_matter_id inputs (core reads).
  const matter = await getMatterById(doc.matterId, userId);
  const matterResolved = matter !== null;
  const matterArchived = matter?.archivedAt != null;

  const version = doc.currentVersionId ? await getVersionById(doc.currentVersionId, userId) : null;
  const documentMatterLinkOk = version !== null && version.documentId === documentId;
  const content = version?.content ?? '';

  const inScope = isExportSafetyInScope(doc.documentType);

  // stale_baseline inputs (fail-to-warn).
  let hasAdoptions = false;
  let currentIsLastAdopted = true;
  try {
    const ledger = await listAdoptLedgerForDocument(documentId, userId); // newest first
    hasAdoptions = ledger.length > 0;
    if (hasAdoptions) {
      const latest = ledger[0]!;
      const baselineVersionId = latest.producedVersionId ?? latest.adoptedIntoVersionId;
      currentIsLastAdopted = doc.currentVersionId !== null && baselineVersionId === doc.currentVersionId;
    }
  } catch {
    degraded.push('stale_baseline');
  }

  // missing_required_signer inputs (fail-to-warn) — only when in scope + a jurisdiction is detectable.
  let jurisdictionRequirements: JurisdictionRequirementCheck[] = [];
  try {
    const jurisdiction = inScope ? detectJurisdiction(content) : null;
    if (jurisdiction) {
      const rules = await listFirmJurisdictionRules(userId, doc.documentType);
      jurisdictionRequirements = rules
        .filter((r) => r.jurisdiction === jurisdiction)
        .map((r) => ({ requirement: r.requirement, sourceTag: r.sourceTag, satisfied: requirementSatisfiedInContent(r.requirement, content) }));
    }
  } catch {
    degraded.push('missing_required_signer');
  }

  // open_execution_item inputs (fail-to-warn).
  let openExecutionItemCount = 0;
  try {
    const open = await listOpenOpenItemsForMatter(doc.matterId, userId);
    openExecutionItemCount = open.filter((o) => /execution|signature|signer|notar/i.test(o.category)).length;
  } catch {
    degraded.push('open_execution_item');
  }

  // package_completeness inputs (fail-to-warn).
  let packageComplete: boolean | null = null;
  try {
    const items = await listClosurePackageItemsForMatter(doc.matterId, userId);
    if (items.length > 0) {
      packageComplete = computeClosure(items.map((i) => ({ id: i.id, label: i.label, requirement: i.requirement, status: i.status }))).complete;
    }
  } catch {
    degraded.push('package_completeness');
  }

  return {
    context: {
      documentId,
      versionId: doc.currentVersionId ?? '',
      matterId: doc.matterId,
      documentType: doc.documentType,
      inScope,
      matterResolved,
      matterArchived,
      documentMatterLinkOk,
      hasAdoptions,
      currentIsLastAdopted,
      jurisdictionRequirements,
      openExecutionItemCount,
      packageComplete,
      degraded,
    },
  };
}
