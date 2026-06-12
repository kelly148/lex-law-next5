/**
 * assemblePrompt.ts — INSTR-1A0 (INSTRUCTIONS-LEG-1): the prompt-composition chokepoint.
 *
 * SINGLE FUNCTION, SINGLE CALL SITE: assemblePrompt() is the one place that decides whether
 * a dispatch's system block is a verbatim master asset or the legacy hardcoded path. Its only
 * call site is the LLM-dispatch chokepoint (executeCanonicalMutation), via the async
 * resolvePromptComposition() wrapper below that supplies the matter/doc rows.
 *
 * TWO FLAGS, in precedence order:
 *
 *   - INSTR-2B-core (MASTER_LAWFIRM_ENABLED, default OFF) — drafting master SELECTION, LAYERED.
 *     When ON, a drafting job (draft_generation OR regeneration) on the Anthropic drafter selects
 *     a master based on practice area: exact-match T&E keys -> master/claude/te; ANY OTHER paKey
 *     (including unconfirmed/NULL and, for now, title_settlement) -> master/claude/lawfirm (the
 *     operator-ratified safe default). The selected master is returned via `layeredMasterText`,
 *     which the chokepoint layers ON TOP of the matter-state block + the per-call role prompt (D-4)
 *     while SUPPRESSING the per-PA instruction profile (D-5). Title routing (master/claude/title)
 *     is INSTR-2B-TITLE, deferred — title_settlement gets the lawfirm safe default here.
 *
 *   - INSTR-1A0 (PROMPT_COMPOSITION_ENABLED, default OFF) — the original TE BLOB path. Used only
 *     when MASTER_LAWFIRM_ENABLED is OFF: master/claude/te is returned via `systemText` as the
 *     ENTIRE system block (draft-only, exact-match T&E, Anthropic drafter), matter-state +
 *     PA-profile intentionally skipped (cache hygiene). Byte-for-byte unchanged.
 *
 * Anything else -> legacy (both systemText and layeredMasterText null): the chokepoint leaves its
 * legacy block — matter-state + per-PA-profile injections — completely untouched. Both flags OFF
 * (the default) is the pre-INSTR-1A0 behavior with ZERO DB reads.
 */

import { PRIMARY_DRAFTER_MODEL, parseModelString } from './config.js';
import { isPromptCompositionEnabled, isMasterLawfirmEnabled, isMasterOutlineEnabled } from '../config/featureFlags.js';
import { getPromptAsset, MASTER_CLAUDE_TE, MASTER_CLAUDE_LAWFIRM, MASTER_CLAUDE_TITLE } from './promptAssets.js';
import { resolveOutlineMaster } from './outlineMasterComposition.js';

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
// INSTR-2C R1 — the composition ALLOWLIST (not a denylist)
// ============================================================
// A firm master composes ONLY for a callRole in this explicit allowlist; every OTHER callRole —
// including any FUTURE-added role — returns legacy BY CONSTRUCTION. This is the structural firewall the
// reviewer/evaluator exclusion now rests on: 'review'/'reviewer_feedback'/'evaluator' (callRoles
// 'review'/'evaluator'), plus 'analysis'/'matrix'/'extract'/'format'/'other', are NOT in the set and
// can never reach a master regardless of any flag. Adding a role is a deliberate, reviewable edit here.
//
// Members: 'draft'/'regenerate' (INSTR-2B drafting, MASTER_LAWFIRM_ENABLED / PROMPT_COMPOSITION_ENABLED);
// 'outline' (INSTR-2C, MASTER_OUTLINE_ENABLED, this file's resolver); and 'chat' — realized via the chat
// dispatcher's `chatMasterText` param (chat_turn maps to callRole 'other', so 'chat' never appears as a
// callRole HERE; it is listed so the allowlist is the single system-wide record of master-eligible roles).
export const MASTER_COMPOSABLE_CALLROLES: ReadonlySet<string> = new Set([
  'draft',
  'regenerate',
  'chat',
  'outline',
]);

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
  /**
   * INSTR-2B-title: the matter's firm capacity election. OPTIONAL — absent === no election ===
   * the safe default. Only the affirmative 'title_settlement_agent' value selects the Title
   * master; absent/'law_firm'/anything else falls through to the INSTR-2B-core routing (te /
   * lawfirm safe default).
   */
  engagementCapacity?: string | null;
}

/** The logical IDs a draft can compose: the T&E, the general Law Firm, or the Title master. */
export type MasterSource =
  | typeof MASTER_CLAUDE_TE
  | typeof MASTER_CLAUDE_LAWFIRM
  | typeof MASTER_CLAUDE_TITLE;

export interface AssembledPrompt {
  /** The selected master logical ID, or 'legacy' (leave the legacy path byte-for-byte unchanged). */
  source: MasterSource | 'legacy';
  /**
   * BLOB path (INSTR-1A0; MASTER_LAWFIRM_ENABLED OFF + PROMPT_COMPOSITION_ENABLED ON, T&E only):
   * the master IS the ENTIRE system block (matter-state + PA-profile intentionally skipped).
   * null on the layered/legacy paths.
   */
  systemText: string | null;
  /**
   * LAYERED path (INSTR-2B-core; MASTER_LAWFIRM_ENABLED ON): the master text to layer ON TOP of
   * the matter-state block + the per-call role/subject-scope prompt (D-4), with the per-PA
   * instruction profile SUPPRESSED (D-5). null on the blob/legacy paths.
   */
  layeredMasterText: string | null;
  /** The composed asset's manifest SHA-256; null on the legacy path. */
  assetSha256: string | null;
  /** True iff a composition flag (MASTER_LAWFIRM_ENABLED or PROMPT_COMPOSITION_ENABLED) was on at decision time (snapshotted). */
  flagEnabled: boolean;
}

/**
 * Exact-match T&E test against the attorney-confirmed paKey or the freeform practiceArea.
 * Exported so CHAT-INJ-1 reuses the SAME representational lawfirm-vs-te selection (never title)
 * for chat injection, rather than re-deriving it.
 */
export function matchesTE(matter: AssemblePromptMatter): boolean {
  return (
    (matter.paKey !== null && TE_PRACTICE_AREA_EXACT_MATCHES.has(matter.paKey)) ||
    (matter.practiceArea !== null && TE_PRACTICE_AREA_EXACT_MATCHES.has(matter.practiceArea))
  );
}

export function assemblePrompt(args: {
  matter: AssemblePromptMatter | null;
  docType: string | null; // carried for snapshots + subject-scope; not consulted in the decision
  callRole: PromptCallRole;
  model: string; // "provider:model"
}): AssembledPrompt {
  const masterLawfirm = isMasterLawfirmEnabled();
  const promptComposition = isPromptCompositionEnabled();
  const flagEnabled = masterLawfirm || promptComposition;
  const legacy: AssembledPrompt = {
    source: 'legacy',
    systemText: null,
    layeredMasterText: null,
    assetSha256: null,
    flagEnabled,
  };

  if (!flagEnabled) return legacy;
  // INSTR-2C R1 — allowlist firewall: a non-allowlisted callRole can never compose. (This pure
  // function composes only draft/regenerate; outline is composed by the async resolver in
  // resolvePromptComposition. reviewer/evaluator/analysis/matrix/extract/format/other -> legacy here.)
  if (!MASTER_COMPOSABLE_CALLROLES.has(args.callRole)) return legacy;
  // Shared guard: only the Anthropic drafter ever composes a Claude master (an operator override
  // of PRIMARY_DRAFTER_MODEL to a non-Anthropic model disables composition rather than sending a
  // Claude master elsewhere).
  if (args.model !== PRIMARY_DRAFTER_MODEL) return legacy;
  if (parseModelString(args.model).providerId !== 'anthropic') return legacy;

  const matter = args.matter;

  // INSTR-2B-core: drafting (generate OR regenerate) master selection, LAYERED. Takes precedence
  // over the INSTR-1A0 blob path when MASTER_LAWFIRM_ENABLED is on.
  if (masterLawfirm) {
    if (args.callRole !== 'draft' && args.callRole !== 'regenerate') return legacy;
    if (matter === null) return legacy; // fail-closed: no matter row -> no master
    // INSTR-2B-title: the Title (settlement-agent) master is reachable ONLY through an affirmative
    // engagement-capacity election, and it takes precedence over the practice-area routing — a
    // settlement-agent matter never gets the TE or Law Firm master. The dangerous direction (a
    // client matter getting the title posture) is structurally impossible without this explicit
    // election; every other value (incl. the 'law_firm' default) falls through to the 2B-core
    // safe default below. NEVER from paKey alone.
    let id: MasterSource;
    if (matter.engagementCapacity === 'title_settlement_agent') {
      id = MASTER_CLAUDE_TITLE;
    } else {
      // Safe default (D-3): exact-match T&E keys -> the TE master; anything else -> the general
      // Law Firm master.
      id = matchesTE(matter) ? MASTER_CLAUDE_TE : MASTER_CLAUDE_LAWFIRM;
    }
    const asset = getPromptAsset(id);
    return { source: id, systemText: null, layeredMasterText: asset.text, assetSha256: asset.sha256, flagEnabled };
  }

  // INSTR-1A0 (MASTER_LAWFIRM_ENABLED OFF, PROMPT_COMPOSITION_ENABLED ON): the TE BLOB path,
  // draft-only, exact-match T&E only — byte-for-byte unchanged.
  if (args.callRole !== 'draft') return legacy;
  if (matter === null) return legacy;
  if (!matchesTE(matter)) return legacy;
  const asset = getPromptAsset(MASTER_CLAUDE_TE);
  return { source: MASTER_CLAUDE_TE, systemText: asset.text, layeredMasterText: null, assetSha256: asset.sha256, flagEnabled };
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
  ) => Promise<
    | {
        paKey?: string | null | undefined;
        practiceArea?: string | null | undefined;
        engagementCapacity?: string | null | undefined;
      }
    | null
    | undefined
  >;
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
  const masterLawfirm = isMasterLawfirmEnabled();
  const promptComposition = isPromptCompositionEnabled();
  const masterOutline = isMasterOutlineEnabled();
  // The zero-read guard considers ANY composition flag; the RECORDED flagEnabled (snapshotted on the
  // draft-only path) reflects the DRAFTING composition flags ONLY — MASTER_OUTLINE_ENABLED never composes
  // a draft, so it must not flip a draft job's snapshot flag_enabled (keeps the drafting A/B clean). The
  // outline branch records its own (masterOutline) below; outline itself is not snapshotted.
  const anyComposableFlag = masterLawfirm || promptComposition || masterOutline;
  const flagEnabled = masterLawfirm || promptComposition;
  const legacy: ResolvedComposition = {
    source: 'legacy',
    systemText: null,
    layeredMasterText: null,
    assetSha256: null,
    flagEnabled,
    callRole,
    docType: null,
  };

  // Cheap guards first — ZERO DB reads unless a composition flag is on AND this is an allowlisted,
  // Anthropic-drafter, matter-scoped, per-role-enabled path.
  if (!anyComposableFlag) return legacy;
  // INSTR-2C R1 — allowlist firewall: a non-allowlisted callRole can never compose, under any flag.
  // reviewer/evaluator (callRoles 'review'/'evaluator') + analysis/matrix/extract/format/other -> legacy.
  if (!MASTER_COMPOSABLE_CALLROLES.has(callRole)) return legacy;
  if (args.modelString !== PRIMARY_DRAFTER_MODEL) return legacy;
  if (parseModelString(args.modelString).providerId !== 'anthropic') return legacy;
  if (!args.matterId) return legacy;

  // INSTR-2C — the OUTLINE role: its OWN stricter predicate + the conflict-gate bind (async).
  if (callRole === 'outline') {
    if (!masterOutline) return legacy; // outline flag OFF -> legacy with ZERO further reads (R7)
    try {
      const readers = await getReaders();
      const matter = (await readers.getMatter(args.matterId, args.userId)) ?? null;
      const decision = await resolveOutlineMaster({
        matterId: args.matterId,
        userId: args.userId,
        matter,
      });
      if (!decision.inject) return legacy;
      return {
        source: decision.source,
        systemText: null,
        layeredMasterText: decision.layeredMasterText,
        assetSha256: decision.assetSha256,
        flagEnabled: masterOutline, // this composition was driven by the outline flag
        callRole,
        docType: null,
      };
    } catch {
      return legacy; // fail-closed
    }
  }

  // INSTR-2B / INSTR-1A0 — draft/regenerate. MASTER_OUTLINE_ENABLED alone NEVER enables these, so a
  // draft job with only the outline flag on is byte-for-byte legacy with ZERO reads.
  if (!masterLawfirm && !promptComposition) return legacy;
  const composableRole = masterLawfirm
    ? callRole === 'draft' || callRole === 'regenerate'
    : callRole === 'draft';
  if (!composableRole) return legacy;

  try {
    const readers = await getReaders();
    const matter = (await readers.getMatter(args.matterId, args.userId)) ?? null;
    const doc = args.documentId ? ((await readers.getDocument(args.documentId, args.userId)) ?? null) : null;
    const docType = doc?.documentType ?? null;
    const decision = assemblePrompt({
      matter: matter
        ? {
            paKey: matter.paKey ?? null,
            practiceArea: matter.practiceArea ?? null,
            engagementCapacity: matter.engagementCapacity ?? null,
          }
        : null,
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
