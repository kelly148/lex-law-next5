import { describe, expect, it } from 'vitest';

import {
  feedbackCardToLegacySuggestion,
  legacySuggestionToFeedbackCard,
  FeedbackCardSchema,
} from '../../shared/schemas/feedbackCards.js';
import {
  parseFeedbackCardOutput,
  parseFeedbackOutput,
} from '../llm/parsers/feedbackParser.js';

const validFeedbackCard = {
  feedback_id: 'FC-001',
  review_cycle_id: 'RC-2026-05-26-001',
  reviewer_track: 'Claude',
  severity: 'SUBSTANTIVE',
  severity_subtype: 'DRAFTING',
  critique_type: 'audience_shift_recommendation',
  target_document: 'Counterparty letter v2',
  target_section: 'Opening paragraph',
  issue: 'Draft over-discloses internal legal reasoning to the counterparty.',
  source_basis: 'Matter context records the substantive position as locked.',
  source_of_truth_tier: 4,
  recommendation: 'Remove the internal reasoning while preserving the offer.',
  suggested_revision: 'We maintain our position and offer the 50/50 split described below.',
  requires_attorney_decision: true,
  suppress_by_default: false,
  routine_blank_flag: false,
  audience_affected: ['counterparty', 'opposing_counsel'],
  confidence: 0.86,
  disposition_options: ['adopt', 'modify', 'pass'],
  future_memory_instruction:
    'Counterparty letters in this matter should preserve substance and remove internal reasoning.',
  persistence_count: 0,
  persistence_chain: [],
  evaluator_disposition: null,
  evaluator_rationale: null,
  regeneration_instructions: null,
} as const;

describe('MR-CAL-1 target feedback-card contract', () => {
  it('accepts the canonical target feedback-card fields and controlled vocabulary', () => {
    const result = FeedbackCardSchema.parse(validFeedbackCard);

    expect(result.feedback_id).toBe('FC-001');
    expect(result.severity).toBe('SUBSTANTIVE');
    expect(result.severity_subtype).toBe('DRAFTING');
    expect(result.critique_type).toBe('audience_shift_recommendation');
    expect(result.source_of_truth_tier).toBe(4);
  });

  it('rejects SUBSTANTIVE cards without a required drafting/business subtype', () => {
    const invalid = { ...validFeedbackCard, severity_subtype: null };

    expect(() => FeedbackCardSchema.parse(invalid)).toThrow(/severity_subtype/);
  });

  it('rejects non-SUBSTANTIVE cards that carry a substantive subtype', () => {
    const invalid = {
      ...validFeedbackCard,
      severity: 'POLISH',
      severity_subtype: 'DRAFTING',
      critique_type: 'stylistic',
    };

    expect(() => FeedbackCardSchema.parse(invalid)).toThrow(/severity_subtype/);
  });

  it('rejects unknown severity, critique type, disposition, and source tier values', () => {
    expect(() => FeedbackCardSchema.parse({ ...validFeedbackCard, severity: 'urgent' })).toThrow();
    expect(() =>
      FeedbackCardSchema.parse({ ...validFeedbackCard, critique_type: 'business_strategy' }),
    ).toThrow();
    expect(() =>
      FeedbackCardSchema.parse({ ...validFeedbackCard, disposition_options: ['approve'] }),
    ).toThrow();
    expect(() => FeedbackCardSchema.parse({ ...validFeedbackCard, source_of_truth_tier: 10 })).toThrow();
  });
});

describe('MR-CAL-1 feedback-card parser bridge', () => {
  it('parses target feedback-card JSON arrays without UUID restamping', () => {
    const parsed = parseFeedbackCardOutput(JSON.stringify([validFeedbackCard]));

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      feedback_id: 'FC-001',
      review_cycle_id: 'RC-2026-05-26-001',
      reviewer_track: 'Claude',
    });
  });

  it('fails loud when target feedback-card output is malformed', () => {
    const malformed = JSON.stringify([
      {
        feedback_id: 'FC-001',
        issue: 'Missing all other required fields',
      },
    ]);

    expect(() => parseFeedbackCardOutput(malformed)).toThrow('REVIEWER_OUTPUT_MALFORMED');
  });

  it('preserves the legacy parser path and UUID-stamped suggestion shape', () => {
    const legacy = parseFeedbackOutput(
      JSON.stringify([{ title: 'Legacy issue', body: 'Legacy body', severity: 'minor' }]),
    );

    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toMatchObject({
      title: 'Legacy issue',
      body: 'Legacy body',
      severity: 'minor',
    });
    expect(legacy[0]?.suggestionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('converts between legacy suggestions and target feedback cards through explicit compatibility helpers', () => {
    const card = legacySuggestionToFeedbackCard({
      suggestion: {
        suggestionId: 'legacy-1',
        title: 'Clarify notice timing',
        body: 'Clarify when the notice period begins to run.',
        severity: 'major',
      },
      reviewCycleId: 'RC-legacy-1',
      reviewerTrack: 'GPT',
      targetDocument: 'Lease amendment',
      targetSection: 'Notice section',
    });

    expect(card).toMatchObject({
      feedback_id: 'legacy-1',
      review_cycle_id: 'RC-legacy-1',
      reviewer_track: 'GPT',
      severity: 'SUBSTANTIVE',
      severity_subtype: 'DRAFTING',
    });

    const legacy = feedbackCardToLegacySuggestion(card);
    expect(legacy).toEqual({
      suggestionId: 'legacy-1',
      title: 'Clarify notice timing',
      body: 'Clarify when the notice period begins to run.',
      severity: 'major',
    });
  });
});
