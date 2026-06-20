/**
 * uat_f4_reviewer_banner_clear_1.test.ts — REVIEWER-BANNER-CLEAR-1 (F4)
 *
 * Monster UAT U6 (P3): a "reviewer feedback in progress…" banner lingered briefly on the DOCUMENT after a
 * review session was closed. That banner is the document JobBanner (DocumentDetail.tsx) rendering a
 * reviewer_feedback job — `'reviewer_feedback'.replace(/_/g, ' ')` + " in progress…". After the session is
 * abandoned/closed the reviewer jobs are terminal, but the JobBanner's cached job.listForDocument still showed
 * one as active until the next poll (a stale-job/refresh quirk — the same class F1/#328 addresses).
 *
 * Fix: invalidate job.listForDocument on the abandon/close paths in ReviewPane.tsx so the document JobBanner
 * drops the now-terminal reviewer job IMMEDIATELY on close (rather than waiting a poll cycle).
 *   - ActiveSessionView.abandonMutation.onSuccess  (explicit Abandon)
 *   - ReviewPane.autoAbandonMutation.onSuccess + onError  (the X-button auto-abandon close path)
 * The regenerate path is deliberately NOT touched — it starts a NEW regeneration job that must surface.
 *
 * Test strategy: source-analysis tests (node environment), consistent with mr_regenerate_refresh_1.test.ts
 * and mr_uat_progress_1.test.ts — the established convention for onSuccess-invalidation fixes in ReviewPane.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');
function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, 'src', relPath), 'utf-8');
}
const reviewPane = readSrc('client/components/ReviewPane.tsx');

function activeAbandonBlock(): string {
  return reviewPane.slice(
    reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
    reviewPane.indexOf('const updateInstructionsMutation = useGuardedMutation'),
  );
}
function autoAbandonBlock(): string {
  return reviewPane.slice(
    reviewPane.indexOf('const autoAbandonMutation = useGuardedMutation'),
    reviewPane.indexOf('const handleClose ='),
  );
}
function regenerateBlock(): string {
  return reviewPane.slice(
    reviewPane.indexOf('const regenerateMutation = useGuardedMutation'),
    reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
  );
}

// ============================================================
// T-F4-1 — ActiveSessionView abandon clears the document JobBanner
// ============================================================
describe('T-F4-1: ActiveSessionView abandon invalidates job.listForDocument', () => {
  it('abandonMutation onSuccess invalidates job.listForDocument', () => {
    expect(activeAbandonBlock()).toContain('utils.job.listForDocument.invalidate({ documentId })');
  });

  it('abandonMutation onSuccess still invalidates reviewSession.get and calls onClose', () => {
    const block = activeAbandonBlock();
    expect(block).toContain('utils.reviewSession.get.invalidate({ sessionId })');
    expect(block).toContain('onClose()');
  });

  it('the job invalidation is ordered before onClose (cleared before unmount)', () => {
    const block = activeAbandonBlock();
    expect(block.indexOf('utils.job.listForDocument.invalidate')).toBeLessThan(block.indexOf('onClose()'));
  });
});

// ============================================================
// T-F4-2 — X-button auto-abandon close path clears the JobBanner (success AND error)
// ============================================================
describe('T-F4-2: autoAbandonMutation clears job.listForDocument on success and error', () => {
  it('onSuccess invalidates job.listForDocument', () => {
    const block = autoAbandonBlock();
    const onSuccess = block.slice(block.indexOf('onSuccess:'), block.indexOf('onError:'));
    expect(onSuccess).toContain('utils.job.listForDocument.invalidate({ documentId })');
  });

  it('onError still invalidates job.listForDocument then closes (abandon may fail on a terminal session)', () => {
    const block = autoAbandonBlock();
    const onError = block.slice(block.indexOf('onError:'));
    expect(onError).toContain('utils.job.listForDocument.invalidate({ documentId })');
    expect(onError.indexOf('utils.job.listForDocument.invalidate')).toBeLessThan(onError.indexOf('onClose()'));
  });

  it('onSuccess guards the reviewSession.get invalidation on sessionId (may be null pre-create)', () => {
    const block = autoAbandonBlock();
    expect(block).toContain('if (sessionId) void utils.reviewSession.get.invalidate({ sessionId })');
  });
});

// ============================================================
// T-F4-3 — regenerate path is NOT cleared (a new regeneration job must surface)
// ============================================================
describe('T-F4-3: regenerate path is untouched by F4', () => {
  it('regenerateMutation does NOT invalidate job.listForDocument (its new job must show)', () => {
    expect(regenerateBlock()).not.toContain('utils.job.listForDocument.invalidate');
  });

  it('regenerateMutation still invalidates document.get + version.list (MR-REGENERATE-REFRESH-1 preserved)', () => {
    const block = regenerateBlock();
    expect(block).toContain('utils.document.get.invalidate({ documentId })');
    expect(block).toContain('utils.version.list.invalidate({ documentId })');
  });

  it('regenerate block carries no REVIEWER-BANNER-CLEAR-1 tag (kept distinct from F4)', () => {
    expect(regenerateBlock()).not.toContain('REVIEWER-BANNER-CLEAR-1');
  });
});

// ============================================================
// T-F4-4 — engagement marker present
// ============================================================
describe('T-F4-4: REVIEWER-BANNER-CLEAR-1 marker present', () => {
  it('ReviewPane.tsx contains the REVIEWER-BANNER-CLEAR-1 (F4) comment', () => {
    expect(reviewPane).toContain('REVIEWER-BANNER-CLEAR-1');
  });
});
