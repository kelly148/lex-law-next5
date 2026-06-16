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

describe('DOC-PANE-LANE-RUNNING-1 — markReviewerLaneRunning', () => {
  const laneStateSrc = readFileSync(
    resolve(__dirname, '../../..', 'src/server/db/queries/reviewerLaneState.ts'),
    'utf8',
  );
  const canonicalSrc = readFileSync(
    resolve(__dirname, '../../..', 'src/server/db/canonicalMutation.ts'),
    'utf8',
  );
  // EGRESS-CONTROL-PLANE-1 Inc 2: reviewer EXECUTION (incl. the onRunning hook ->
  // markReviewerLaneRunning) moved OUT of reviewSession.ts INTO reviewerJobFactory.ts.
  const reviewerJobFactorySrc = readFileSync(
    resolve(__dirname, '../../..', 'src/server/jobs/reviewerJobFactory.ts'),
    'utf8',
  );

  // (a) source audit of the new writer — guarded to non-terminal, owner-scoped via ownerScope, NEVER eq(userId), NOT a terminal write.
  it('markReviewerLaneRunning is a guarded, owner-scoped, non-terminal write (source audit)', () => {
    expect(laneStateSrc).toContain('export async function markReviewerLaneRunning(');
    expect(laneStateSrc).toContain("status: 'running'");
    expect(laneStateSrc).toContain('inArray(reviewerLanes.status, NON_TERMINAL_LANE_STATUSES)');
    expect(laneStateSrc).toContain('ownerScope(reviewerLanes.userId, userId)');
    // the two CI ratchets forbid the raw eq(userId) form anywhere in this file
    expect(laneStateSrc).not.toMatch(/eq\(reviewerLanes\.userId/);

    // scope to the function body: from its declaration to the next `export async function` after it
    const startIdx = laneStateSrc.indexOf('export async function markReviewerLaneRunning(');
    expect(startIdx).toBeGreaterThan(-1);
    const afterStart = startIdx + 'export async function markReviewerLaneRunning('.length;
    const nextExportRel = laneStateSrc.slice(afterStart).indexOf('export async function');
    const endIdx = nextExportRel === -1 ? laneStateSrc.length : afterStart + nextExportRel;
    const body = laneStateSrc.slice(startIdx, endIdx);
    // 'running' is NON-terminal: the running write must NOT set terminalizedAt
    expect(body).not.toContain('terminalizedAt');
  });

  // (b) pure cross-check: no terminal status overlaps the running-write's matchable (non-terminal) set,
  // proving a running write can never land on a terminal lane.
  it('no TERMINAL status is in the running-write match set [pending,dispatched,running]', () => {
    const nonTerminalMatchSet = ['pending', 'dispatched', 'running'];
    for (const s of TERMINAL_LANE_STATUSES) {
      expect(nonTerminalMatchSet, `${s} must not be matchable by the running write`).not.toContain(s);
    }
  });

  // (c) source audit of canonicalMutation — optional onRunning hook, invoked best-effort AFTER job_started.
  it('canonicalMutation exposes onRunning and fires it best-effort after job_started (source audit)', () => {
    expect(canonicalSrc).toContain('onRunning?:');
    expect(canonicalSrc).toContain('params.onRunning');
    expect(canonicalSrc).toContain('onRunning!(jobId)');
    expect(canonicalSrc).toContain('.catch(');
    // the hook must fire AFTER the job is genuinely claimed/started
    expect(canonicalSrc.indexOf('params.onRunning')).toBeGreaterThan(canonicalSrc.indexOf("'job_started'"));
  });

  // (d) source audit — onRunning wiring gated on the async flag. The reviewer execution closures
  // (incl. onRunning) moved into reviewerJobFactory.ts (Inc 2 durable outbox); there the gate is the
  // factory's `isAsync` param and the lane writer takes `reviewSessionId` (was `sessionId` inline).
  it('reviewerJobFactory wires onRunning -> markReviewerLaneRunning gated on isAsync (source audit)', () => {
    expect(reviewerJobFactorySrc).toContain('markReviewerLaneRunning(reviewSessionId, reviewerRole, userId)');
    expect(reviewerJobFactorySrc).toContain('onRunning:');
    expect(reviewerJobFactorySrc).toContain('markReviewerLaneRunning(');
    expect(reviewerJobFactorySrc).toContain('isAsync');
  });
});
