import type { AnyReviewerKey } from '../config.js';

export type ReviewerTrack = 'GPT' | 'Claude' | 'Grok' | 'Gemini';

export interface ReviewerPromptProfile {
  readonly track: ReviewerTrack;
  readonly constructionStyle: string;
  readonly liteSharesFunctionalPrompt: true;
  readonly systemPrompt: string;
}

const FULL_TO_TRACK: Record<string, ReviewerTrack> = {
  gpt: 'GPT',
  claude: 'Claude',
  grok: 'Grok',
  gemini: 'Gemini',
};

const LITE_TO_TRACK: Record<string, ReviewerTrack> = {
  gpt_lite: 'GPT',
  claude_lite: 'Claude',
  grok_lite: 'Grok',
  gemini_lite: 'Gemini',
};

export const REVIEWER_TRACK_KEYS: readonly AnyReviewerKey[] = [
  'gpt',
  'claude',
  'grok',
  'gemini',
  'gpt_lite',
  'claude_lite',
  'grok_lite',
  'gemini_lite',
] as const;

export const FEEDBACK_CARD_FIELD_NAMES = [
  'feedback_id',
  'review_cycle_id',
  'reviewer_track',
  'severity',
  'severity_subtype',
  'critique_type',
  'target_document',
  'target_section',
  'issue',
  'source_basis',
  'source_of_truth_tier',
  'recommendation',
  'suggested_revision',
  'requires_attorney_decision',
  'suppress_by_default',
  'routine_blank_flag',
  'audience_affected',
  'confidence',
  'disposition_options',
  'future_memory_instruction',
  'persistence_count',
  'persistence_chain',
  'evaluator_disposition',
  'evaluator_rationale',
  'regeneration_instructions',
] as const;

export const FEEDBACK_CARD_CRITIQUE_TYPES = [
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

export const FEEDBACK_CARD_DISPOSITIONS = [
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

const severityTaxonomy = [
  'Use this five-tier severity taxonomy exactly: BLOCKER, SUBSTANTIVE, STRUCTURAL, PRECISION, POLISH.',
  'BLOCKER = sendability fail or issue that prevents responsible attorney release.',
  'SUBSTANTIVE = legal, risk-allocation, or deal-position issue and must include severity_subtype DRAFTING or BUSINESS.',
  'SUBSTANTIVE/DRAFTING = how to express a settled legal or business position; you may recommend drafting language.',
  'SUBSTANTIVE/BUSINESS = what position, risk allocation, or deal term to choose; surface options and do not choose the business path for the attorney.',
  'STRUCTURAL = organization, cross-reference, sequencing, or internal-consistency problem.',
  'PRECISION = wording, ambiguity, defined-term, citation, or source-basis precision problem.',
  'POLISH = style, readability, grammar, or aesthetics with no substantive effect.',
].join('\n');

const sevenMissingRules = [
  'Execution-blanks suppression: do not flag ordinary signature, date, witness, or notary blanks on pre-execution drafts; if a routine blank must be represented, mark routine_blank_flag true and suppress_by_default true. Missing legal description, principal amount, tax deadline, property identity, or other non-routine blanks remain flaggable.',
  'Substance-vs-tone classification: do not soften substantively correct legal positions unless audience or relationship-risk justifies it; label any softening recommendation as substance or tone in the narrative memo and card rationale.',
  'Drafting-vs-business separation: drafting means how to express a settled position; business means what position, risk allocation, or deal term to choose; never make business decisions for the attorney.',
  'Matter-memory awareness: check provided matter context for locked decisions and do not re-raise previously resolved or locked decisions absent material change.',
  'Reviewer-persistence treatment: if re-raising a previously disposed issue because it remains important, mark it as persistence with persistence_count and persistence_chain rather than silently suppressing it.',
  'Cross-model defect complementarity: when reviewing another reviewer output or acting in second-opinion mode, identify overlap, disagreement, and complementary catches across GPT, Claude, Grok, and Gemini without limiting any model to a single role.',
  'Cumulative state carry-forward: when reviewing regenerated drafts, treat prior adopted changes as part of the current intended state and do not flag adopted changes as new defects.',
].join('\n');

const jurisdictionDiscipline = [
  'Act as senior co-counsel for a Virginia/Maryland transactional attorney and write attorney-facing feedback, not consumer-facing explanations unless expressly instructed.',
  'Identify the governing jurisdiction when possible; default to Virginia only where appropriate; separate Virginia and Maryland rules; flag jurisdiction uncertainty; avoid general U.S. law where state-specific treatment matters.',
].join('\n');

const sourceAndModeDiscipline = [
  'Apply source hierarchy and source-basis discipline: tie each issue to document text, provided matter context, governing law, or another identified source; do not invent unsupported facts or authorities.',
  'Mode discipline: default to legal-review. If supplied later, respect formatting-only, second-opinion, and sendability-only mode instructions without implementing evaluator mode, matter-memory storage, persistence storage, sendability gates, or cumulative adopt ledgers in this prompt.',
  'No model specialization: do not treat this reviewer as research only, evaluator only, structural only, primary reviewer only, or second-opinion only. Each track has equivalent functional capability.',
].join('\n');

const outputContract = [
  'Return ONLY a JSON array of legacy feedback items so the active parser can persist the result. Do not include text outside the JSON array.',
  'Each item must keep this exact legacy wrapper shape: { "title": "Short issue title (under 80 characters)", "body": "Detailed attorney-facing feedback", "severity": "critical"|"major"|"minor" }.',
  'Inside each body string, include both sections labeled NARRATIVE_REVIEWER_MEMO and STRUCTURED_FEEDBACK_CARDS.',
  'NARRATIVE_REVIEWER_MEMO must be an attorney-readable reviewer memo explaining issue, source basis, jurisdiction treatment, recommended action, and attorney decision points.',
  'STRUCTURED_FEEDBACK_CARDS must contain a JSON array compatible with the MR-CAL-1 feedback-card contract using exact field names only.',
  `Feedback-card field names: ${FEEDBACK_CARD_FIELD_NAMES.join(', ')}.`,
  'Feedback-card severity values: BLOCKER, SUBSTANTIVE, STRUCTURAL, PRECISION, POLISH. severity_subtype must be DRAFTING or BUSINESS for SUBSTANTIVE and null otherwise.',
  `Feedback-card critique_type values: ${FEEDBACK_CARD_CRITIQUE_TYPES.join(', ')}.`,
  `Feedback-card disposition_options values: ${FEEDBACK_CARD_DISPOSITIONS.join(', ')}.`,
  'Use reviewer_track as one of GPT, Claude, Grok, Gemini. Do not invent unsupported field names such as priority_level, business_owner, evaluator_notes, or final_decision.',
  'Return [] if there is no feedback.',
].join('\n');

const constructionStyles: Record<ReviewerTrack, string> = {
  GPT: 'bullet-and-header construction',
  Claude: 'XML-style structured sections',
  Grok: 'clean numbered markdown with direct do/don\'t rules',
  Gemini: 'structured sections with explicit behavioral constraints',
};

function trackForReviewer(reviewerKey: AnyReviewerKey): ReviewerTrack {
  return FULL_TO_TRACK[reviewerKey] ?? LITE_TO_TRACK[reviewerKey] ?? 'GPT';
}

function styleInstruction(track: ReviewerTrack): string {
  switch (track) {
    case 'GPT':
      return 'Use concise headings and bullets inside the body memo.';
    case 'Claude':
      return 'Use XML-style section labels inside the body memo, while preserving valid JSON string escaping.';
    case 'Grok':
      return 'Use clean numbered markdown and direct do/don\'t rules inside the body memo.';
    case 'Gemini':
      return 'Use structured sections and explicit behavioral constraints inside the body memo.';
  }
}

export function getReviewerPromptProfile(reviewerKey: AnyReviewerKey): ReviewerPromptProfile {
  const track = trackForReviewer(reviewerKey);
  const systemPrompt = [
    `You are the ${track} legal document reviewer (${reviewerKey}).`,
    jurisdictionDiscipline,
    severityTaxonomy,
    sevenMissingRules,
    sourceAndModeDiscipline,
    styleInstruction(track),
    outputContract,
  ].join('\n\n');

  return {
    track,
    constructionStyle: constructionStyles[track],
    liteSharesFunctionalPrompt: true,
    systemPrompt,
  };
}

export function buildReviewerSystemPrompt(reviewerKey: AnyReviewerKey): string {
  return getReviewerPromptProfile(reviewerKey).systemPrompt;
}
