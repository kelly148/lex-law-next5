/**
 * FOLD-L0-1 Increment 2 — intake/conflicts UI source-audit.
 *
 * The React surface can't be rendered in this no-DOM vitest setup, so this asserts the
 * Fork-A hard acceptance criterion structurally: the false-negative disclosure is shown AT
 * the disposition surface, a BLOCKER requires a rationale before it can be dispositioned,
 * mutations go through useGuardedMutation, and the panel is wired into MatterDetail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFLICT_FALSE_NEGATIVE_DISCLOSURE } from '../../shared/schemas/layer0.js';

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('FOLD-L0-1 Inc2 — intake/conflicts disposition surface (Fork A hard acceptance)', () => {
  const panel = readSrc('../../client/components/MatterIntakePanel.tsx');
  const matterDetail = readSrc('../../client/pages/MatterDetail.tsx');

  it('shows the false-negative disclosure AT the disposition surface (the shared constant, not buried)', () => {
    expect(panel).toMatch(/CONFLICT_FALSE_NEGATIVE_DISCLOSURE/);
    expect(panel).toMatch(/from '\.\.\/\.\.\/shared\/schemas\/layer0\.js'/);
    // the disclosure constant itself must state the name-only limit (single source of truth)
    expect(CONFLICT_FALSE_NEGATIVE_DISCLOSURE).toMatch(/EXACT and NORMALIZED NAME matches/);
  });

  it('a BLOCKER cannot be dispositioned without a rationale (UI gate)', () => {
    expect(panel).toMatch(/needRationale/);
    expect(panel).toMatch(/h\.severity === 'blocker' && rationale\.length === 0/);
    expect(panel).toMatch(/disabled=\{needRationale/);
  });

  it('mutations route through useGuardedMutation (Ch 35.13)', () => {
    expect(panel).toMatch(/useGuardedMutation/);
    expect(panel).toMatch(/matterIntake\.dispositionHit\.mutate/);
    expect(panel).toMatch(/matterIntake\.runConflictCheck\.mutate/);
  });

  it('lock-plan is disabled while conflict hits are still pending (Fork A/C)', () => {
    expect(panel).toMatch(/pendingHits\.length > 0/);
    expect(panel).toMatch(/matterIntake\.lockPlan\.mutate/);
  });

  it('MatterDetail renders the intake panel', () => {
    expect(matterDetail).toMatch(/<MatterIntakePanel matterId=\{matterId\} \/>/);
  });
});
