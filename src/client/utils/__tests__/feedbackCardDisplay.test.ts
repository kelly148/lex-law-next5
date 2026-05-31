/**
 * LLN-FEEDBACK-CARD-UX-1 — feedbackCardDisplay helpers
 */
import { describe, it, expect } from 'vitest';
import {
  stripEmbeddedCardsJson,
  splitSuggestedRevisionPaths,
} from '../feedbackCardDisplay.js';

const SAMPLE_BODY =
  'NARRATIVE_REVIEWER_MEMO This DPOA contains a direct internal conflict regarding ' +
  'the agent\'s authority. Counsel must resolve the ambiguity. ' +
  'STRUCTURED_FEEDBACK_CARDS [{"feedback_id":"GEM-24-01-A","severity":"SUBSTANTIVE",' +
  '"audience_affected":"Principal, Agent","recommendation":"Discuss with Principal."}]';

describe('stripEmbeddedCardsJson', () => {
  it('removes the raw STRUCTURED_FEEDBACK_CARDS JSON blob entirely', () => {
    const out = stripEmbeddedCardsJson(SAMPLE_BODY);
    expect(out).not.toContain('STRUCTURED_FEEDBACK_CARDS');
    expect(out).not.toContain('{');
    expect(out).not.toContain('feedback_id');
  });

  it('strips the leading NARRATIVE_REVIEWER_MEMO label, keeping the prose', () => {
    const out = stripEmbeddedCardsJson(SAMPLE_BODY);
    expect(out).not.toMatch(/^NARRATIVE_REVIEWER_MEMO/);
    expect(out).toMatch(/^This DPOA contains a direct internal conflict/);
    expect(out).toContain('Counsel must resolve the ambiguity.');
  });

  it('returns the trimmed body unchanged when no markers are present (legacy-safe)', () => {
    expect(stripEmbeddedCardsJson('  Plain reviewer note.  ')).toBe('Plain reviewer note.');
  });

  it('returns empty string for empty / non-string input', () => {
    expect(stripEmbeddedCardsJson('')).toBe('');
    // @ts-expect-error runtime guard for non-string input
    expect(stripEmbeddedCardsJson(null)).toBe('');
  });
});

describe('splitSuggestedRevisionPaths', () => {
  it('splits a multi-path revision into discrete items', () => {
    const text =
      'Path 1 (Prohibit): Delete Section 3.6(e). Path 2 (Opt-In): Add an initialing choice.';
    const parts = splitSuggestedRevisionPaths(text);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^Path 1 \(Prohibit\)/);
    expect(parts[1]).toMatch(/^Path 2 \(Opt-In\)/);
  });

  it('returns a single-item array when there is no multi-path structure', () => {
    const parts = splitSuggestedRevisionPaths('Revise Section V(e) to read as follows.');
    expect(parts).toEqual(['Revise Section V(e) to read as follows.']);
  });

  it('returns [] for empty / non-string input', () => {
    expect(splitSuggestedRevisionPaths('')).toEqual([]);
    // @ts-expect-error runtime guard for non-string input
    expect(splitSuggestedRevisionPaths(undefined)).toEqual([]);
  });
});
