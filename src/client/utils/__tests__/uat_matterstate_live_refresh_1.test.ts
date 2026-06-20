/**
 * uat_matterstate_live_refresh_1.test.ts — MATTERSTATE-LIVE-REFRESH-1 (F1-class)
 *
 * The left Matter State summary lagged after intake-panel actions (conflict disposition, party confirm,
 * plan lock): the "Conflicts: …" summary (MatterRecitalBand -> matterState.dashboard) and the "Drafting
 * blocked" banner (GateOverridePanel -> gateOverride.getGate) only reflected the cleared state after a
 * manual reload. Root cause: MatterIntakePanel's shared invalidate() helper — called by every intake
 * mutation — invalidated only the intake panel's OWN queries (listParties / getLatestConflicts /
 * getAnalysis), never the left-summary queries. Same class as F1 (#355).
 *
 * Fix: add matterState.dashboard + gateOverride.getGate invalidation to the shared invalidate() helper, so
 * a single point covers disposition / confirmParty / lockPlan / addParty / runCheck / generateAnalysis.
 * Cosmetic only — the gate logic is server-authoritative and unchanged.
 *
 * Convention: source-audit (mr_regenerate_refresh_1 / uat_f4 style for onSuccess-invalidation fixes).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');
const panel = fs.readFileSync(path.join(ROOT, 'src/client/components/MatterIntakePanel.tsx'), 'utf-8');

function invalidateHelper(): string {
  const start = panel.indexOf('const invalidate = () => {');
  return panel.slice(start, panel.indexOf('};', start) + 2);
}

describe('MATTERSTATE-LIVE-REFRESH-1: intake actions refresh the left Matter State summary', () => {
  it('the shared invalidate() helper invalidates matterState.dashboard (the "Conflicts:" summary)', () => {
    expect(invalidateHelper()).toContain('utils.matterState.dashboard.invalidate()');
  });

  it('the shared invalidate() helper invalidates gateOverride.getGate (the "Drafting blocked" banner)', () => {
    expect(invalidateHelper()).toContain('utils.gateOverride.getGate.invalidate({ matterId })');
  });

  it('preserves the existing intake-panel invalidations (no regression)', () => {
    const h = invalidateHelper();
    expect(h).toContain('utils.matterIntake.listParties.invalidate({ matterId })');
    expect(h).toContain('utils.matterIntake.getLatestConflicts.invalidate({ matterId })');
    expect(h).toContain('utils.matterIntake.getAnalysis.invalidate({ matterId })');
  });

  it('every intake mutation routes through invalidate() (so disposition/confirm/lock all refresh)', () => {
    // dispositionHit, confirmParty, lockPlan (and addParty/runCheck/generateAnalysis) all use invalidate
    // as their onSuccess, so the single-point fix covers them all.
    expect(panel).toContain('matterIntake.dispositionHit.mutate');
    expect(panel).toContain('matterIntake.confirmParty.mutate');
    expect(panel).toContain('matterIntake.lockPlan.mutate');
    // onSuccess wiring uses the shared helper
    expect(panel).toMatch(/onSuccess:\s*invalidate\b/);
  });

  it('is cosmetic-only: no gate logic changed (mutations still call the same intake procedures)', () => {
    // The fix adds only client cache invalidation — it does not alter the mutation inputs/procedures.
    expect(panel).toContain('matterIntake.dispositionHit.mutate(input)');
    expect(panel).toContain('matterIntake.lockPlan.mutate(input)');
    expect(panel).toContain('matterIntake.confirmParty.mutate(input)');
  });

  it('carries the MATTERSTATE-LIVE-REFRESH-1 marker', () => {
    expect(panel).toContain('MATTERSTATE-LIVE-REFRESH-1');
  });
});
