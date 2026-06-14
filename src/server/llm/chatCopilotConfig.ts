/**
 * CHAT-COPILOT-1 config — DOCUMENTED DEFAULTS, flagged for operator morning ratification.
 *
 * These are CONFIG (not hardcoded business rules), per the operator kickoff: retention policy +
 * the NPI default-withhold list are values the operator ratifies/adjusts to VA/MD file-retention
 * practice. Changing them is a config edit here, not a logic change.
 *
 * STATUS: DEFAULTS pending operator ratification (Part C of the v2 spec). The retention defaults gate
 * Inc 1/2 lifecycle; the NPI list gates Inc 3 grounding (defined here now so it is config from the
 * start — it is NOT consumed until the gated Inc 3).
 */
import type { ChatConversationRetentionClass } from '../../shared/schemas/chatCopilot.js';

export interface RetentionPolicy {
  class: ChatConversationRetentionClass;
  /** Retain N years after matter close (active_matter_plus_5y). null when not year-based. */
  postCloseYears: number | null;
  /** Fixed retention in days (short_30d). null when not day-based. */
  fixedDays: number | null;
  /** On matter close, export the full thread + citations to the matter file (defensibility asset). */
  exportOnClose: boolean;
}

/**
 * DEFAULT (Part C, flagged): active matter + 5 yrs post-closure; on close, export the full thread +
 * citations to the matter file; the attorney may delete at turn/conversation level any time.
 */
export const DEFAULT_RETENTION: RetentionPolicy = {
  class: 'active_matter_plus_5y',
  postCloseYears: 5,
  fixedDays: null,
  exportOnClose: true,
};

/**
 * Per-matter-type retention overrides (configurable). Empty by default → every matter type uses
 * DEFAULT_RETENTION. Keyed by a matter-type token (paKey / practice-area family). Operator ratifies.
 */
export const RETENTION_BY_MATTER_TYPE: Readonly<Record<string, RetentionPolicy>> = {};

export function resolveRetentionPolicy(matterType?: string | null): RetentionPolicy {
  if (matterType != null) {
    const override = RETENTION_BY_MATTER_TYPE[matterType];
    if (override) return override;
  }
  return DEFAULT_RETENTION;
}

/**
 * NPI default-withhold categories (Part C, flagged). The categories withheld by DEFAULT from GROUNDING
 * (Inc 3) unless the attorney AFFIRMATIVELY selects that material for that turn. Deterministic,
 * category-level "don't send by default" — the triad's ADOPTED control — NOT probabilistic NLP
 * redaction (which breeds false confidence). CONFIG, not hardcoded; consumed by the gated Inc 3.
 */
export const NPI_DEFAULT_WITHHELD_CATEGORIES = [
  'wire_instructions',
  'payoff_account_routing_numbers',
  'full_ssn_tin',
  'id_images',
  'trust_account_data',
  'estate_asset_schedules_with_account_numbers',
  'full_borrower_seller_npi',
] as const;
export type NpiWithheldCategory = (typeof NPI_DEFAULT_WITHHELD_CATEGORIES)[number];

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CHAT-COPILOT-1 Inc 3+4 — grounded-chat provider allowlist (FAIL-CLOSED) + dynamic budget
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Grounded-chat provider allowlist — SHIPS EMPTY (fail-closed). A grounded chat turn may send assembled
 * document/material context to a provider ONLY if that provider's id (e.g. 'anthropic') is on this list.
 *
 * EMPTY => grounding is INERT for EVERY provider: every grounded turn falls back to today's
 * matter-state-only behavior (no document/material text leaves the system). This is DISTINCT from the
 * general-chat path — general chat (no grounding) is unaffected by this list.
 *
 * DO NOT POPULATE THIS in code. Populating it is a LATER operator config step, taken ONLY after the
 * operator confirms WRITTEN no-train / no-human-review / bounded-retention (ZDR/enterprise) + DPA terms
 * for that provider (triad HALT precondition; ABA Op. 512 / VA Rule 1.6 / MD Rule 19-301.6). Until then,
 * grounded chat does not exist at runtime.
 */
export const GROUNDED_CHAT_PROVIDER_ALLOWLIST: readonly string[] = [];

// Test seam ONLY: the prod allowlist const above ships EMPTY and is never populated in code; tests set
// this override to exercise the grounded path, then reset to null. null (the prod default) => the empty
// const is used => grounding inert. This does NOT enable grounding in prod.
let _allowlistOverrideForTests: readonly string[] | null = null;
export function setGroundedChatProviderAllowlistForTests(list: readonly string[] | null): void {
  _allowlistOverrideForTests = list;
}

/** Fail-closed: is this provider id permitted to receive grounded (document/material) chat context? */
export function isGroundedChatProviderAllowed(providerId: string): boolean {
  return (_allowlistOverrideForTests ?? GROUNDED_CHAT_PROVIDER_ALLOWLIST).includes(providerId);
}

/**
 * Dynamic per-mode token budget for a grounded chat turn (NOT one fixed cap). Defaults are CONFIG,
 * flagged for operator ratification. 'review'/'analyze' pull more context; a default chat turn is leaner.
 * The operative document + pinned materials + locked/adopted decisions get their guaranteed slice first
 * (chatGrounding.assembleGroundedChatContext); this budget bounds the remaining recency-material slice.
 */
export const CHAT_TURN_BUDGET_BY_MODE: Readonly<Record<string, number>> = {
  default: 40_000,
  draft: 60_000,
  review: 60_000,
  analyze: 60_000,
  outline: 50_000,
};

export function chatTurnBudgetForMode(mode?: string | null): number {
  if (mode != null && CHAT_TURN_BUDGET_BY_MODE[mode] != null) return CHAT_TURN_BUDGET_BY_MODE[mode]!;
  return CHAT_TURN_BUDGET_BY_MODE['default']!;
}

/**
 * Deterministic, category-level NPI minimization (NOT probabilistic NLP redaction). A material is
 * withheld-by-default from grounding iff ANY of its tags matches a default-withheld NPI category. The
 * attorney can AFFIRMATIVELY select a withheld material for a turn (select-to-send), overriding this.
 */
export function materialTagsAreNpiWithheld(tags: readonly string[]): boolean {
  const withheld = new Set<string>(NPI_DEFAULT_WITHHELD_CATEGORIES);
  return tags.some((t) => withheld.has(t));
}
