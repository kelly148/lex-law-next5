/**
 * MR-1 Reviewer Path Tests
 *
 * Verifies:
 *   S6a — feedbackParser: valid JSON array → ParsedFeedbackSuggestion[] with UUIDs
 *   S6b — feedbackParser: empty array [] → [] without error
 *   S6c — feedbackParser: malformed JSON → throws REVIEWER_OUTPUT_MALFORMED
 *   S6d — feedbackParser: wrong schema shape (suggestion/rationale) → throws REVIEWER_OUTPUT_MALFORMED
 *   S6e — feedbackParser: markdown code-fence stripping works
 *   S6f — reviewSession.ts: S1a version fetch guard present
 *   S6g — reviewSession.ts: S1b prompt shape (title/body/severity) present
 *   S6h — reviewSession.ts: S3b txn2Commit calls parseFeedbackOutput and insertFeedback
 *   S6i — reviewSession.ts: S3c REVIEWER_TITLES imported and used
 *   S6j — reviewSession.ts: S4 D6 guard present
 *   S6k — ReviewPane.tsx: S5 refetchInterval polls when active+empty
 *   S6l — ReviewPane.tsx: S5 "Checking for results" message present
 *   S6m — config.ts: REVIEWER_TITLES exported with correct keys
 *   S6n — feedbackParser.ts: file exists at expected path
 *
 * References: MR-1 spec §S1–§S5
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ─── S6a–S6e: feedbackParser unit tests ──────────────────────────────────────

// Import the parser directly for unit testing
import { parseFeedbackOutput } from '../../server/llm/parsers/feedbackParser.js';

describe('S6a–S6e: feedbackParser', () => {
  it('S6a: valid JSON array → ParsedFeedbackSuggestion[] with suggestionId UUIDs', () => {
    const raw = JSON.stringify([
      { title: 'Missing consideration clause', body: 'Add a consideration clause.', severity: 'critical' },
      { title: 'Ambiguous term', body: 'Clarify the term "reasonable".', severity: 'minor' },
    ]);
    const result = parseFeedbackOutput(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      title: 'Missing consideration clause',
      body: 'Add a consideration clause.',
      severity: 'critical',
    });
    expect(result[0]?.suggestionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result[1]?.suggestionId).not.toBe(result[0]?.suggestionId);
  });

  it('S6b: empty array [] → [] without error', () => {
    const result = parseFeedbackOutput('[]');
    expect(result).toEqual([]);
  });

  it('S6c: malformed JSON → throws REVIEWER_OUTPUT_MALFORMED', () => {
    expect(() => parseFeedbackOutput('not json at all')).toThrow('REVIEWER_OUTPUT_MALFORMED');
  });

  it('S6d: wrong schema shape (suggestion/rationale) → throws REVIEWER_OUTPUT_MALFORMED', () => {
    const raw = JSON.stringify([
      { suggestion: 'Add a clause', rationale: 'Because it is missing', severity: 'major' },
    ]);
    expect(() => parseFeedbackOutput(raw)).toThrow('REVIEWER_OUTPUT_MALFORMED');
  });

  it('S6e: markdown code-fence stripping — ```json ... ``` is parsed correctly', () => {
    const raw = '```json\n[{"title":"Test","body":"Body text","severity":"major"}]\n```';
    const result = parseFeedbackOutput(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe('Test');
  });
});

// ─── S6f–S6n: Code-path audit (static analysis) ──────────────────────────────

const reviewSessionFile = fs.readFileSync(
  path.resolve(process.cwd(), 'src/server/procedures/reviewSession.ts'),
  'utf-8',
);

const reviewPaneFile = fs.readFileSync(
  path.resolve(process.cwd(), 'src/client/components/ReviewPane.tsx'),
  'utf-8',
);

const configFile = fs.readFileSync(
  path.resolve(process.cwd(), 'src/server/llm/config.ts'),
  'utf-8',
);

describe('S6f–S6j: reviewSession.ts code-path audit (MR-1)', () => {
  it('S6f: S1a — version fetch guard present (NO_CURRENT_VERSION)', () => {
    expect(reviewSessionFile).toContain('NO_CURRENT_VERSION');
    expect(reviewSessionFile).toContain('currentVersionId');
    expect(reviewSessionFile).toContain('getVersionById');
  });

  it('S6g: S1b — updated prompt requests title/body/severity shape (not suggestion/rationale)', () => {
    expect(reviewSessionFile).toContain('"title"');
    expect(reviewSessionFile).toContain('"body"');
    expect(reviewSessionFile).toContain('"severity"');
    // Old shape should not appear in the reviewer prompt construction
    expect(reviewSessionFile).not.toContain('"suggestion": string, "rationale": string');
  });

  it('S6h: S3b — txn2Commit calls parseFeedbackOutput and insertFeedback', () => {
    expect(reviewSessionFile).toContain('parseFeedbackOutput');
    expect(reviewSessionFile).toContain('insertFeedback');
    // The output parameter is destructured in txn2Commit
    expect(reviewSessionFile).toContain('{ jobId, output }');
  });

  it('S6i: S3c — REVIEWER_TITLES imported and used for reviewerTitle', () => {
    expect(reviewSessionFile).toContain('REVIEWER_TITLES');
    expect(reviewSessionFile).toContain('reviewerTitle');
  });

  it('S6j: S4 — D6 defensive guard present', () => {
    expect(reviewSessionFile).toContain('D6');
    expect(reviewSessionFile).toContain('hasSessionSelections');
    expect(reviewSessionFile).toContain('REVIEWER_SELECTIONS_NOT_RESOLVED');
  });
});

describe('S6k–S6l: ReviewPane.tsx code-path audit (MR-1 S5 → MR-3 §S1c)', () => {
  it('S6k: refetchInterval polls at 3000ms — MR-3 §S1c: now aligned with deriveCompletionState', () => {
    // MR-3 §S1c supersedes MR-1 S5: polling is now driven by deriveCompletionState.
    // The old isActive && !hasFeedback pattern was replaced by completionState === 'pending_or_running'.
    expect(reviewPaneFile).toContain('3000');
    expect(reviewPaneFile).toContain("completionState === 'pending_or_running' ? 3000 : false");
  });

  it('S6l: "Checking for results" message present for pending_or_running state', () => {
    expect(reviewPaneFile).toContain('Checking for results every few seconds');
  });
});

describe('S6m: config.ts REVIEWER_TITLES export', () => {
  it('S6m: REVIEWER_TITLES exported with all four reviewer keys', () => {
    expect(configFile).toContain('REVIEWER_TITLES');
    expect(configFile).toContain("claude: 'Claude'");
    expect(configFile).toContain("gpt: 'GPT'");
    expect(configFile).toContain("gemini: 'Gemini'");
    expect(configFile).toContain("grok: 'Grok'");
  });
});

describe('S6n: feedbackParser.ts file existence', () => {
  it('S6n: feedbackParser.ts exists at src/server/llm/parsers/feedbackParser.ts', () => {
    const parserPath = path.resolve(process.cwd(), 'src/server/llm/parsers/feedbackParser.ts');
    expect(fs.existsSync(parserPath)).toBe(true);
  });
});
