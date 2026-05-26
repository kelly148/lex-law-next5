import { z } from 'zod';

import { FeedbackSuggestionSchema } from './phase4b.js';

// ============================================================
// Phase 5 / Phase 7 controlled vocabularies
// ============================================================

export const FEEDBACK_CARD_SEVERITY_VALUES = [
  'BLOCKER',
  'SUBSTANTIVE',
  'STRUCTURAL',
  'PRECISION',
  'POLISH',
] as const;
export const FeedbackCardSeveritySchema = z.enum(FEEDBACK_CARD_SEVERITY_VALUES);
export type FeedbackCardSeverity = z.infer<typeof FeedbackCardSeveritySchema>;

export const FEEDBACK_CARD_SEVERITY_SUBTYPE_VALUES = ['DRAFTING', 'BUSINESS'] as const;
export const FeedbackCardSeveritySubtypeSchema = z.enum(
  FEEDBACK_CARD_SEVERITY_SUBTYPE_VALUES,
);
export type FeedbackCardSeveritySubtype = z.infer<
  typeof FeedbackCardSeveritySubtypeSchema
>;

export const FEEDBACK_CARD_CRITIQUE_TYPE_VALUES = [
  'legal_sufficiency',
  'drafting_precision',
  'structural',
  'audience',
  'factual',
  'stylistic',
  'matter_memory_correction',
  'audience_shift_recommendation',
  'overstatement',
  'under_inclusion_or_omission',
  'cross_document_consistency',
  'reviewer_role_overreach',
] as const;
export const FeedbackCardCritiqueTypeSchema = z.enum(
  FEEDBACK_CARD_CRITIQUE_TYPE_VALUES,
);
export type FeedbackCardCritiqueType = z.infer<typeof FeedbackCardCritiqueTypeSchema>;

export const FEEDBACK_CARD_REVIEWER_TRACK_VALUES = [
  'GPT',
  'Claude',
  'Grok',
  'Gemini',
] as const;
export const FeedbackCardReviewerTrackSchema = z.enum(
  FEEDBACK_CARD_REVIEWER_TRACK_VALUES,
);
export type FeedbackCardReviewerTrack = z.infer<typeof FeedbackCardReviewerTrackSchema>;

export const FEEDBACK_CARD_AUDIENCE_VALUES = [
  'attorney',
  'client',
  'counterparty',
  'opposing_counsel',
  'court',
  'title_company',
  'internal',
  'external',
] as const;
export const FeedbackCardAudienceSchema = z.enum(FEEDBACK_CARD_AUDIENCE_VALUES);
export type FeedbackCardAudience = z.infer<typeof FeedbackCardAudienceSchema>;

export const FEEDBACK_CARD_DISPOSITION_VALUES = [
  'adopt',
  'modify',
  'reject',
  'defer',
  'preserve internally',
  'unresolved',
  'already addressed',
  'superseded',
  'pass',
] as const;
export const FeedbackCardDispositionSchema = z.enum(FEEDBACK_CARD_DISPOSITION_VALUES);
export type FeedbackCardDisposition = z.infer<typeof FeedbackCardDispositionSchema>;

export const FEEDBACK_CARD_EVALUATOR_DISPOSITION_VALUES = [
  'adopt',
  'modify',
  'reject',
  'defer',
  'preserve internally',
  'unresolved',
  'already addressed',
  'superseded',
  'pass',
] as const;
export const FeedbackCardEvaluatorDispositionSchema = z.enum(
  FEEDBACK_CARD_EVALUATOR_DISPOSITION_VALUES,
);
export type FeedbackCardEvaluatorDisposition = z.infer<
  typeof FeedbackCardEvaluatorDispositionSchema
>;

// Phase 5 source materials define source_of_truth_tier as a numeric tier and
// include examples through tier 9. Keep the contract numeric so future tier-label
// text can be added without changing the JSON field name.
export const FeedbackCardSourceOfTruthTierSchema = z.number().int().min(1).max(9);

export const FeedbackCardConfidenceSchema = z.number().min(0).max(1);

// ============================================================
// Canonical target feedback-card object
// ============================================================

export const FeedbackCardSchema = z
  .object({
    feedback_id: z.string().min(1),
    review_cycle_id: z.string().min(1),
    reviewer_track: FeedbackCardReviewerTrackSchema,
    severity: FeedbackCardSeveritySchema,
    severity_subtype: FeedbackCardSeveritySubtypeSchema.nullable(),
    critique_type: FeedbackCardCritiqueTypeSchema,
    target_document: z.string().min(1),
    target_section: z.string().min(1),
    issue: z.string().min(1),
    source_basis: z.string().min(1),
    source_of_truth_tier: FeedbackCardSourceOfTruthTierSchema,
    recommendation: z.string().min(1),
    suggested_revision: z.string().nullable(),
    requires_attorney_decision: z.boolean(),
    suppress_by_default: z.boolean(),
    routine_blank_flag: z.boolean(),
    audience_affected: z.array(FeedbackCardAudienceSchema),
    confidence: FeedbackCardConfidenceSchema,
    disposition_options: z.array(FeedbackCardDispositionSchema).min(1),
    future_memory_instruction: z.string().nullable(),
    persistence_count: z.number().int().nonnegative(),
    persistence_chain: z.array(z.string().min(1)),
    evaluator_disposition: FeedbackCardEvaluatorDispositionSchema.nullable(),
    evaluator_rationale: z.string().nullable(),
    regeneration_instructions: z.string().nullable(),
  })
  .superRefine((card, ctx) => {
    if (card.severity === 'SUBSTANTIVE' && card.severity_subtype === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['severity_subtype'],
        message: 'severity_subtype is required when severity is SUBSTANTIVE',
      });
    }

    if (card.severity !== 'SUBSTANTIVE' && card.severity_subtype !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['severity_subtype'],
        message: 'severity_subtype must be null unless severity is SUBSTANTIVE',
      });
    }
  });

export const FeedbackCardArraySchema = z.array(FeedbackCardSchema);
export type FeedbackCard = z.infer<typeof FeedbackCardSchema>;
export type FeedbackCardArray = z.infer<typeof FeedbackCardArraySchema>;
export type FeedbackSuggestion = z.infer<typeof FeedbackSuggestionSchema>;

// ============================================================
// Legacy compatibility helpers
// ============================================================

export function isLegacyFeedbackSuggestion(value: unknown): value is FeedbackSuggestion {
  return FeedbackSuggestionSchema.safeParse(value).success;
}

export function isFeedbackCard(value: unknown): value is FeedbackCard {
  return FeedbackCardSchema.safeParse(value).success;
}

function legacySeverityToFeedbackCardSeverity(
  severity: string | undefined,
): FeedbackCardSeverity {
  switch (severity) {
    case 'critical':
      return 'BLOCKER';
    case 'major':
      return 'SUBSTANTIVE';
    case 'minor':
    default:
      return 'PRECISION';
  }
}

function feedbackCardSeverityToLegacySeverity(
  severity: FeedbackCardSeverity,
): 'critical' | 'major' | 'minor' {
  switch (severity) {
    case 'BLOCKER':
      return 'critical';
    case 'SUBSTANTIVE':
    case 'STRUCTURAL':
      return 'major';
    case 'PRECISION':
    case 'POLISH':
      return 'minor';
  }
}

export interface LegacySuggestionToFeedbackCardInput {
  suggestion: FeedbackSuggestion;
  reviewCycleId: string;
  reviewerTrack: FeedbackCardReviewerTrack;
  targetDocument: string;
  targetSection?: string;
}

export function legacySuggestionToFeedbackCard({
  suggestion,
  reviewCycleId,
  reviewerTrack,
  targetDocument,
  targetSection = 'unspecified',
}: LegacySuggestionToFeedbackCardInput): FeedbackCard {
  const severity = legacySeverityToFeedbackCardSeverity(suggestion.severity);
  return FeedbackCardSchema.parse({
    feedback_id: suggestion.suggestionId,
    review_cycle_id: reviewCycleId,
    reviewer_track: reviewerTrack,
    severity,
    severity_subtype: severity === 'SUBSTANTIVE' ? 'DRAFTING' : null,
    critique_type: 'drafting_precision',
    target_document: targetDocument,
    target_section: targetSection,
    issue: suggestion.title,
    source_basis: suggestion.body,
    source_of_truth_tier: 9,
    recommendation: suggestion.body,
    suggested_revision: null,
    requires_attorney_decision: true,
    suppress_by_default: false,
    routine_blank_flag: false,
    audience_affected: ['attorney'],
    confidence: 0.5,
    disposition_options: ['adopt', 'modify', 'reject', 'defer'],
    future_memory_instruction: null,
    persistence_count: 0,
    persistence_chain: [],
    evaluator_disposition: null,
    evaluator_rationale: null,
    regeneration_instructions: null,
  });
}

export function feedbackCardToLegacySuggestion(card: FeedbackCard): FeedbackSuggestion {
  return FeedbackSuggestionSchema.parse({
    suggestionId: card.feedback_id,
    title: card.issue,
    body: card.recommendation,
    severity: feedbackCardSeverityToLegacySeverity(card.severity),
  });
}
