import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseFeedbackOutput } from '../llm/parsers/feedbackParser.js';
import {
  buildReviewerSystemPrompt,
  REVIEWER_TRACK_KEYS,
  getReviewerPromptProfile,
} from '../llm/prompts/reviewerPrompts.js';
import type { AnyReviewerKey } from '../llm/config.js';

const repoRoot = path.resolve(__dirname, '../../..');
const reviewSessionSource = fs.readFileSync(
  path.join(repoRoot, 'src/server/procedures/reviewSession.ts'),
  'utf8',
);
// EGRESS-CONTROL-PLANE-1 Increment 2 relocated the reviewer EXECUTION logic
// (the legacy array-wrapper parser contract) out of reviewSession.ts into the
// reviewer job factory. The parser contract is preserved, now in the factory.
const reviewerJobFactorySource = fs.readFileSync(
  path.join(repoRoot, 'src/server/jobs/reviewerJobFactory.ts'),
  'utf8',
);

const fullToLitePairs: readonly [AnyReviewerKey, AnyReviewerKey][] = [
  ['gpt', 'gpt_lite'],
  ['claude', 'claude_lite'],
  ['grok', 'grok_lite'],
  ['gemini', 'gemini_lite'],
];

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

describe('MR-CAL-2A business-decision calibration', () => {
  it('T-CAL2A-1 anchors P8-T10 as SUBSTANTIVE/BUSINESS with attorney decision escalation', () => {
    expectEveryPromptToContain([
      'Business-decision calibration anchor',
      'attorney has not selected the structure',
      'SUBSTANTIVE/BUSINESS rather than SUBSTANTIVE/DRAFTING',
      'Path-A recourse with senior-debt cap versus Path-B non-recourse seller financing',
      'risk-allocation decision',
      'requires_attorney_decision true',
    ]);
  });

  it('T-CAL2A-2 requires both recourse and non-recourse paths without choosing either path', () => {
    expectEveryPromptToContain([
      'Surface both available paths for attorney selection',
      'Path A = recourse with senior-debt cap',
      'Path B = non-recourse',
      'Do not choose recourse or non-recourse for the attorney',
      'do not recommend one path as the answer',
      'do not regenerate or rewrite the note to change the business structure',
      'never present an unselected business path as the required revision',
    ]);
  });

  it('T-CAL2A-3 preserves Lite and Full functional equivalence for the new calibration language', () => {
    const businessDecisionTerms = [
      'Business-decision calibration anchor',
      'Path-A recourse with senior-debt cap versus Path-B non-recourse seller financing',
      'Surface both available paths for attorney selection',
      'Do not choose recourse or non-recourse for the attorney',
    ] as const;

    for (const [full, lite] of fullToLitePairs) {
      const fullProfile = getReviewerPromptProfile(full);
      const liteProfile = getReviewerPromptProfile(lite);

      expect(liteProfile.track).toBe(fullProfile.track);
      expect(liteProfile.constructionStyle).toBe(fullProfile.constructionStyle);
      expect(liteProfile.liteSharesFunctionalPrompt).toBe(true);

      for (const term of businessDecisionTerms) {
        expect(fullProfile.systemPrompt).toContain(term);
        expect(liteProfile.systemPrompt).toContain(term);
      }
    }
  });

  it('T-CAL2A-4 preserves P8-T1, P8-T6, P8-T7, no-specialization, and legacy wrapper instructions', () => {
    expectEveryPromptToContain([
      'do not flag ordinary signature, date, witness, or notary blanks on pre-execution drafts',
      'suppress_by_default true',
      'audience_affected',
      'overstatement',
      'BLOCKER = sendability fail',
      'No model specialization',
      'Each track has equivalent functional capability',
      'Return ONLY a JSON array of legacy feedback items',
      'NARRATIVE_REVIEWER_MEMO',
      'STRUCTURED_FEEDBACK_CARDS',
    ]);
  });

  it('T-CAL2A-5 keeps the active runtime path on the legacy array wrapper parser contract', () => {
    const p8t10LegacyWrappedOutput = JSON.stringify([
      {
        title: 'Escalate recourse decision to attorney',
        body: [
          'NARRATIVE_REVIEWER_MEMO: The note currently uses non-recourse seller financing while matter context says the attorney has not selected the risk-allocation structure. Surface both Path A recourse with senior-debt cap and Path B non-recourse for attorney selection.',
          'STRUCTURED_FEEDBACK_CARDS: [{"feedback_id":"p8-t10-1","review_cycle_id":"mr-cal-2a","reviewer_track":"GPT","severity":"SUBSTANTIVE","severity_subtype":"BUSINESS","critique_type":"legal_sufficiency","target_document":"Promissory note","target_section":"Recourse structure","issue":"Attorney has not selected recourse or non-recourse structure.","source_basis":"Matter context states attorney is weighing recourse versus non-recourse.","source_of_truth_tier":"matter context","recommendation":"Surface both Path A recourse with senior-debt cap and Path B non-recourse for attorney selection; do not choose either path.","suggested_revision":"If attorney selects Path A, draft recourse language with senior-debt cap; if attorney selects Path B, preserve non-recourse structure.","requires_attorney_decision":true,"suppress_by_default":false,"routine_blank_flag":false,"audience_affected":"internal","confidence":"high","disposition_options":["defer","modify"],"future_memory_instruction":null,"persistence_count":0,"persistence_chain":[],"evaluator_disposition":"unresolved","evaluator_rationale":null,"regeneration_instructions":null}]',
        ].join('\n'),
        severity: 'major',
      },
    ]);

    const parsed = parseFeedbackOutput(p8t10LegacyWrappedOutput);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      title: 'Escalate recourse decision to attorney',
      severity: 'major',
    });
    expect(parsed[0]?.body).toContain('SUBSTANTIVE');
    expect(parsed[0]?.body).toContain('BUSINESS');
    expect(parsed[0]?.body).toContain('requires_attorney_decision');
    expect(parsed[0]?.body).toContain('Path A recourse with senior-debt cap');
    expect(parsed[0]?.body).toContain('Path B non-recourse');
    expect(reviewSessionSource).toContain('buildReviewerSystemPrompt(reviewerRole as AnyReviewerKey)');
    expect(reviewerJobFactorySource).toContain('parseFeedbackOutput');
    expect(reviewerJobFactorySource).toContain('RawSuggestionsArraySchema');
  });
});
