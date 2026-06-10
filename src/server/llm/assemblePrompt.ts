/**
 * assemblePrompt.ts — INSTR-1A0 (INSTRUCTIONS-LEG-1): the prompt-composition chokepoint.
 *
 * SINGLE FUNCTION, SINGLE CALL SITE: assemblePrompt() is the one place that decides whether
 * a dispatch's system block is a verbatim master asset or the legacy hardcoded path. Its only
 * call site is the LLM-dispatch chokepoint (executeCanonicalMutation), via the async
 * resolvePromptComposition() wrapper below that supplies the matter/doc rows.
 *
 * THIS INCREMENT (1A0) the logic is minimal — master/claude/te is returned as the ENTIRE
 * system block IFF ALL of:
 *   - PROMPT_COMPOSITION_ENABLED is exactly "true" (default OFF = zero behavior change);
 *   - callRole is 'draft' (jobType draft_generation — not regeneration/formatting/etc.);
 *   - the resolved model IS the Anthropic drafter (modelString === PRIMARY_DRAFTER_MODEL
 *     AND its provider is 'anthropic' — an operator override of PRIMARY_DRAFTER_MODEL to a
 *     non-Anthropic model disables composition rather than sending a Claude master elsewhere);
 *   - the matter's practice area EXACT-MATCHES the T&E set below (matters.paKey — the
 *     attorney-CONFIRMED key — or the matter's practiceArea field, verbatim string equality
 *     against a finite literal set; NO inference, NO normalization, NO fallback — that is 1B).
 * Anything else -> legacy hardcoded path, byte-for-byte unchanged (systemText null tells the
 * chokepoint to leave its existing legacy block — including the matter-state and per-PA-profile
 * injections — completely untouched).
 *
 * When composed, the master IS the entire system block: the chokepoint's matter-state and
 * PA-profile prepends are intentionally NOT applied (cache hygiene — no per-job data inside
 * the system block; matter materials/context continue to ride the user turn). This is the
 * measured 1A0 baseline; layered composition is 1A-prime.
 */

import { PRIMARY_DRAFTER_MODEL, parseModelString } from './config.js';
import { isPromptCompositionEnabled } from '../config/featureFlags.js';
import { getPromptAsset, MASTER_CLAUDE_TE } from './promptAssets.js';

// ============================================================
// Call roles
// ============================================================
// The composition-facing view of a jobType. Only 'draft' participates in 1A0; the rest
// exist so snapshots record a stable role vocabulary (reviewer composition is 1C).

export type PromptCallRole =
  | 'draft'
  | 'regenerate'
  | 'format'
  | 'extract'
  | 'outline'
  | 'matrix'
  | 'review'
  | 'evaluator'
  | 'analysis'
  | 'other';

export function callRoleForJobType(jobType: string): PromptCallRole {
  switch (jobType) {
    case 'draft_generation':
      return 'draft';
    case 'regeneration':
      return 'regenerate';
    case 'formatting':
      return 'format';
    case 'data_extraction':
      return 'extract';
    case 'outline_generation':
      return 'outline';
    case 'information_request_generation':
      return 'matrix';
    case 'review':
    case 'reviewer_feedback':
      return 'review';
    case 'evaluator':
      return 'evaluator';
    case 'matter_analysis':
      return 'analysis';
    default:
      return 'other';
  }
}

// ============================================================
// T&E practice-area exact-match set (1A0 minimal mapping)
// ============================================================
// Verbatim string equality only — each entry is an exact literal; there is deliberately no
// case-folding, trimming, or fuzzy matching (NO inference fallback yet; selection logic is 1B).
// Checked against matters.paKey (the attorney-confirmed key, never inferred) and the matter's
// freeform practiceArea field.

export const TE_PRACTICE_AREA_EXACT_MATCHES: ReadonlySet<string> = new Set([
  'estate_planning',
  'trusts_estates',
  'Estate Planning',
  'Trusts & Estates',
  'T&E',
]);

// ============================================================
// The pure decision function
// ============================================================

export interface AssemblePromptMatter {
  paKey: string | null;
  practiceArea: string | null;
}

export interface AssembledPrompt {
  /** 'legacy' = leave the legacy hardcoded path byte-for-byte unchanged. */
  source: typeof MASTER_CLAUDE_TE | 'legacy';
  /** The ENTIRE system block when composed; null on the legacy path. */
  systemText: string | null;
  /** The composed asset's manifest SHA-256; null on the legacy path. */
  assetSha256: string | null;
  /** Flag state at decision time (snapshotted). */
  flagEnabled: boolean;
}

export function assemblePrompt(args: {
  matter: AssemblePromptMatter | null;
  docType: string | null; // carried for snapshots + 1B selection; not consulted in 1A0
  callRole: PromptCallRole;
  model: string; // "provider:model"
}): AssembledPrompt {
  const flagEnabled = isPromptCompositionEnabled();
  const legacy: AssembledPrompt = { source: 'legacy', systemText: null, assetSha256: null, flagEnabled };

  if (!flagEnabled) return legacy;
  if (args.callRole !== 'draft') return legacy;
  if (args.model !== PRIMARY_DRAFTER_MODEL) return legacy;
  if (parseModelString(args.model).providerId !== 'anthropic') return legacy;

  const matter = args.matter;
  if (!matter) return legacy;
  const paMatch =
    (matter.paKey !== null && TE_PRACTICE_AREA_EXACT_MATCHES.has(matter.paKey)) ||
    (matter.practiceArea !== null && TE_PRACTICE_AREA_EXACT_MATCHES.has(matter.practiceArea));
  if (!paMatch) return legacy;

  const asset = getPromptAsset(MASTER_CLAUDE_TE);
  return { source: MASTER_CLAUDE_TE, systemText: asset.text, assetSha256: asset.sha256, flagEnabled };
}

// ============================================================
// Async resolver for the chokepoint (DB-touching wrapper)
// ============================================================
// Supplies the matter/doc rows to the pure function. Cheap guards run FIRST so the
// flag-OFF (and non-draft / non-Anthropic-drafter) paths perform ZERO DB reads — the
// "flag OFF = zero behavior change anywhere" guarantee includes query traffic.

export interface CompositionReaders {
  getMatter: (
    matterId: string,
    userId: string,
  ) => Promise<{ paKey?: string | null | undefined; practiceArea?: string | null | undefined } | null | undefined>;
  getDocument: (
    documentId: string,
    userId: string,
  ) => Promise<{ documentType: string } | null | undefined>;
}

let _readers: CompositionReaders | null = null;

/** Test seam: override the matter/document readers. Pass null to restore the real queries. */
export function setCompositionReaders(readers: CompositionReaders | null): void {
  _readers = readers;
}

async function getReaders(): Promise<CompositionReaders> {
  if (_readers !== null) return _readers;
  // Lazy dynamic import so importing this module never pulls the DB connection into
  // contexts (tests, tooling) that only need the pure decision function.
  const matters = await import('../db/queries/matters.js');
  const documents = await import('../db/queries/documents.js');
  return { getMatter: matters.getMatterById, getDocument: documents.getDocumentById };
}

export interface ResolvedComposition extends AssembledPrompt {
  callRole: PromptCallRole;
  docType: string | null;
}

export async function resolvePromptComposition(args: {
  jobType: string;
  modelString: string;
  matterId: string | null;
  documentId: string | null;
  userId: string;
}): Promise<ResolvedComposition> {
  const callRole = callRoleForJobType(args.jobType);
  const flagEnabled = isPromptCompositionEnabled();
  const legacy: ResolvedComposition = {
    source: 'legacy',
    systemText: null,
    assetSha256: null,
    flagEnabled,
    callRole,
    docType: null,
  };

  // Cheap guards first — no DB reads unless the flag is ON and this is the one wired path.
  if (!flagEnabled) return legacy;
  if (callRole !== 'draft') return legacy;
  if (args.modelString !== PRIMARY_DRAFTER_MODEL) return legacy;
  if (parseModelString(args.modelString).providerId !== 'anthropic') return legacy;
  if (!args.matterId) return legacy;

  try {
    const readers = await getReaders();
    const matter = (await readers.getMatter(args.matterId, args.userId)) ?? null;
    const doc = args.documentId ? ((await readers.getDocument(args.documentId, args.userId)) ?? null) : null;
    const docType = doc?.documentType ?? null;
    const decision = assemblePrompt({
      matter: matter ? { paKey: matter.paKey ?? null, practiceArea: matter.practiceArea ?? null } : null,
      docType,
      callRole,
      model: args.modelString,
    });
    return { ...decision, callRole, docType };
  } catch {
    // Fail CLOSED to the legacy path: a read error can never break a model call, and an
    // unestablished practice area must never compose a master. The snapshot records
    // source='legacy' so the miss is visible in the measured data.
    return legacy;
  }
}
