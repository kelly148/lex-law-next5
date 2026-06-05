/**
 * R2-PRE-CONFLICT-1 Inc 3a — affirmative clearance predicate + confirm act (source-analysis).
 *
 * The headline mechanism: replace the overloaded `hasUndispositionedBlocker` boolean with a
 * three-state AFFIRMATIVE predicate (CLEARED only when a check exists, no undispositioned blocker,
 * AND a CONFIRMED role='client' party exists), plus the explicit, logged confirm act. Additive —
 * the predicate is wired into the four transitions in Inc 3b; the consumer audit is Inc 3c. No test
 * DB → source analysis (the repo's pattern).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('R2-PRE-CONFLICT-1 Inc 3a: affirmative clearance predicate + confirm act', () => {
  const conflicts = read('src/server/db/queries/conflicts.ts');
  const parties = read('src/server/db/queries/matterParties.ts');
  const intake = read('src/server/procedures/matterIntake.ts');

  it('evaluateConflictClearance returns a three-state result, never a bare boolean', () => {
    const fn = conflicts.slice(conflicts.indexOf('export async function evaluateConflictClearance'));
    expect(conflicts).toContain("export type ConflictClearanceState = 'CLEARED' | 'BLOCKED' | 'NOT_ESTABLISHED'");
    expect(fn).toContain("return { state: 'NOT_ESTABLISHED', reasons: ['no_conflict_check'] }");
    expect(fn).toContain("return { state: 'BLOCKED', reasons: ['undispositioned_blocker'] }");
    expect(fn).toContain("return { state: 'CLEARED', reasons: [] }");
  });

  it('CLEARED requires a CONFIRMED role=client party; unconfirmed vs absent are distinct states', () => {
    const fn = conflicts.slice(conflicts.indexOf('export async function evaluateConflictClearance'), conflicts.indexOf('export async function isConflictCleared'));
    expect(fn).toContain("clientParties.some((p) => p.confirmed === true)");
    expect(fn).toContain("clientParties.length > 0 ? 'unconfirmed_client_party' : 'no_client_party'");
  });

  it('isConflictCleared is the boolean gate derived from the affirmative state', () => {
    expect(conflicts).toContain("return (await evaluateConflictClearance(matterId, userId)).state === 'CLEARED'");
  });

  it('confirmMatterParty flips confirmed=true with the confirmation stamp (owner-scoped)', () => {
    const fn = parties.slice(parties.indexOf('export async function confirmMatterParty'));
    expect(fn).toContain('confirmed: true, confirmedAt: new Date(), confirmedByUserId: userId');
    expect(fn).toContain('ownerScope(matterParties.userId, userId)');
  });

  it('matterIntake.confirmParty confirms + immutably audits the act (BLOCK #5)', () => {
    const block = intake.slice(intake.indexOf('confirmParty: protectedProcedure'), intake.indexOf('listParties: protectedProcedure'));
    expect(block).toContain('confirmMatterParty(input.partyId, ctx.userId)');
    expect(block).toContain('recordAuditEvent');
    expect(block).toContain("action: 'confirm_party'");
  });
});
