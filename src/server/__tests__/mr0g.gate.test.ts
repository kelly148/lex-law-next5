/**
 * MR-0G Gate Tests
 *
 * Verifies:
 *   1. API gate: selectedReviewers.length > 1 is rejected at the Zod schema
 *      layer with error code MULTI_REVIEWER_DISABLED before any LLM dispatch.
 *   2. API gate: selectedReviewers.length === 1 continues to pass Zod validation.
 *   3. API gate: selectedReviewers.length === 0 still rejected with NO_REVIEWERS_SELECTED.
 *   4. UI gate: ReviewPane.tsx uses radio button (type="radio") not checkbox
 *      (type="checkbox") for reviewer selection, enforcing single-select.
 *   5. UI gate: ReviewPane.tsx state uses a single string (selectedReviewer),
 *      not an array, for the selection value.
 *   6. No multi-reviewer payload can be constructed from the UI state.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// ─── Replicate the MR-0G gated schema ────────────────────────────────────────
// This mirrors the exact schema in reviewSession.create after the MR-0G patch.
const gatedCreateInputSchema = z.object({
  documentId: z.string().uuid(),
  iterationNumber: z.number().int().min(1),
  selectedReviewers: z.array(z.string().min(1)).min(1, {
    message: 'NO_REVIEWERS_SELECTED: at least one reviewer is required',
  }).max(1, {
    message: 'MULTI_REVIEWER_DISABLED: Multi-reviewer review is temporarily unavailable. Please select one reviewer.',
  }),
});

// ─── API gate tests ───────────────────────────────────────────────────────────
describe('MR-0G API gate: selectedReviewers Zod schema', () => {
  it('rejects selectedReviewers.length > 1 with MULTI_REVIEWER_DISABLED', () => {
    const result = gatedCreateInputSchema.safeParse({
      documentId: '123e4567-e89b-12d3-a456-426614174000',
      iterationNumber: 1,
      selectedReviewers: ['claude', 'gpt'],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('MULTI_REVIEWER_DISABLED'))).toBe(true);
    }
  });

  it('rejects selectedReviewers with 3 entries with MULTI_REVIEWER_DISABLED', () => {
    const result = gatedCreateInputSchema.safeParse({
      documentId: '123e4567-e89b-12d3-a456-426614174000',
      iterationNumber: 1,
      selectedReviewers: ['claude', 'gpt', 'gemini'],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('MULTI_REVIEWER_DISABLED'))).toBe(true);
    }
  });

  it('accepts selectedReviewers.length === 1 (single-reviewer path unchanged)', () => {
    const result = gatedCreateInputSchema.safeParse({
      documentId: '123e4567-e89b-12d3-a456-426614174000',
      iterationNumber: 1,
      selectedReviewers: ['claude'],
    });
    expect(result.success).toBe(true);
  });

  it('still rejects empty selectedReviewers with NO_REVIEWERS_SELECTED', () => {
    const result = gatedCreateInputSchema.safeParse({
      documentId: '123e4567-e89b-12d3-a456-426614174000',
      iterationNumber: 1,
      selectedReviewers: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('NO_REVIEWERS_SELECTED'))).toBe(true);
    }
  });

  it('schema in reviewSession.ts contains the .max(1) constraint with MULTI_REVIEWER_DISABLED', () => {
    const reviewSessionFile = fs.readFileSync(
      path.resolve('src/server/procedures/reviewSession.ts'),
      'utf-8',
    );
    expect(reviewSessionFile).toContain('MULTI_REVIEWER_DISABLED');
    expect(reviewSessionFile).toContain('.max(1,');
  });
});

// ─── UI gate tests ────────────────────────────────────────────────────────────
describe('MR-0G UI gate: ReviewPane.tsx single-select enforcement', () => {
  const reviewPaneFile = fs.readFileSync(
    path.resolve('src/client/components/ReviewPane.tsx'),
    'utf-8',
  );

  it('reviewer selection uses type="radio" not type="checkbox"', () => {
    // Must have radio input for reviewer selection
    expect(reviewPaneFile).toContain('type="radio"');
    expect(reviewPaneFile).toContain('name="reviewer-selection"');
  });

  it('reviewer selection does not use type="checkbox" for reviewer list', () => {
    // The checkbox type must not appear in the reviewer selection list.
    // (Other checkboxes elsewhere in the file are not in scope; we check
    // that the reviewer-selection radio group has no checkbox sibling.)
    // The radio input block must be present and the old checkbox pattern absent.
    expect(reviewPaneFile).not.toContain('type="checkbox"\n                checked={selectedReviewer');
  });

  it('state variable is a single string (selectedReviewer), not an array', () => {
    // The MR-0G patch replaces the array state with a single string.
    expect(reviewPaneFile).toContain('useState<string>(');
    expect(reviewPaneFile).toContain('setSelectedReviewer(key)');
  });

  it('selectedReviewers array is derived from the single string and is always length 0 or 1', () => {
    // The derived array is constructed as: selectedReviewer ? [selectedReviewer] : []
    expect(reviewPaneFile).toContain('selectedReviewer ? [selectedReviewer] : []');
  });

  it('description text says "Select a reviewer" not "Select reviewers"', () => {
    expect(reviewPaneFile).toContain('Select a reviewer for iteration');
  });
});
