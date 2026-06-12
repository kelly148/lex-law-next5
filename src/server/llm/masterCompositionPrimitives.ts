/**
 * masterCompositionPrimitives.ts — INSTR-2C (R9): shared, role-agnostic primitives for firm-master
 * composition. PURE functions only (no flags, no DB, no I/O).
 *
 * R9 — per-role selector discipline: these are the SHARED building blocks (title-defer, representational
 * capacity, te-vs-lawfirm selection). Each role wraps them in its OWN stricter predicate with its own
 * tests (drafting in assemblePrompt; outline in outlineMasterComposition). There is deliberately NO
 * monolithic shared selector that could permit accidental role expansion — a role can only compose a
 * master by writing its own predicate over these primitives AND being added to the R1 allowlist.
 *
 * NOTE: CHAT-INJ-1's chatMasterComposition predates this library and carries its own copy of the
 * title-signal primitive. Consolidating that copy is OUT OF SCOPE for INSTR-2C ("no change to chat
 * injection") and is left as a future, behavior-preserving cleanup.
 */

import { matchesTE } from './assemblePrompt.js';
import { MASTER_CLAUDE_TE, MASTER_CLAUDE_LAWFIRM } from './promptAssets.js';

/** The matter fields a representational-composition predicate needs (a read-only subset of MatterRow). */
export interface CompositionMatter {
  engagementCapacity?: string | null | undefined;
  paKey?: string | null | undefined;
  practiceArea?: string | null | undefined;
}

/** The two representational masters a non-title composition may select. NEVER the Title master. */
export type RepresentationalMaster = typeof MASTER_CLAUDE_TE | typeof MASTER_CLAUDE_LAWFIRM;

/**
 * A title/settlement signal in the practice area. CONSERVATIVE / over-inclusive on purpose: a false
 * "title signal" -> neutral is the SAFE direction (fail-closed); the dangerous direction guarded is a
 * title/settlement matter silently receiving the representational (counsel) master.
 */
export function hasTitleSignal(matter: CompositionMatter): boolean {
  const TITLE_TOKENS = ['title', 'settlement', 'escrow'];
  const haystack = `${matter.paKey ?? ''} ${matter.practiceArea ?? ''}`.toLowerCase();
  return TITLE_TOKENS.some((t) => haystack.includes(t));
}

/**
 * Is the matter the EXPLICIT representational law_firm seat? `engagementCapacity` is NOT NULL DEFAULT
 * 'law_firm', so a bare default is indistinguishable from an affirmative election — capacity ALONE is
 * therefore NEVER sufficient to inject; the affirmative representational signal is the cleared conflict
 * gate (which the caller binds). This primitive only confirms the seat is representational (law_firm) —
 * not the title/settlement seat, and not a missing/unknown/ambiguous value.
 */
export function isRepresentationalLawFirmCapacity(capacity: string | null | undefined): boolean {
  return capacity === 'law_firm';
}

/**
 * Select the representational master (te vs lawfirm) for a non-title matter, reusing the INSTR-2
 * exact-match T&E predicate. NEVER returns the Title master.
 */
export function selectRepresentationalMaster(matter: CompositionMatter): RepresentationalMaster {
  return matchesTE({ paKey: matter.paKey ?? null, practiceArea: matter.practiceArea ?? null })
    ? MASTER_CLAUDE_TE
    : MASTER_CLAUDE_LAWFIRM;
}
