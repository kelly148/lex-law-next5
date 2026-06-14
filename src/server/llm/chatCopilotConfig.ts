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
