/**
 * Context Composition Pipeline — Ch 20
 *
 * This is the SINGLE AUTHORITATIVE assembler for all LLM operation context (R14).
 * No procedure may assemble context locally — all context assembly goes through
 * this module.
 *
 * Assembly order (Ch 20.2):
 *   Tier 1: Pinned materials (always included; PINNED_OVERFLOW if they alone exceed budget)
 *   Tier 2: Sibling document references (explicit, ordered by attorney selection)
 *   Tier 3: Non-pinned materials (sorted by recency; truncated to fit budget)
 *
 * Token budget (Ch 20.3):
 *   Total budget = CONTEXT_BUDGET_TOKENS (configurable per operation type)
 *   Pinned materials consume first; remaining budget allocated to Tier 2 then Tier 3.
 *   Truncation is applied at the material level (not mid-material).
 *
 * The assembler is an internal function — not a tRPC procedure.
 * contextPipeline.preview is the only client-callable surface (Ch 21.11).
 */

import { TRPCError } from '@trpc/server';
import { listPinnedMaterials, listMaterialsForMatter } from '../db/queries/materials.js';
import { getVersionById } from '../db/queries/versions.js';
import { getDocumentById } from '../db/queries/documents.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';

// ============================================================
// Constants (Ch 20.3)
// ============================================================

/**
 * Default token budgets per operation type.
 * These are conservative estimates; actual budgets are set by the LLM adapter
 * based on the model's context window.
 */
export const OPERATION_BUDGETS: Record<OperationType, number> = {
  draft_generation: 80_000,
  regeneration: 80_000,
  data_extraction: 60_000,
  review: 60_000,
  formatting: 40_000,
  information_request_generation: 60_000,
  outline_generation: 60_000,
  context_preview: 80_000,
};

/**
 * Rough token estimate: 1 token ≈ 4 characters (conservative for legal text).
 * Used for budget calculations before the actual LLM tokenizer is available.
 */
const CHARS_PER_TOKEN = 4;

export type OperationType =
  | 'draft_generation'
  | 'regeneration'
  | 'data_extraction'
  | 'review'
  | 'formatting'
  | 'information_request_generation'
  | 'outline_generation'
  | 'context_preview';

// ============================================================
// Types
// ============================================================

export interface IncludedMaterial {
  materialId: string;
  filename: string | null;
  textContent: string;
  tokenEstimate: number;
  tier: 1 | 3; // 1 = pinned, 3 = non-pinned
  pinned: boolean;
}

export interface IncludedSibling {
  documentId: string;
  documentTitle: string;
  versionId: string;
  versionNumber: number;
  content: string;
  tokenEstimate: number;
}

export interface ExcludedItem {
  id: string;
  type: 'material' | 'sibling';
  reason: 'budget_exceeded' | 'deleted' | 'no_content' | 'extraction_failed';
}

export interface TruncatedItem {
  id: string;
  type: 'material' | 'sibling';
  originalTokens: number;
  truncatedTokens: number;
}

export interface AssembledContext {
  assembledTokens: number;
  budgetTokens: number;
  includedMaterials: IncludedMaterial[];
  includedSiblings: IncludedSibling[];
  excluded: ExcludedItem[];
  truncated: TruncatedItem[];
}

export interface AssembleContextParams {
  operation: OperationType;
  matterId: string;
  userId: string;
  documentId?: string;
  /** Explicit sibling document IDs to include (Tier 2). If omitted, no siblings included. */
  explicitSiblingIds?: string[];
  /** Material IDs to explicitly exclude from context. */
  explicitExcludeMaterialIds?: string[];
  /** Override the default budget for this operation. */
  budgetOverride?: number;
}

// ============================================================
// Token estimation helpers
// ============================================================

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  const maxChars = tokenBudget * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

// ============================================================
// Main assembler (internal — not a tRPC procedure)
// ============================================================

/**
 * Assemble context for an LLM operation.
 *
 * This is the SOLE context assembly path (R14). Called by operation-enqueuing
 * procedures (document.generateDraft, document.extractVariables, etc.) as part
 * of their side effects. Also called by contextPipeline.preview (Ch 21.11).
 *
 * Throws PINNED_OVERFLOW if pinned materials alone exceed the budget.
 */
export async function assembleContext(
  params: AssembleContextParams,
): Promise<AssembledContext> {
  const {
    operation,
    matterId,
    userId,
    documentId,
    explicitSiblingIds = [],
    explicitExcludeMaterialIds = [],
    budgetOverride,
  } = params;

  const budgetTokens = budgetOverride ?? OPERATION_BUDGETS[operation];
  let remainingBudget = budgetTokens;

  const includedMaterials: IncludedMaterial[] = [];
  const includedSiblings: IncludedSibling[] = [];
  const excluded: ExcludedItem[] = [];
  const truncated: TruncatedItem[] = [];

  // ============================================================
  // Tier 1: Pinned materials (Ch 20.2)
  // ============================================================

  const pinnedMaterials = await listPinnedMaterials(matterId, userId);
  const excludeSet = new Set(explicitExcludeMaterialIds);

  for (const material of pinnedMaterials) {
    if (excludeSet.has(material.id)) {
      excluded.push({ id: material.id, type: 'material', reason: 'deleted' });
      continue;
    }
    if (!material.textContent) {
      excluded.push({
        id: material.id,
        type: 'material',
        reason: material.extractionStatus === 'failed'
          ? 'extraction_failed'
          : 'no_content',
      });
      continue;
    }

    const tokenEstimate = estimateTokens(material.textContent);

    // PINNED_OVERFLOW: pinned materials alone exceed budget (Ch 20.2 / Ch 21.11)
    if (tokenEstimate > remainingBudget) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'PINNED_OVERFLOW',
      });
    }

    includedMaterials.push({
      materialId: material.id,
      filename: material.filename,
      textContent: material.textContent,
      tokenEstimate,
      tier: 1,
      pinned: true,
    });
    remainingBudget -= tokenEstimate;
  }

  // ============================================================
  // Tier 2: Sibling document references (Ch 20.2)
  // ============================================================

  if (explicitSiblingIds.length > 0) {
    for (const siblingId of explicitSiblingIds) {
      if (remainingBudget <= 0) {
        excluded.push({ id: siblingId, type: 'sibling', reason: 'budget_exceeded' });
        continue;
      }

      const sibling = await getDocumentById(siblingId, userId);
      if (!sibling || !sibling.currentVersionId) {
        excluded.push({ id: siblingId, type: 'sibling', reason: 'no_content' });
        continue;
      }

      const version = await getVersionById(sibling.currentVersionId, userId);
      if (!version) {
        excluded.push({ id: siblingId, type: 'sibling', reason: 'no_content' });
        continue;
      }

      const tokenEstimate = estimateTokens(version.content);

      if (tokenEstimate > remainingBudget) {
        // Truncate to fit (Ch 20.3 — truncation at material level)
        const truncatedContent = truncateToTokenBudget(
          version.content,
          remainingBudget,
        );
        const truncatedTokens = estimateTokens(truncatedContent);
        truncated.push({
          id: siblingId,
          type: 'sibling',
          originalTokens: tokenEstimate,
          truncatedTokens,
        });
        includedSiblings.push({
          documentId: siblingId,
          documentTitle: sibling.title,
          versionId: version.id,
          versionNumber: version.versionNumber,
          content: truncatedContent,
          tokenEstimate: truncatedTokens,
        });
        remainingBudget -= truncatedTokens;
      } else {
        includedSiblings.push({
          documentId: siblingId,
          documentTitle: sibling.title,
          versionId: version.id,
          versionNumber: version.versionNumber,
          content: version.content,
          tokenEstimate,
        });
        remainingBudget -= tokenEstimate;
      }
    }
  }

  // ============================================================
  // Tier 3: Non-pinned materials (Ch 20.2)
  // ============================================================

  const allMaterials = await listMaterialsForMatter(matterId, userId);
  const includedPinnedIds = new Set(
    includedMaterials.map((m) => m.materialId),
  );

  const nonPinnedMaterials = allMaterials.filter(
    (m) =>
      !m.pinned &&
      !excludeSet.has(m.id) &&
      !includedPinnedIds.has(m.id),
  );

  for (const material of nonPinnedMaterials) {
    if (remainingBudget <= 0) {
      excluded.push({
        id: material.id,
        type: 'material',
        reason: 'budget_exceeded',
      });
      continue;
    }

    if (!material.textContent) {
      excluded.push({
        id: material.id,
        type: 'material',
        reason: material.extractionStatus === 'failed'
          ? 'extraction_failed'
          : 'no_content',
      });
      continue;
    }

    const tokenEstimate = estimateTokens(material.textContent);

    if (tokenEstimate > remainingBudget) {
      // Truncate to fit
      const truncatedContent = truncateToTokenBudget(
        material.textContent,
        remainingBudget,
      );
      const truncatedTokens = estimateTokens(truncatedContent);
      truncated.push({
        id: material.id,
        type: 'material',
        originalTokens: tokenEstimate,
        truncatedTokens,
      });
      includedMaterials.push({
        materialId: material.id,
        filename: material.filename,
        textContent: truncatedContent,
        tokenEstimate: truncatedTokens,
        tier: 3,
        pinned: false,
      });
      remainingBudget -= truncatedTokens;
    } else {
      includedMaterials.push({
        materialId: material.id,
        filename: material.filename,
        textContent: material.textContent,
        tokenEstimate,
        tier: 3,
        pinned: false,
      });
      remainingBudget -= tokenEstimate;
    }
  }

  const assembledTokens = budgetTokens - remainingBudget;

  // Emit telemetry for actual operations (not previews)
  if (operation !== 'context_preview' && documentId) {
    void emitTelemetry(
      'materials_included_in_operation',
      {
        operation,
        includedMaterialIds: includedMaterials.map((m) => m.materialId),
        pinnedCount: includedMaterials.filter((m) => m.pinned).length,
        tokensTotal: assembledTokens,
        excludedMaterialIds: excluded.map((e) => e.id),
        truncatedMaterialIds: truncated.map((t) => t.id),
      },
      { userId, matterId, documentId },
    );
  }

  return {
    assembledTokens,
    budgetTokens,
    includedMaterials,
    includedSiblings,
    excluded,
    truncated,
  };
}
