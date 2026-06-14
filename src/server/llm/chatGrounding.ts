/**
 * chatGrounding.ts — CHAT-COPILOT-1 Inc 3+4: grounding (document/material context) + source citations.
 *
 * Grounding is FAIL-CLOSED at the call site: the procedure assembles grounded context ONLY when the
 * turn's provider is on the (empty-by-default) grounded-chat allowlist AND the conversation is not
 * sensitivity-downgraded. This module is the assembler + the citation machinery; it is reached only for
 * an eligible turn. Reuses the SINGLE authoritative assembleContext (Ch 20) for pinned/sibling/recency
 * materials, adds the guaranteed slices (operative document current version + locked/adopted decisions),
 * applies deterministic category-level NPI minimization, mints sourceIds the model cannot invent, and
 * validates the model's citations against the assembled set (a cited sourceId not present is rejected).
 */

import { assembleContext, type OperationType } from '../context/pipeline.js';
import { getDocumentById } from '../db/queries/documents.js';
import { getVersionById } from '../db/queries/versions.js';
import { listMaterialsForMatter } from '../db/queries/materials.js';
import { listLockedDecisionsForMatter, listAdoptLedgerForMatter } from '../db/queries/phase4b.js';
import { chatTurnBudgetForMode, materialTagsAreNpiWithheld } from './chatCopilotConfig.js';
import type { ChatCitation } from '../../shared/schemas/chatCopilot.js';

const CHARS_PER_TOKEN = 4;
const estimate = (s: string): number => Math.ceil(s.length / CHARS_PER_TOKEN);

export interface GroundedSource {
  /** The id the model is given and must cite verbatim; never inventable. */
  sourceId: string;
  kind: 'operative_document' | 'locked_decision' | 'adopted_decision' | 'material' | 'sibling';
  label: string;
  text: string;
  /** A human locator hint (version/page/¶ or filename); reference-only, persisted with a citation. */
  locator: string | null;
}

export interface GroundedChatAssembly {
  sources: GroundedSource[];
  sourceIds: string[];
  /** The rendered context block prepended to the model input (sourceId-marked + cite instructions). */
  contextText: string;
  /** Materials/siblings dropped by budget or no-content (surfaced — never silently truncated). */
  omittedCount: number;
  /** True iff any source was truncated to fit budget (surfaced). */
  truncated: boolean;
  /** Materials withheld by the default category-level NPI minimization (not affirmatively selected). */
  npiWithheldCount: number;
}

// ── Pure: NPI minimization ────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic, category-level NPI minimization. Returns the material ids withheld-by-default (tagged
 * with a default-withheld NPI category) MINUS those the attorney affirmatively selected for this turn.
 */
export function npiWithheldMaterialIds(
  materials: ReadonlyArray<{ id: string; tags: readonly string[] }>,
  affirmativelySelectedIds: ReadonlySet<string>,
): string[] {
  return materials
    .filter((m) => materialTagsAreNpiWithheld(m.tags) && !affirmativelySelectedIds.has(m.id))
    .map((m) => m.id);
}

// ── Pure: render + citation parse ──────────────────────────────────────────────────────────────────────

/** Render the grounded sources into a context block with sourceId markers + citation instructions. */
export function renderGroundedContext(sources: GroundedSource[]): string {
  if (sources.length === 0) return '';
  const lines: string[] = [
    '[GROUNDED CONTEXT] Use ONLY the sources below as factual support. When you rely on a source, cite it',
    'inline as [[cite:SOURCE_ID]] or [[cite:SOURCE_ID|locator]]. NEVER cite a SOURCE_ID that is not listed',
    'here. Distinguish source-grounded statements from your own analysis.',
    '',
  ];
  for (const s of sources) {
    lines.push(`[SOURCE id=${s.sourceId} kind=${s.kind} label=${JSON.stringify(s.label)}]`);
    lines.push(s.text);
    lines.push('[/SOURCE]');
  }
  return lines.join('\n');
}

/**
 * CITATION FIDELITY (blocking): extract [[cite:...]] markers from the model output and validate each
 * against the assembled sourceId set. A cited sourceId NOT in the set is a hallucination signal — it is
 * REJECTED (dropped, not rendered/persisted) and counted. Returns de-duplicated valid citations
 * (reference-only sourceId + optional locator) + the rejected count.
 */
export function parseChatCitations(
  responseText: string,
  validSourceIds: ReadonlySet<string>,
): { citations: ChatCitation[]; rejectedCount: number } {
  const re = /\[\[cite:([^\]|]+)(?:\|([^\]]*))?\]\]/g;
  const citations: ChatCitation[] = [];
  const seen = new Set<string>();
  let rejectedCount = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(responseText)) !== null) {
    const sourceId = m[1]!.trim();
    const locatorRaw = m[2]?.trim();
    const locator = locatorRaw != null && locatorRaw.length > 0 ? locatorRaw : undefined;
    if (!validSourceIds.has(sourceId)) {
      rejectedCount += 1; // hallucinated source id -> drop, do not render/persist
      continue;
    }
    const key = `${sourceId}|${locator ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(locator != null ? { sourceId, locator } : { sourceId });
  }
  return { citations, rejectedCount };
}

// ── Assembly (reaches DB; reached ONLY for an eligible grounded turn) ───────────────────────────────────

export interface AssembleGroundedChatArgs {
  matterId: string;
  userId: string;
  documentId: string | null;
  mode?: string | null;
  /** Material ids the attorney affirmatively selected to send this turn (overrides NPI default-withhold). */
  selectedMaterialIds?: readonly string[];
}

/**
 * Assemble grounded chat context for an ELIGIBLE turn (the caller has already checked the provider
 * allowlist + sensitivity). Guaranteed slices first (operative document current version, then
 * locked/adopted decisions), then assembleContext for pinned + recency materials within the remaining
 * dynamic-by-mode budget, with NPI-withheld materials excluded unless affirmatively selected. Scoped
 * STRICTLY to the bound matter (+ document) — assembleContext is matter+owner scoped and the operative
 * document is read by id under the owner; no cross-matter assembly.
 */
export async function assembleGroundedChatContext(args: AssembleGroundedChatArgs): Promise<GroundedChatAssembly> {
  const budget = chatTurnBudgetForMode(args.mode);
  const sources: GroundedSource[] = [];
  let usedTokens = 0;
  let truncated = false;
  let omittedCount = 0;

  // 1) Operative document current version — guaranteed, full, prioritized (even if it crowds siblings).
  if (args.documentId) {
    const doc = await getDocumentById(args.documentId, args.userId);
    // current-matter scope: the bound document must belong to the bound matter (no cross-matter pull).
    if (doc && doc.matterId === args.matterId && doc.currentVersionId) {
      const ver = await getVersionById(doc.currentVersionId, args.userId);
      if (ver) {
        sources.push({
          sourceId: `doc:${doc.id}@${ver.id}`,
          kind: 'operative_document',
          label: `${doc.title} v${ver.versionNumber} (operative, current)`,
          text: ver.content,
          locator: `version ${ver.versionNumber}`,
        });
        usedTokens += estimate(ver.content);
      }
    }
  }

  // 2) Locked + adopted decisions — guaranteed slice (compact; the controlling attorney decisions).
  const locked = await listLockedDecisionsForMatter(args.matterId, args.userId);
  for (const ld of locked) {
    if (ld.status !== 'active') continue;
    const text = ld.rationale != null && ld.rationale.length > 0 ? `${ld.summary}\n${ld.rationale}` : ld.summary;
    sources.push({ sourceId: `locked:${ld.id}`, kind: 'locked_decision', label: `Locked decision (${ld.origin})`, text, locator: null });
    usedTokens += estimate(text);
  }
  const adopted = await listAdoptLedgerForMatter(args.matterId, args.userId);
  for (const al of adopted) {
    if (al.status !== 'active') continue;
    sources.push({ sourceId: `adopt:${al.id}`, kind: 'adopted_decision', label: `Adopted (${al.disposition})`, text: al.adoptedText, locator: null });
    usedTokens += estimate(al.adoptedText);
  }

  // 3) NPI minimization: compute the default-withheld material ids (minus affirmatively-selected).
  const selected = new Set<string>(args.selectedMaterialIds ?? []);
  const allMaterials = await listMaterialsForMatter(args.matterId, args.userId);
  const withheldIds = npiWithheldMaterialIds(allMaterials, selected);
  const npiWithheldCount = withheldIds.length;

  // 4) Pinned + recency materials (+ any explicit siblings) via the single authoritative assembler, within
  //    the remaining budget, with NPI-withheld materials excluded. Fail-closed on PINNED_OVERFLOW: degrade
  //    to the guaranteed slices only (materials omitted, surfaced) rather than crash the turn.
  const remaining = Math.max(0, budget - usedTokens);
  if (remaining > 0) {
    try {
      const ctx = await assembleContext({
        operation: 'chat_turn' satisfies OperationType,
        matterId: args.matterId,
        userId: args.userId,
        ...(args.documentId ? { documentId: args.documentId } : {}),
        explicitExcludeMaterialIds: withheldIds,
        budgetOverride: remaining,
      });
      for (const mtl of ctx.includedMaterials) {
        sources.push({
          sourceId: `material:${mtl.materialId}`,
          kind: 'material',
          label: mtl.filename ?? 'material',
          text: mtl.textContent,
          locator: mtl.filename,
        });
      }
      for (const sib of ctx.includedSiblings) {
        sources.push({
          sourceId: `doc:${sib.documentId}@${sib.versionId}`,
          kind: 'sibling',
          label: `${sib.documentTitle} v${sib.versionNumber}`,
          text: sib.content,
          locator: `version ${sib.versionNumber}`,
        });
      }
      // NPI-withheld materials were passed as explicitExcludeMaterialIds (so assembleContext lists them in
      // excluded[]); they are surfaced separately as npiWithheldCount, so do NOT double-count them here.
      const withheldSet = new Set<string>(withheldIds);
      omittedCount = ctx.excluded.filter((e) => !withheldSet.has(e.id)).length;
      truncated = ctx.truncated.length > 0;
    } catch {
      // PINNED_OVERFLOW or any assembly error -> degrade to the guaranteed slices; surface as truncated.
      truncated = true;
    }
  } else {
    // The guaranteed slices already consumed the budget; non-pinned materials are omitted (surfaced).
    truncated = true;
  }

  return {
    sources,
    sourceIds: sources.map((s) => s.sourceId),
    contextText: renderGroundedContext(sources),
    omittedCount,
    truncated,
    npiWithheldCount,
  };
}
