import type { AnyReviewerKey } from '../config.js';
import { isReviewerLeanContractEnabled } from '../../config/featureFlags.js';

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

// REVIEWER-LATENCY-1 Step 2b: the lean single-render field set emitted when
// REVIEWER_LEAN_CONTRACT_ENABLED is on. Drops the runtime/evaluator-owned fields
// (feedback_id, review_cycle_id, reviewer_track, target_document, evaluator_disposition,
// evaluator_rationale, future_memory_instruction, persistence_count, persistence_chain,
// regeneration_instructions, severity_subtype) and the inert flags
// (suppress_by_default, routine_blank_flag — Step-0 consumer check: emitted-only, never
// read by any runtime path). ADDS governing_law so the jurisdiction treatment that used
// to live in the prose memo has a structured home (lossless derived display).
export const FEEDBACK_CARD_FIELD_NAMES_LEAN = [
  'severity',
  'critique_type',
  'target_section',
  'issue',
  'source_basis',
  'governing_law',
  'source_of_truth_tier',
  'recommendation',
  'suggested_revision',
  'requires_attorney_decision',
  'audience_affected',
  'confidence',
  'disposition_options',
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

const businessDecisionCalibration = [
  'Business-decision calibration anchor: if the draft reflects one possible business structure but matter context says the attorney has not selected the structure, treat the unselected structure as SUBSTANTIVE/BUSINESS rather than SUBSTANTIVE/DRAFTING.',
  'For seller-financing recourse decisions, including Path-A recourse with senior-debt cap versus Path-B non-recourse seller financing, identify the risk-allocation decision and set requires_attorney_decision true.',
  'Surface both available paths for attorney selection: Path A = recourse with senior-debt cap, with any cap language framed only as an option; Path B = non-recourse, preserving the current draft structure if the attorney selects it.',
  'Do not choose recourse or non-recourse for the attorney, do not recommend one path as the answer, and do not regenerate or rewrite the note to change the business structure unless the attorney has already selected that structure.',
  'For SUBSTANTIVE/BUSINESS cards, use recommendation and suggested_revision to describe options, attorney decision points, and drafting that would follow each option; never present an unselected business path as the required revision.',
].join('\n');

const jurisdictionDiscipline = [
  'Act as senior co-counsel for a Virginia/Maryland transactional attorney and write attorney-facing feedback, not consumer-facing explanations unless expressly instructed.',
  'Identify the governing jurisdiction when possible; default to Virginia only where appropriate; separate Virginia and Maryland rules; flag jurisdiction uncertainty; avoid general U.S. law where state-specific treatment matters.',
].join('\n');

const sourceAndModeDiscipline = [
  'Apply source hierarchy and source-basis discipline: tie each issue to document text, provided matter context, governing law, or another identified source; do not invent unsupported facts or authorities.',
  'Mode discipline: default to legal-review. If supplied later, respect formatting-only, second-opinion, and sendability-only mode instructions. You MAY consume any provided "Locked Decisions" context (attorney-locked decisions for this document) and must respect it per the Matter-memory awareness rule; do not, however, implement evaluator mode, persistence storage, sendability gates, or cumulative adopt ledgers in this prompt.',
  'No model specialization: do not treat this reviewer as research only, evaluator only, structural only, primary reviewer only, or second-opinion only. Each track has equivalent functional capability.',
].join('\n');

const outputContract = [
  'Return ONLY a JSON array of legacy feedback items so the active parser can persist the result. Do not include text outside the JSON array.',
  'Each item must keep this exact legacy wrapper shape: { "title": "Short issue title (under 80 characters)", "body": "Detailed attorney-facing feedback", "severity": "critical"|"major"|"minor" }.',
  'The item-level "severity" (critical, major, or minor) is REQUIRED on every item and is a DIFFERENT field from the feedback-card severity used inside the body (BLOCKER, SUBSTANTIVE, STRUCTURAL, PRECISION, POLISH). Always include the top-level critical/major/minor severity on each item; never omit it or replace it with a feedback-card tier.',
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

// ============================================================
// REVIEWER-LATENCY-1 Step 2b — LEAN single-render variants (flag ON only)
// Each block preserves the SAME calibration behavior as its legacy counterpart but
// drops references to fields that are no longer emitted. Behaviors kept verbatim in
// intent: five-tier severity, execution-blank suppression, drafting-vs-business
// separation, matter-memory awareness, persistence, cross-model complementarity,
// cumulative carry-forward, and the business-decision guardrail.
// ============================================================

const severityTaxonomyLean = [
  'Use this five-tier severity taxonomy exactly: BLOCKER, SUBSTANTIVE, STRUCTURAL, PRECISION, POLISH.',
  'BLOCKER = sendability fail or issue that prevents responsible attorney release.',
  'SUBSTANTIVE = legal, risk-allocation, or deal-position issue. In the issue and recommendation text, state whether it is a DRAFTING matter (how to express a settled legal or business position; you may recommend drafting language) or a BUSINESS matter (what position, risk allocation, or deal term to choose; surface options and do not choose the business path for the attorney).',
  'STRUCTURAL = organization, cross-reference, sequencing, or internal-consistency problem.',
  'PRECISION = wording, ambiguity, defined-term, citation, or source-basis precision problem.',
  'POLISH = style, readability, grammar, or aesthetics with no substantive effect.',
].join('\n');

const sevenMissingRulesLean = [
  'Execution-blanks suppression: do not flag ordinary signature, date, witness, or notary blanks on pre-execution drafts; simply omit routine execution blanks from your feedback rather than raising them. Missing legal description, principal amount, tax deadline, property identity, or other non-routine blanks remain flaggable.',
  'Substance-vs-tone classification: do not soften substantively correct legal positions unless audience or relationship-risk justifies it; label any softening recommendation as substance or tone in the issue and recommendation text.',
  'Drafting-vs-business separation: drafting means how to express a settled position; business means what position, risk allocation, or deal term to choose; never make business decisions for the attorney.',
  'Matter-memory awareness: check provided matter context for locked decisions and do not re-raise previously resolved or locked decisions absent material change.',
  'Reviewer-persistence treatment: if re-raising a previously disposed issue because it remains important, say so explicitly in the recommendation rather than silently suppressing it.',
  'Cross-model defect complementarity: when reviewing another reviewer output or acting in second-opinion mode, identify overlap, disagreement, and complementary catches across GPT, Claude, Grok, and Gemini without limiting any model to a single role.',
  'Cumulative state carry-forward: when reviewing regenerated drafts, treat prior adopted changes as part of the current intended state and do not flag adopted changes as new defects.',
].join('\n');

const businessDecisionCalibrationLean = [
  'Business-decision calibration anchor: if the draft reflects one possible business structure but matter context says the attorney has not selected the structure, treat the unselected structure as a BUSINESS decision (not a drafting fix) and set requires_attorney_decision true.',
  'For seller-financing recourse decisions, including Path-A recourse with senior-debt cap versus Path-B non-recourse seller financing, identify the risk-allocation decision and set requires_attorney_decision true.',
  'Surface both available paths for attorney selection: Path A = recourse with senior-debt cap, with any cap language framed only as an option; Path B = non-recourse, preserving the current draft structure if the attorney selects it.',
  'Do not choose recourse or non-recourse for the attorney, do not recommend one path as the answer, and do not regenerate or rewrite the note to change the business structure unless the attorney has already selected that structure.',
  'For business-decision items, use recommendation and suggested_revision to describe options, attorney decision points, and drafting that would follow each option; never present an unselected business path as the required revision.',
].join('\n');

const outputContractLean = [
  'Return ONLY a JSON array of legacy feedback items so the active parser can persist the result. Do not include text outside the JSON array.',
  'Emit ONE array item PER FINDING: the outer array must contain one item for EACH distinct material issue you find. Surface ALL material issues at the same coverage standard you would otherwise apply — do NOT collapse multiple issues into a single item and do NOT under-report. If you find ten issues, return ten items.',
  'Each item must keep this exact legacy wrapper shape: { "title": "Short issue title (under 80 characters)", "body": "the body string described below", "severity": "critical"|"major"|"minor" }.',
  'The item-level "severity" (critical, major, or minor) is REQUIRED on every item and is a DIFFERENT field from the feedback-card severity used inside the body (BLOCKER, SUBSTANTIVE, STRUCTURAL, PRECISION, POLISH). Always include the top-level critical/major/minor severity on each item; never omit it or replace it with a feedback-card tier.',
  'Inside EACH item\'s body string, return ONLY a section labeled STRUCTURED_FEEDBACK_CARDS followed by a JSON array containing one lean feedback-card object describing THAT item\'s finding. Do NOT write any prose, narrative, or memo section, and do NOT put any text outside that JSON array.',
  'Each feedback-card object must use EXACTLY these field names and no others: ' +
    FEEDBACK_CARD_FIELD_NAMES_LEAN.join(', ') +
    '.',
  'Field meanings: issue states the problem; source_basis ties it to document text, matter context, or governing law; governing_law states the jurisdiction / governing-law treatment (the controlling state and any Virginia vs. Maryland distinction, or "n/a" when not jurisdiction-dependent); source_of_truth_tier is a NUMBER from 1 to 9 (the numeric source-of-truth tier), never a text label; recommendation states the recommended action; suggested_revision gives concrete drafting language or null; requires_attorney_decision is true when the attorney must choose; audience_affected lists who is affected.',
  'Feedback-card severity values: BLOCKER, SUBSTANTIVE, STRUCTURAL, PRECISION, POLISH.',
  `Feedback-card critique_type values: ${FEEDBACK_CARD_CRITIQUE_TYPES.join(', ')}.`,
  `Feedback-card disposition_options values: ${FEEDBACK_CARD_DISPOSITIONS.join(', ')}.`,
  'Do not invent unsupported field names such as priority_level, business_owner, evaluator_notes, or final_decision, and do not emit any field not listed above.',
  'Return [] only if there is genuinely no feedback.',
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

// REVIEWER-LATENCY-1 Step 2b: lean style guidance — there is no body memo under the
// lean contract (the body is a single JSON card), so style guidance applies to the
// issue/recommendation text instead. No reference to a memo.
function styleInstructionLean(track: ReviewerTrack): string {
  switch (track) {
    case 'GPT':
      return 'Write the issue and recommendation text concisely with clear structure.';
    case 'Claude':
      return 'Write clear, well-structured issue and recommendation text while preserving valid JSON string escaping.';
    case 'Grok':
      return 'Write the issue and recommendation text as clean, direct do/don\'t guidance.';
    case 'Gemini':
      return 'Write the issue and recommendation text with explicit, structured behavioral constraints.';
  }
}

export function getReviewerPromptProfile(
  reviewerKey: AnyReviewerKey,
  leanContract: boolean = isReviewerLeanContractEnabled(),
): ReviewerPromptProfile {
  const track = trackForReviewer(reviewerKey);
  const systemPrompt = leanContract
    ? [
        `You are the ${track} legal document reviewer (${reviewerKey}).`,
        jurisdictionDiscipline,
        severityTaxonomyLean,
        sevenMissingRulesLean,
        businessDecisionCalibrationLean,
        sourceAndModeDiscipline,
        styleInstructionLean(track),
        outputContractLean,
      ].join('\n\n')
    : [
        `You are the ${track} legal document reviewer (${reviewerKey}).`,
        jurisdictionDiscipline,
        severityTaxonomy,
        sevenMissingRules,
        businessDecisionCalibration,
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

export function buildReviewerSystemPrompt(
  reviewerKey: AnyReviewerKey,
  leanContract: boolean = isReviewerLeanContractEnabled(),
): string {
  return getReviewerPromptProfile(reviewerKey, leanContract).systemPrompt;
}
