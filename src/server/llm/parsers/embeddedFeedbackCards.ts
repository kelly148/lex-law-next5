/**
 * embeddedFeedbackCards — MR-CAL-4B
 *
 * Extracts the native feedback-card data that reviewers already emit, embedded as
 * a STRUCTURED_FEEDBACK_CARDS JSON array inside the legacy suggestion body
 * (see src/server/llm/prompts/reviewerPrompts.ts).
 *
 * This is the migration-free, display-only path for activating native feedback
 * cards: it derives native fields from data that already persists in the
 * feedback.suggestions JSON column. It does not change persistence, does not
 * modify the legacy suggestion shape, and never throws — a missing or malformed
 * STRUCTURED_FEEDBACK_CARDS block simply yields no native cards and the legacy
 * rendering remains.
 *
 * The brace-aware scanner is promoted from the parseEmbeddedCards helper proven in
 * mr_cal_2d_calibration_scoring.test.ts.
 */

import {
  FeedbackCardDisplaySchema,
  hasDisplayableNativeFields,
  type FeedbackCardDisplay,
} from '../../../shared/schemas/feedbackCards.js';

const MARKER = 'STRUCTURED_FEEDBACK_CARDS';

/**
 * Locate the first top-level JSON array following the STRUCTURED_FEEDBACK_CARDS
 * marker and return its raw text, or null if absent/unbalanced. Brace-aware and
 * string-aware so embedded brackets inside string values do not end the scan.
 */
function sliceEmbeddedCardArray(body: string): string | null {
  const markerIndex = body.indexOf(MARKER);
  if (markerIndex < 0) return null;

  const afterMarker = body.slice(markerIndex + MARKER.length);
  const start = afterMarker.indexOf('[');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < afterMarker.length; i += 1) {
    const ch = afterMarker[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return afterMarker.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Extract displayable native feedback cards embedded in a legacy suggestion body.
 *
 * @param body - The legacy suggestion body (may contain a NARRATIVE_REVIEWER_MEMO
 *               section and a STRUCTURED_FEEDBACK_CARDS JSON array).
 * @returns Array of lenient display cards carrying at least one meaningful native
 *          field. Empty when no parseable, displayable native cards are present.
 *          Never throws.
 */
export function extractEmbeddedFeedbackCards(body: string): FeedbackCardDisplay[] {
  if (typeof body !== 'string' || body.length === 0) return [];

  const raw = sliceEmbeddedCardArray(body);
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const cards: FeedbackCardDisplay[] = [];
  for (const item of parsed) {
    const result = FeedbackCardDisplaySchema.safeParse(item);
    if (result.success && hasDisplayableNativeFields(result.data)) {
      cards.push(result.data);
    }
  }
  return cards;
}
