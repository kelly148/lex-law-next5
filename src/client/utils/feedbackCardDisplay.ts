/**
 * feedbackCardDisplay — LLN-FEEDBACK-CARD-UX-1
 *
 * Display-only helpers for rendering reviewer feedback cleanly in ReviewPane.
 *
 * Reviewer suggestion bodies historically carry a human-readable
 * NARRATIVE_REVIEWER_MEMO prose section followed by a raw STRUCTURED_FEEDBACK_CARDS
 * JSON blob. The JSON blob is internal plumbing (parsed separately into native
 * cards) and must never be shown to the attorney. These helpers produce the clean
 * pieces for display; they never throw and degrade gracefully on legacy/odd input.
 */

const NARRATIVE_LABEL = 'NARRATIVE_REVIEWER_MEMO';
const CARDS_MARKER = 'STRUCTURED_FEEDBACK_CARDS';

/**
 * Return only the human-readable narrative prose from a legacy suggestion body:
 * drop everything from the STRUCTURED_FEEDBACK_CARDS marker onward (the raw JSON),
 * and strip a leading NARRATIVE_REVIEWER_MEMO label. Returns '' for empty/non-string
 * input. If no markers are present, returns the trimmed body unchanged (legacy-safe).
 */
export function stripEmbeddedCardsJson(body: string): string {
  if (typeof body !== 'string' || body.length === 0) return '';
  let text = body;
  const markerIdx = text.indexOf(CARDS_MARKER);
  if (markerIdx >= 0) text = text.slice(0, markerIdx);
  text = text.replace(new RegExp('^\\s*' + NARRATIVE_LABEL + '\\s*:?\\s*'), '');
  return text.trim();
}

/**
 * Split a multi-path "Path 1 … Path 2 …" suggested revision into discrete items for
 * itemized (bulleted) display. Returns a single-item array when no multi-path
 * structure is detected, and [] for empty/non-string input. Never throws.
 */
export function splitSuggestedRevisionPaths(text: string): string[] {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const trimmed = text.trim();
  const matches = trimmed.match(/Path\s+\d+/g);
  if (!matches || matches.length < 2) return [trimmed];
  const parts = trimmed
    .split(/(?=Path\s+\d+)/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [trimmed];
}
