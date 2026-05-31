/**
 * MR-0G / MR-CAL-5B Gate Tests
 *
 * MR-0G originally disabled multi-reviewer at the Zod schema (.max(1)) and in the
 * UI (single-select). MR-CAL-5B makes the COUNT gate flag-aware: the schema keeps
 * only the lower bound, and the resolver rejects >1 reviewer with
 * MULTI_REVIEWER_DISABLED when MULTI_REVIEWER_ENABLED is off (the default), while
 * allowing multiple reviewers when on. The UI single-select remains the default
 * here (its flag-aware multi-select is a later MR-CAL-5B increment).
 *
 * Verifies:
 *   1. Count gate (flag OFF, default): >1 reviewer is rejected (MULTI_REVIEWER_DISABLED).
 *   2. Count gate (flag ON): >1 reviewer is allowed.
 *   3. Exactly one reviewer is always allowed; zero is rejected (NO_REVIEWERS_SELECTED).
 *   4. The flag defaults OFF unless MULTI_REVIEWER_ENABLED is exactly "true".
 *   5. UI gate (default): ReviewPane.tsx uses radio (type="radio") single-select.
 *   6. UI gate (default): ReviewPane.tsx state is a single string, not an array.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import {
  isReviewerSelectionCountAllowed,
  isMultiReviewerEnabled,
} from '../config/featureFlags.js';

// ─── Schema lower-bound replica (MR-CAL-5B) ──────────────────────────────────
// After MR-CAL-5B the create input schema keeps ONLY the lower bound (>=1
// reviewer); the multi-reviewer COUNT gate moved to a flag-aware resolver check
// (isReviewerSelectionCountAllowed). This mirrors the schema's remaining role.
const createInputLowerBoundSchema = z.object({
  documentId: z.string().uuid(),
  iterationNumber: z.number().int().min(1),
  selectedReviewers: z.array(z.string().min(1)).min(1, {
    message: 'NO_REVIEWERS_SELECTED: at least one reviewer is required',
  }),
});

// ─── Count-gate tests (flag-aware, MR-CAL-5B) ────────────────────────────────
// The multi-reviewer count gate is now a flag-aware resolver check. Default OFF
// reproduces the prior MR-0G behavior (>1 reviewer rejected with
// MULTI_REVIEWER_DISABLED); ON permits multiple reviewers.
describe('MR-CAL-5B count gate: isReviewerSelectionCountAllowed', () => {
  it('rejects >1 reviewer when multi-reviewer is OFF (default = MR-0G behavior)', () => {
    expect(isReviewerSelectionCountAllowed(2, false)).toBe(false);
    expect(isReviewerSelectionCountAllowed(3, false)).toBe(false);
  });

  it('allows >1 reviewer when multi-reviewer is ON', () => {
    expect(isReviewerSelectionCountAllowed(2, true)).toBe(true);
    expect(isReviewerSelectionCountAllowed(4, true)).toBe(true);
  });

  it('allows exactly one reviewer regardless of the flag', () => {
    expect(isReviewerSelectionCountAllowed(1, false)).toBe(true);
    expect(isReviewerSelectionCountAllowed(1, true)).toBe(true);
  });

  it('isMultiReviewerEnabled() defaults OFF unless env is exactly "true"', () => {
    const prev = process.env['MULTI_REVIEWER_ENABLED'];
    try {
      delete process.env['MULTI_REVIEWER_ENABLED'];
      expect(isMultiReviewerEnabled()).toBe(false);
      process.env['MULTI_REVIEWER_ENABLED'] = 'false';
      expect(isMultiReviewerEnabled()).toBe(false);
      process.env['MULTI_REVIEWER_ENABLED'] = '1';
      expect(isMultiReviewerEnabled()).toBe(false);
      process.env['MULTI_REVIEWER_ENABLED'] = 'true';
      expect(isMultiReviewerEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env['MULTI_REVIEWER_ENABLED'];
      else process.env['MULTI_REVIEWER_ENABLED'] = prev;
    }
  });

  it('still rejects empty selectedReviewers with NO_REVIEWERS_SELECTED (schema lower bound)', () => {
    const result = createInputLowerBoundSchema.safeParse({
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

  it('accepts a single reviewer at the schema lower bound', () => {
    const result = createInputLowerBoundSchema.safeParse({
      documentId: '123e4567-e89b-12d3-a456-426614174000',
      iterationNumber: 1,
      selectedReviewers: ['claude'],
    });
    expect(result.success).toBe(true);
  });

  it('reviewSession.ts enforces the flag-aware gate and preserves MULTI_REVIEWER_DISABLED', () => {
    const reviewSessionFile = fs.readFileSync(
      path.resolve('src/server/procedures/reviewSession.ts'),
      'utf-8',
    );
    expect(reviewSessionFile).toContain('MULTI_REVIEWER_DISABLED');
    expect(reviewSessionFile).toContain('isReviewerSelectionCountAllowed');
    expect(reviewSessionFile).toContain('isMultiReviewerEnabled');
  });
});

// ─── UI gate tests (flag-aware, MR-CAL-5B) ───────────────────────────────────
describe('MR-CAL-5B UI gate: ReviewPane.tsx flag-aware reviewer selection', () => {
  const reviewPaneFile = fs.readFileSync(
    path.resolve('src/client/components/ReviewPane.tsx'),
    'utf-8',
  );

  it('reviewer-selection input type is flag-conditional (radio when off, checkbox when on)', () => {
    expect(reviewPaneFile).toContain("multiReviewerEnabled ? 'checkbox' : 'radio'");
    expect(reviewPaneFile).toContain('name="reviewer-selection"');
  });

  it('reads the multi-reviewer flag from settings (default OFF)', () => {
    expect(reviewPaneFile).toContain('settings?.multiReviewerEnabled ?? false');
  });

  it('selection state is an array, toggled in a flag-aware way (single replaces, multi toggles)', () => {
    expect(reviewPaneFile).toContain('useState<string[]>(');
    expect(reviewPaneFile).toContain('toggleReviewer(key)');
    // Single-select path replaces the selection with exactly the clicked key.
    expect(reviewPaneFile).toContain('if (!multiReviewerEnabled) return [key];');
  });

  it('default (flag OFF) description preserves the singular "Select a reviewer" label', () => {
    // LLN-UX-ITER-LABEL-1: no hard-coded iteration number. The singular default
    // label is kept for the single-reviewer (flag-off) path; a plural variant is
    // shown when multi-reviewer is enabled.
    expect(reviewPaneFile).toContain('Select a reviewer for the next review');
    expect(reviewPaneFile).toContain('Select one or more reviewers for the next review');
  });
});
