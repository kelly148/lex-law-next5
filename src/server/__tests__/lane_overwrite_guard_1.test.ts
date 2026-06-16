/**
 * LANE-OVERWRITE-GUARD-1 (HI-3) — a late/duplicate FAILURE-class lane transition must not clobber a
 * real feedback-bearing terminal.
 *
 * Audit (outputs/MONSTER_UAT_FINDINGS_2026-06-15.md): markReviewerLaneTerminal updated by
 * (session, reviewerRole) with NO status guard, so a late txn2Revert firing AFTER txn2Commit already
 * wrote completed_with_feedback would flip the lane to failed and null feedbackRowId — the async UI then
 * shows a failed lane while real feedback rows exist. Fix: a FAILURE-class terminal is restricted to
 * NON-terminal lanes (mirrors markReviewerLaneDispatchFailed / reapStaleLanes); a SUCCESS/feedback
 * terminal stays unconditional so a legitimate late retry still supersedes an earlier orphaned_reaped.
 *
 * No DB harness exists in the test env (telemetry-only setup), so this mirrors the lane-state suites'
 * pure-helper + source-audit idiom.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { terminalWriteRestrictedToNonTerminal } from '../db/queries/reviewerLaneState.js';
import {
  FAILURE_LANE_STATUSES,
  REVIEWER_LANE_STATUS_VALUES,
  TERMINAL_LANE_STATUSES,
} from '../../shared/schemas/reviewerLaneState.js';

describe('LANE-OVERWRITE-GUARD-1 — terminalWriteRestrictedToNonTerminal', () => {
  it('restricts every FAILURE-class terminal to non-terminal lanes', () => {
    for (const s of FAILURE_LANE_STATUSES) {
      expect(terminalWriteRestrictedToNonTerminal(s), `${s} should be guarded`).toBe(true);
    }
  });

  it('leaves SUCCESS/feedback terminals unconditional (latest feedback wins)', () => {
    expect(terminalWriteRestrictedToNonTerminal('completed_with_feedback')).toBe(false);
    expect(terminalWriteRestrictedToNonTerminal('completed_without_feedback')).toBe(false);
  });

  it('leaves non-terminal statuses unconditional (they are not failure-class)', () => {
    for (const s of REVIEWER_LANE_STATUS_VALUES) {
      if (!TERMINAL_LANE_STATUSES.has(s)) {
        expect(terminalWriteRestrictedToNonTerminal(s)).toBe(false);
      }
    }
  });

  it('a completed_with_feedback terminal is never failure-class (cannot be clobbered by a later failure)', () => {
    expect(FAILURE_LANE_STATUSES.has('completed_with_feedback')).toBe(false);
  });
});

describe('LANE-OVERWRITE-GUARD-1 — markReviewerLaneTerminal wiring (source audit)', () => {
  const src = readFileSync(
    resolve(__dirname, '../../..', 'src/server/db/queries/reviewerLaneState.ts'),
    'utf8',
  );

  it('conditionally adds the NON_TERMINAL_LANE_STATUSES guard for failure-class writes', () => {
    expect(src).toContain('if (terminalWriteRestrictedToNonTerminal(fields.status)) {');
    expect(src).toContain('conditions.push(inArray(reviewerLanes.status, NON_TERMINAL_LANE_STATUSES));');
    expect(src).toContain('.where(and(...conditions));');
  });
});
