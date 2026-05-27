import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseFeedbackOutput } from '../llm/parsers/feedbackParser.js';
import {
  buildReviewerSystemPrompt,
  FEEDBACK_CARD_FIELD_NAMES,
  REVIEWER_TRACK_KEYS,
  getReviewerPromptProfile,
} from '../llm/prompts/reviewerPrompts.js';
import type { AnyReviewerKey } from '../llm/config.js';

const repoRoot = path.resolve(__dirname, '../../..');
const reviewSessionSource = fs.readFileSync(
  path.join(repoRoot, 'src/server/procedures/reviewSession.ts'),
  'utf8',
);

const fullToLitePairs: readonly [AnyReviewerKey, AnyReviewerKey][] = [
  ['gpt', 'gpt_lite'],
  ['claude', 'claude_lite'],
  ['grok', 'grok_lite'],
  ['gemini', 'gemini_lite'],
];

const coreReviewerKeys: readonly AnyReviewerKey[] = ['gpt', 'claude', 'grok', 'gemini'];

function promptFor(key: AnyReviewerKey): string {
  return buildReviewerSystemPrompt(key);
}

function expectEveryPromptToContain(terms: readonly string[]): void {
  for (const key of REVIEWER_TRACK_KEYS) {
    const prompt = promptFor(key);
    for (const term of terms) {
      expect(prompt).toContain(term);
    }
  }
}

describe('MR-CAL-2 calibrated reviewer prompts', () => {
  it('T-CAL2-1 exposes all four active reviewer tracks', () => {
    expect(coreReviewerKeys.map((key) => getReviewerPromptProfile(key).track)).toEqual([
      'GPT',
      'Claude',
      'Grok',
      'Gemini',
    ]);
    expect(REVIEWER_TRACK_KEYS).toEqual([
      'gpt',
      'claude',
      'grok',
      'gemini',
      'gpt_lite',
      'claude_lite',
      'grok_lite',
      'gemini_lite',
    ]);
  });

  it('T-CAL2-2 keeps Lite and Full prompts functionally equivalent for each track', () => {
    const requiredFunctionalRules = [
      'senior co-counsel for a Virginia/Maryland transactional attorney',
      'five-tier severity taxonomy',
      'Execution-blanks suppression',
      'Substance-vs-tone classification',
      'Drafting-vs-business separation',
      'Matter-memory awareness',
      'Reviewer-persistence treatment',
      'Cross-model defect complementarity',
      'Cumulative state carry-forward',
      'STRUCTURED_FEEDBACK_CARDS',
      'No model specialization',
    ] as const;

    for (const [full, lite] of fullToLitePairs) {
      const fullProfile = getReviewerPromptProfile(full);
      const liteProfile = getReviewerPromptProfile(lite);

      expect(liteProfile.track).toBe(fullProfile.track);
      expect(liteProfile.constructionStyle).toBe(fullProfile.constructionStyle);
      expect(liteProfile.liteSharesFunctionalPrompt).toBe(true);

      for (const rule of requiredFunctionalRules) {
        expect(fullProfile.systemPrompt).toContain(rule);
        expect(liteProfile.systemPrompt).toContain(rule);
      }
    }
  });

  it('T-CAL2-3 includes the five-tier severity taxonomy and SUBSTANTIVE subtypes in every prompt', () => {
    expectEveryPromptToContain([
      'BLOCKER',
      'SUBSTANTIVE',
      'STRUCTURAL',
      'PRECISION',
      'POLISH',
      'DRAFTING',
      'BUSINESS',
      'BLOCKER = sendability fail',
      'SUBSTANTIVE/DRAFTING = how to express a settled legal or business position',
      'SUBSTANTIVE/BUSINESS = what position, risk allocation, or deal term to choose',
    ]);
  });

  it('T-CAL2-4 includes all seven missing calibration rules in every prompt', () => {
    expectEveryPromptToContain([
      'Execution-blanks suppression',
      'ordinary signature, date, witness, or notary blanks',
      'Substance-vs-tone classification',
      'Drafting-vs-business separation',
      'Matter-memory awareness',
      'locked decisions',
      'Reviewer-persistence treatment',
      'persistence_count',
      'Cross-model defect complementarity',
      'overlap, disagreement, and complementary catches',
      'Cumulative state carry-forward',
      'prior adopted changes',
    ]);
  });

  it('T-CAL2-5 instructs output with MR-CAL-1 feedback-card schema field names only', () => {
    for (const key of REVIEWER_TRACK_KEYS) {
      const prompt = promptFor(key);

      for (const fieldName of FEEDBACK_CARD_FIELD_NAMES) {
        expect(prompt).toContain(fieldName);
      }

      expect(prompt).toContain('Do not invent unsupported field names');
      expect(prompt).toContain('priority_level');
      expect(prompt).toContain('business_owner');
      expect(prompt).toContain('evaluator_notes');
      expect(prompt).toContain('final_decision');
    }
  });

  it('T-CAL2-6 requires both an attorney-readable narrative memo and structured feedback-card array', () => {
    expectEveryPromptToContain([
      'NARRATIVE_REVIEWER_MEMO',
      'attorney-readable reviewer memo',
      'STRUCTURED_FEEDBACK_CARDS',
      'JSON array compatible with the MR-CAL-1 feedback-card contract',
    ]);
  });

  it('T-CAL2-7 preserves the business decision guardrail for SUBSTANTIVE/BUSINESS items', () => {
    expectEveryPromptToContain([
      'SUBSTANTIVE/BUSINESS',
      'surface options and do not choose the business path for the attorney',
      'never make business decisions for the attorney',
      'requires_attorney_decision',
    ]);
  });

  it('T-CAL2-8 suppresses ordinary execution blanks while preserving non-routine blank flagging', () => {
    expectEveryPromptToContain([
      'do not flag ordinary signature, date, witness, or notary blanks on pre-execution drafts',
      'routine_blank_flag true',
      'suppress_by_default true',
      'Missing legal description, principal amount, tax deadline, property identity, or other non-routine blanks remain flaggable',
    ]);
  });

  it('T-CAL2-9 keeps the active legacy parser path compatible with the prompt-expected wrapper shape', () => {
    const legacyWrappedCards = JSON.stringify([
      {
        title: 'NARRATIVE_REVIEWER_MEMO and STRUCTURED_FEEDBACK_CARDS present',
        body: 'NARRATIVE_REVIEWER_MEMO: Attorney memo.\nSTRUCTURED_FEEDBACK_CARDS: []',
        severity: 'major',
      },
    ]);

    const parsed = parseFeedbackOutput(legacyWrappedCards);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      title: 'NARRATIVE_REVIEWER_MEMO and STRUCTURED_FEEDBACK_CARDS present',
      body: 'NARRATIVE_REVIEWER_MEMO: Attorney memo.\nSTRUCTURED_FEEDBACK_CARDS: []',
      severity: 'major',
    });
    expect(reviewSessionSource).toContain('buildReviewerSystemPrompt(reviewerRole as AnyReviewerKey)');
    expect(reviewSessionSource).toContain('parseFeedbackOutput');
  });

  it('T-CAL2-10 avoids hard-coded model specialization while allowing construction style differences', () => {
    const forbiddenSpecializations = [
      'is research only',
      'is evaluator only',
      'is structural only',
      'is primary reviewer only',
      'is second-opinion only',
      'limited to research',
      'limited to evaluator',
      'limited to structural',
    ];

    for (const key of REVIEWER_TRACK_KEYS) {
      const prompt = promptFor(key).toLowerCase();
      expect(prompt).toContain('each track has equivalent functional capability');
      expect(prompt).toContain('do not treat this reviewer as research only');
      for (const forbidden of forbiddenSpecializations) {
        expect(prompt).not.toContain(forbidden);
      }
    }

    expect(getReviewerPromptProfile('gpt').constructionStyle).toBe('bullet-and-header construction');
    expect(getReviewerPromptProfile('claude').constructionStyle).toBe('XML-style structured sections');
    expect(getReviewerPromptProfile('grok').constructionStyle).toBe(
      'clean numbered markdown with direct do/don\'t rules',
    );
    expect(getReviewerPromptProfile('gemini').constructionStyle).toBe(
      'structured sections with explicit behavioral constraints',
    );
  });
});
