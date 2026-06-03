/**
 * Shared-context conversation substrate — FOLD-L1-3 (Appendix C.6).
 *
 * Assembles thread + materials + matter-state into ONE coherent, bounded, lane-aware
 * "everyone up to speed" package for a toggled-on reviewer lane joining a matter — NOT a
 * raw dump. Reuses the L1-1 Matter-State Engine (getMatterState), the L1-2 formatter
 * (formatMatterStateBlock), and the existing context pipeline (assembleContext); it adds a
 * bounded thread summary and the coherent package shape. Owner-scoped throughout (the
 * underlying reads are owner-scoped; getMatterState enforces matter ownership + the
 * integrity invariant).
 *
 * Structure mirrors L1-1: buildSharedContextPackage() does the I/O; summarizeThread() and
 * assembleSharedContextPackage() are pure and unit-testable.
 *
 * L1-3 is the substrate only — it does not itself dispatch lanes (matter-state injection is
 * L1-2; the five explicit acts + dashboard are L1-5). Cross-lane egress is governed by
 * FOLD-GOV-1's reviewed controls, not introduced here.
 */

import { getMatterState } from '../matterState/index.js';
import { formatMatterStateBlock } from '../matterState/injection.js';
import { assembleContext, type AssembledContext } from '../context/pipeline.js';
import { listVersionsForDocument } from '../db/queries/versions.js';
import {
  SharedContextPackageSchema,
  type SharedContextPackage,
  type ThreadSummary,
} from '../../shared/schemas/sharedContext.js';
import type { MatterIdentity, OperativeDocument } from '../../shared/schemas/matterState.js';
import type { VersionRow } from '../../shared/schemas/matters.js';

const MAX_RECENT_ITERATIONS = 10;
const CHARS_PER_TOKEN = 4; // standard estimate (matches the context pipeline's heuristic)

/**
 * Pure: summarize the drafting thread from a document's versions (newest-first as returned
 * by listVersionsForDocument). Bounded — not a transcript dump.
 */
export function summarizeThread(versions: VersionRow[]): ThreadSummary {
  const iterationNumbers = new Set(versions.map((v) => v.iterationNumber));
  const latestVersionNumber = versions.length > 0
    ? versions.reduce((max, v) => (v.versionNumber > max ? v.versionNumber : max), versions[0]!.versionNumber)
    : null;
  const recentIterations = versions.slice(0, MAX_RECENT_ITERATIONS).map((v) => ({
    iterationNumber: v.iterationNumber,
    versionNumber: v.versionNumber,
    createdAt: v.createdAt,
  }));
  return {
    iterationCount: iterationNumbers.size,
    versionCount: versions.length,
    latestVersionNumber,
    recentIterations,
  };
}

/**
 * Pure: assemble + bound + validate the coherent package. Materials are carried as
 * prioritized METADATA only (no textContent) — "not a raw dump"; the actual text flows via
 * the context pipeline / L1-2 injection at dispatch.
 */
export function assembleSharedContextPackage(inputs: {
  matter: MatterIdentity;
  operativeDocument: OperativeDocument | null;
  lanes: string[];
  matterStateBlock: string;
  materials: AssembledContext;
  thread: ThreadSummary;
}): SharedContextPackage {
  const m = inputs.materials;
  const materials = {
    includedMaterials: m.includedMaterials.map((mat) => ({
      materialId: mat.materialId,
      filename: mat.filename,
      tokenEstimate: mat.tokenEstimate,
      contextPriority: mat.contextPriority,
      pinned: mat.pinned,
    })),
    includedSiblingCount: m.includedSiblings.length,
    excludedCount: m.excluded.length,
    truncatedCount: m.truncated.length,
    assembledTokens: m.assembledTokens,
    budgetTokens: m.budgetTokens,
  };
  const blockTokens = Math.ceil(inputs.matterStateBlock.length / CHARS_PER_TOKEN);
  const pkg: SharedContextPackage = {
    matter: inputs.matter,
    operativeDocument: inputs.operativeDocument,
    lanes: inputs.lanes,
    matterStateBlock: inputs.matterStateBlock,
    materials,
    thread: inputs.thread,
    assembledTokens: m.assembledTokens + blockTokens,
  };
  // Zod wall on the assembled output.
  return SharedContextPackageSchema.parse(pkg);
}

/**
 * Build the shared-context package for a matter (and optional focus document), for the
 * given toggled-on lanes. Owner-scoped via the underlying reads.
 */
export async function buildSharedContextPackage(params: {
  matterId: string;
  userId: string;
  documentId?: string;
  lanes?: string[];
}): Promise<SharedContextPackage> {
  const { matterId, userId } = params;

  const state = await getMatterState({
    matterId,
    userId,
    mode: 'model_context',
    ...(params.documentId !== undefined ? { documentId: params.documentId } : {}),
  });
  // getMatterState with mode 'model_context' always returns the model_context shape; this
  // narrow is for the type system (and is a defensive no-op otherwise).
  if (state.mode !== 'model_context') {
    throw new Error('buildSharedContextPackage: expected model_context state');
  }
  const matterStateBlock = formatMatterStateBlock(state);

  const materials = await assembleContext({
    operation: 'review',
    matterId,
    userId,
    ...(params.documentId !== undefined ? { documentId: params.documentId } : {}),
  });

  const versions = params.documentId
    ? await listVersionsForDocument(params.documentId, userId)
    : [];
  const thread = summarizeThread(versions);

  return assembleSharedContextPackage({
    matter: state.matter,
    operativeDocument: state.operativeDocument,
    lanes: params.lanes ?? [],
    matterStateBlock,
    materials,
    thread,
  });
}
