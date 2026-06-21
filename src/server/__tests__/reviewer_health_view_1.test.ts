/**
 * REVIEWER-HEALTH-VIEW-1 (5C) — flag accessor + read-only/gating source-audit.
 *
 * The snapshot aggregates over live job/review rows (exercised on the operator's flag-flip), so this locks
 * the flag default-OFF / exact-"true", the router gate (REVIEWER_HEALTH_VIEW_DISABLED), the owner-scoping,
 * and that the query layer is strictly READ-ONLY (no insert/update/delete) with no new egress.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isReviewerHealthViewEnabled } from '../config/featureFlags.js';

const FLAG = 'REVIEWER_HEALTH_VIEW_ENABLED';
let saved: string | undefined;
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
  saved = undefined;
});
function setFlag(v: string | undefined): void {
  saved ??= process.env[FLAG];
  if (v === undefined) delete process.env[FLAG];
  else process.env[FLAG] = v;
}

const root = resolve(__dirname, '../../..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

describe('REVIEWER-HEALTH-VIEW-1 flag', () => {
  it('defaults OFF; ON only for "true"', () => {
    setFlag(undefined);
    expect(isReviewerHealthViewEnabled()).toBe(false);
    setFlag('true');
    expect(isReviewerHealthViewEnabled()).toBe(true);
    for (const v of ['false', 'TRUE', '1', '']) {
      setFlag(v);
      expect(isReviewerHealthViewEnabled()).toBe(false);
    }
  });
});

describe('REVIEWER-HEALTH-VIEW-1 wiring (source-audit)', () => {
  it('the router is flag-gated (ungated isEnabled probe + assertEnabled on the snapshot)', () => {
    const src = read('src/server/procedures/reviewerHealth.ts');
    expect(src).toContain('isEnabled: protectedProcedure.query(() => ({ enabled: isReviewerHealthViewEnabled() }))');
    expect(src).toContain('REVIEWER_HEALTH_VIEW_DISABLED');
    expect(src).toContain('assertEnabled();');
  });
  it('the query layer is owner-scoped and strictly READ-ONLY (no mutation, no egress)', () => {
    const q = read('src/server/db/queries/reviewerHealth.ts');
    expect(q).toContain('ownerScope(jobs.userId, userId)');
    expect(q).toContain('ownerScope(reviewSessions.userId, userId)');
    // read-only: no write verbs
    expect(q).not.toMatch(/db\.(insert|update|delete)\(/);
  });
  it('the router is mounted + the page/route/nav are wired', () => {
    expect(read('src/server/router.ts')).toContain('reviewerHealth: reviewerHealthRouter');
    expect(read('src/client/App.tsx')).toContain('path="/diagnostics"');
    expect(read('src/client/components/AppShell.tsx')).toContain('trpc.reviewerHealth.isEnabled.useQuery()');
    expect(read('src/client/components/AppShell.tsx')).toContain('to="/diagnostics"');
  });
});
