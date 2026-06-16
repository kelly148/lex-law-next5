/**
 * MR-CAL-3E — Review iteration counter wired server-side (reachable HistorySection)
 *
 * Verifies the wiring that makes the MR-CAL-3C sequential comparison view
 * reachable: review iteration is computed server-side from prior review
 * sessions (advancing across review requests / regeneration cycles) and is
 * decoupled from officialSubstantiveVersionNumber, and the client renders
 * HistorySection against the real persisted session iteration.
 *
 * Source-audit style (the established convention for procedure/UI wiring in
 * this repo — see mr_uat_materials_2.code_audit, mr2.history_heuristic). The
 * underlying advance behavior lives in the pre-existing
 * getNextIterationNumberForDocument query, whose contract is asserted here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

const reviewSession = read('src/server/procedures/reviewSession.ts');
const phase4b = read('src/server/db/queries/phase4b.ts');
const reviewPane = read('src/client/components/ReviewPane.tsx');
// EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox): the reviewer prompt parse + the txn2Commit
// insertFeedback persistence MOVED OUT of reviewSession.create INTO this reusable factory module.
// The server-computed iteration is threaded through ReviewerDurableInput into the factory, so the
// feedback-side half of this audit now reads here (the session-side insert stays in reviewSession.ts).
const reviewerJobFactory = read('src/server/jobs/reviewerJobFactory.ts');

describe('MR-CAL-3E server-side review iteration computation', () => {
  it('reviewSession.create imports and uses getNextIterationNumberForDocument', () => {
    expect(reviewSession).toContain('getNextIterationNumberForDocument');
    expect(reviewSession).toContain(
      'const iterationNumber = await getNextIterationNumberForDocument(input.documentId);',
    );
  });

  it('no longer trusts the client-supplied input.iterationNumber as authoritative', () => {
    // Stale client value (e.g. (officialSubstantiveVersionNumber ?? 0) + 1) must
    // not force the persisted iteration back to 1 once prior sessions exist.
    expect(reviewSession).not.toContain('const iterationNumber = input.iterationNumber;');
  });

  it('persists the server-computed iteration on both the session and feedback', () => {
    // Single iterationNumber variable (server-computed) feeds insertReviewSession
    // (session side, still in reviewSession.create's atomic outbox commit) AND the
    // factory's txn2Commit insertFeedback (feedback side, relocated to
    // reviewerJobFactory by EGRESS-CONTROL-PLANE-1 Inc 2), so feedback shares the
    // session iteration. Intent preserved: ONE server-computed iterationNumber feeds
    // both inserts — the assertion is split across the two files the logic now spans.
    //
    // Session side: insertReviewSession is now called multi-line inside the outbox
    // transaction (`insertReviewSession(\n  {...`) rather than `insertReviewSession({`,
    // and the iterationNumber identifier is passed into it.
    expect(reviewSession).toContain('insertReviewSession(');
    expect(reviewSession).toContain('iterationNumber,');
    // Feedback side: the txn2Commit insertFeedback (now in the factory) is fed the SAME
    // server-computed iterationNumber threaded through ReviewerDurableInput.
    expect(reviewerJobFactory).toContain('insertFeedback({');
    expect(reviewerJobFactory).toContain('iterationNumber,');
  });
});

describe('MR-CAL-3E getNextIterationNumberForDocument advance contract', () => {
  it('counts prior review sessions for the document (not versions)', () => {
    expect(phase4b).toContain('export async function getNextIterationNumberForDocument');
    expect(phase4b).toContain('.from(reviewSessions)');
    expect(phase4b).toContain('eq(reviewSessions.documentId, documentId)');
    expect(phase4b).toContain('desc(reviewSessions.iterationNumber)');
  });

  it('first session is iteration 1; subsequent sessions are max + 1', () => {
    // 1) no prior sessions -> iteration 1
    expect(phase4b).toContain('if (rows.length === 0) return 1;');
    // 2) otherwise advance from the highest existing session iteration
    expect(phase4b).toContain('.iterationNumber) + 1');
  });
});

describe('MR-CAL-3E HistorySection reachability (client uses real session iteration)', () => {
  it('renders HistorySection with the persisted session iteration, not the stale prop', () => {
    expect(reviewPane).toContain(
      '<HistorySection documentId={documentId} currentIterationNumber={session.iterationNumber} />',
    );
    expect(reviewPane).not.toContain('currentIterationNumber={iterationNumber}');
  });

  it('ActiveSessionView no longer threads the stale iterationNumber prop', () => {
    expect(reviewPane).toContain(
      'function ActiveSessionView({ sessionId, documentId, onClose }: ActiveSessionViewProps)',
    );
  });

  it('HistorySection still gates on prior-iteration rows (< current)', () => {
    expect(reviewPane).toContain('fb.iterationNumber < currentIterationNumber');
    expect(reviewPane).toContain('if (priorRows.length === 0) return null');
  });
});
