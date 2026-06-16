/**
 * REVIEWER-ASYNC-DISPLAY-1 (Component C, C-3) — client GUARD (source-audit).
 *
 * The async path renders + gates polling off the server lane contract; the SYNC path (lanes === null,
 * REVIEWER_ASYNC_ENABLED OFF) is byte-for-byte unchanged. Verifies BOTH branches coexist: the new
 * `data.lanes` gates AND the preserved deriveCompletionState gate + 4-way sync switch. (deriveCompletionState
 * is intentionally UNCHANGED — so the sanctioned mr3.reviewState.test.ts assertions did not need to change.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');
const reviewPane = read('src/client/components/ReviewPane.tsx');
const reviewState = read('src/client/utils/reviewState.ts');

describe('C-3 — async renders/gates off the contract; sync byte-for-byte (GUARD)', () => {
  it('mounts the async lane HEADER + the SHARED suggestion workspace/footer when the server provides lanes', () => {
    expect(reviewPane).toContain("import { AsyncLaneReviewView } from './AsyncLaneReviewView.js';");
    expect(reviewPane).toContain('if (data.lanes) {');
    // ASYNC-LANE-DISPLAY-PARITY-1: the async branch renders the lane HEADER (AsyncLaneReviewView) ABOVE the
    // SHARED SuggestionCard list + regenerate footer (renderSuggestionWorkspace / renderApplyFooter) —
    // clean cards + per-suggestion controls + regenerate, not a raw-body terminal view.
    expect(reviewPane).toContain('<AsyncLaneReviewView lanes={data.lanes} />');
    expect(reviewPane).toContain('renderSuggestionWorkspace()');
    expect(reviewPane).toContain('renderApplyFooter()');
  });
  it('polling gates off the lane contract for async (poll until ALL lanes terminal)', () => {
    expect(reviewPane).toContain('if (d.lanes) {');
    expect(reviewPane).toContain('return d.lanes.allTerminal ? false : 3000;');
  });
  it('the SYNC poll gate + 4-way switch are preserved unchanged (deriveCompletionState still drives sync)', () => {
    expect(reviewPane).toContain('const completionState = deriveCompletionState(d.feedback ?? [], jobs);');
    expect(reviewPane).toContain("return completionState === 'pending_or_running' ? 3000 : false;");
    expect(reviewPane).toContain("completionState === 'pending_or_running' && (");
  });
  it('deriveCompletionState itself is UNCHANGED (single-reviewer contract intact for sync)', () => {
    // the feedback[0] authoritative + "row beats failed job" contract that mr3.reviewState.test.ts pins
    expect(reviewState).toContain('const hasSuggestions = feedback[0]!.suggestions.length > 0;');
    expect(reviewState).toContain("return hasSuggestions ? 'completed_with_feedback' : 'completed_without_feedback';");
  });
});
