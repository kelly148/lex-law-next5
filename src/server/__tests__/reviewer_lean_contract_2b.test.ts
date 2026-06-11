/**
 * REVIEWER-LATENCY-1 Step 2b — reviewer output-contract diet (single-render), flag-gated.
 *
 * Guards, in the 2a / INSTR-1A0 golden-test spirit:
 *   - Flag OFF (default): reviewer prompt is byte-identical to today — the
 *     NARRATIVE_REVIEWER_MEMO + full 25-field STRUCTURED_FEEDBACK_CARDS contract.
 *   - Flag ON: a single lean card, no prose memo, exactly the lean field set
 *     (no dropped fields), governing_law present; calibration behaviors preserved.
 *   - The card-first display path parses a lean card incl. governing_law.
 *   - tokensReasoning is now exposed by JobRowSchema + PublicJobSchema (always-on,
 *     not flag-gated) so reasoning_fraction is computable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildReviewerSystemPrompt,
  FEEDBACK_CARD_FIELD_NAMES,
  FEEDBACK_CARD_FIELD_NAMES_LEAN,
  REVIEWER_TRACK_KEYS,
} from '../llm/prompts/reviewerPrompts.js';
import { extractEmbeddedFeedbackCards } from '../llm/parsers/embeddedFeedbackCards.js';
import { FeedbackCardDisplaySchema } from '../../shared/schemas/feedbackCards.js';
import { JobRowSchema, PublicJobSchema } from '../../shared/schemas/jobs.js';

// Fields the reviewer is told to STOP emitting under the lean contract (runtime/
// evaluator-owned, or Step-0-inert). None may appear anywhere in the flag-ON prompt.
const DROPPED_FIELDS = [
  'NARRATIVE_REVIEWER_MEMO',
  'severity_subtype',
  'routine_blank_flag',
  'suppress_by_default',
  'persistence_count',
  'persistence_chain',
  'evaluator_disposition',
  'evaluator_rationale',
  'future_memory_instruction',
  'regeneration_instructions',
  'feedback_id',
  'review_cycle_id',
  'reviewer_track',
  'target_document',
] as const;

// Calibration behaviors that MUST survive the diet (expressed without the dropped field names).
const PRESERVED_BEHAVIORS = [
  'five-tier severity taxonomy',
  'Execution-blanks suppression',
  'do not flag ordinary signature, date, witness, or notary blanks on pre-execution drafts',
  'never make business decisions for the attorney',
  'surface options and do not choose the business path for the attorney',
  'requires_attorney_decision',
  'locked decisions',
  'STRUCTURED_FEEDBACK_CARDS',
] as const;

describe('REVIEWER-LATENCY-1 Step 2b — flag OFF is byte-identical to today', () => {
  beforeAll(() => {
    delete process.env['REVIEWER_LEAN_CONTRACT_ENABLED'];
  });

  it('default (no flag) equals the explicit legacy build for every track', () => {
    for (const key of REVIEWER_TRACK_KEYS) {
      expect(buildReviewerSystemPrompt(key)).toBe(buildReviewerSystemPrompt(key, false));
    }
  });

  it('legacy prompt keeps the prose memo and every legacy field name (incl. the dropped ones)', () => {
    for (const key of REVIEWER_TRACK_KEYS) {
      const off = buildReviewerSystemPrompt(key, false);
      expect(off).toContain('NARRATIVE_REVIEWER_MEMO');
      expect(off).toContain('attorney-readable reviewer memo');
      for (const field of FEEDBACK_CARD_FIELD_NAMES) {
        expect(off).toContain(field);
      }
      // Legacy still carries the field-named execution-blank + persistence instructions.
      expect(off).toContain('routine_blank_flag true');
      expect(off).toContain('suppress_by_default true');
    }
  });
});

describe('REVIEWER-LATENCY-1 Step 2b — flag ON emits the lean single-render contract', () => {
  it('drops the prose memo and every dropped field name, in every track', () => {
    for (const key of REVIEWER_TRACK_KEYS) {
      const on = buildReviewerSystemPrompt(key, true);
      for (const dropped of DROPPED_FIELDS) {
        expect(on).not.toContain(dropped);
      }
    }
  });

  it('emits exactly the lean field set plus governing_law and a single card', () => {
    for (const key of REVIEWER_TRACK_KEYS) {
      const on = buildReviewerSystemPrompt(key, true);
      for (const field of FEEDBACK_CARD_FIELD_NAMES_LEAN) {
        expect(on).toContain(field);
      }
      expect(on).toContain('governing_law');
      expect(on).toContain('STRUCTURED_FEEDBACK_CARDS');
      expect(on).toContain('EXACTLY ONE feedback-card object');
    }
  });

  it('preserves the calibration behaviors without the dropped field names', () => {
    for (const key of REVIEWER_TRACK_KEYS) {
      const on = buildReviewerSystemPrompt(key, true);
      for (const behavior of PRESERVED_BEHAVIORS) {
        expect(on).toContain(behavior);
      }
    }
  });
});

describe('REVIEWER-LATENCY-1 Step 2b — display path parses a lean card incl. governing_law', () => {
  const leanCard = {
    severity: 'BLOCKER',
    critique_type: 'audience',
    target_section: 'Governing Law',
    issue: 'Draft names Virginia but the deal is Maryland.',
    source_basis: 'Matter context: MD property.',
    governing_law: 'Maryland controls; Virginia distinction noted.',
    source_of_truth_tier: 9,
    recommendation: 'Correct the governing-law clause to Maryland.',
    suggested_revision: 'This Agreement is governed by the laws of Maryland.',
    requires_attorney_decision: true,
    audience_affected: ['attorney'],
    confidence: 0.9,
    disposition_options: ['adopt', 'modify'],
  };

  it('FeedbackCardDisplaySchema accepts the lean card and retains governing_law', () => {
    const parsed = FeedbackCardDisplaySchema.safeParse(leanCard);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.governing_law).toBe('Maryland controls; Virginia distinction noted.');
      expect(parsed.data.issue).toBe('Draft names Virginia but the deal is Maryland.');
    }
  });

  it('extractEmbeddedFeedbackCards parses a lean one-card STRUCTURED_FEEDBACK_CARDS array', () => {
    const body = `STRUCTURED_FEEDBACK_CARDS ${JSON.stringify([leanCard])}`;
    const cards = extractEmbeddedFeedbackCards(body);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.governing_law).toBe('Maryland controls; Virginia distinction noted.');
    expect(cards[0]?.severity).toBe('BLOCKER');
  });
});

describe('REVIEWER-LATENCY-1 Step 2b — tokensReasoning exposed; reasoning_fraction computable', () => {
  it('JobRowSchema and PublicJobSchema both carry tokensReasoning', () => {
    expect(JobRowSchema.shape).toHaveProperty('tokensReasoning');
    expect(PublicJobSchema.shape).toHaveProperty('tokensReasoning');
  });

  it('PublicJobSchema retains tokensReasoning and reasoning_fraction is computable', () => {
    const now = new Date();
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      matterId: null,
      documentId: null,
      jobType: 'reviewer_feedback',
      providerId: 'openai',
      modelId: 'gpt-5',
      promptVersion: 'v1',
      status: 'completed',
      queuedAt: now,
      startedAt: null,
      completedAt: null,
      lastHeartbeatAt: null,
      errorClass: null,
      errorMessage: null,
      tokensPrompt: 1000,
      tokensCompletion: 5000,
      tokensReasoning: 2000,
      createdAt: now,
      updatedAt: now,
    };
    const parsed = PublicJobSchema.parse(row);
    expect(parsed.tokensReasoning).toBe(2000);
    const reasoningFraction = parsed.tokensReasoning! / parsed.tokensCompletion!;
    expect(reasoningFraction).toBeCloseTo(0.4);
  });

  it('tokensReasoning tolerates NULL (not reported for this provider/model)', () => {
    const now = new Date();
    const parsed = PublicJobSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      matterId: null,
      documentId: null,
      jobType: 'reviewer_feedback',
      providerId: 'anthropic',
      modelId: 'claude-opus-4-5',
      promptVersion: 'v1',
      status: 'completed',
      queuedAt: now,
      startedAt: null,
      completedAt: null,
      lastHeartbeatAt: null,
      errorClass: null,
      errorMessage: null,
      tokensPrompt: 1000,
      tokensCompletion: 5000,
      tokensReasoning: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(parsed.tokensReasoning).toBeNull();
  });
});

describe('REVIEWER-LATENCY-1 Step 2b — ReviewPane surfaces governing_law', () => {
  let reviewPaneSrc = '';
  beforeAll(() => {
    const repoRoot = path.resolve(__dirname, '../../..');
    reviewPaneSrc = fs.readFileSync(
      path.join(repoRoot, 'src/client/components/ReviewPane.tsx'),
      'utf8',
    );
  });

  it('renders a Governing law row driven by card0.governing_law', () => {
    expect(reviewPaneSrc).toContain('governing_law');
    expect(reviewPaneSrc).toContain('Governing law');
  });
});
