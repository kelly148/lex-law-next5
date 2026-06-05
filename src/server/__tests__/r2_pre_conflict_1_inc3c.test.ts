/**
 * R2-PRE-CONFLICT-1 Inc 3c — consumer audit (constraint G / BLOCK #6) + confirm UX (BLOCK #5).
 *
 * Server-side coverage (source analysis — the repo pattern; no test DB):
 *   - the UNCONFIRMED_PARTY_PROMPT_MARKER constant exists + is worded to stop identity-laundering;
 *   - generateAnalysis injects the marker for UNCONFIRMED parties and presents CONFIRMED ones plainly;
 *   - the screening / clearance / idempotency readers are unchanged (they correctly USE, never VOUCH,
 *     an unconfirmed party).
 * The intake-UI status badge + Confirm button + name advisory are covered by the jsdom render test
 * (src/client/components/__tests__/matterIntakePanel.render.test.tsx) per ci-gotchas #10.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { UNCONFIRMED_PARTY_PROMPT_MARKER } from '../../shared/schemas/layer0.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('R2-PRE-CONFLICT-1 Inc 3c: analysis-prompt marker (constraint G)', () => {
  it('the shared marker constant exists and forbids treating the identity as established', () => {
    expect(UNCONFIRMED_PARTY_PROMPT_MARKER).toContain('UNCONFIRMED');
    expect(UNCONFIRMED_PARTY_PROMPT_MARKER).toContain('identity NOT attorney-verified');
    expect(UNCONFIRMED_PARTY_PROMPT_MARKER.toLowerCase()).toContain('do not treat as established');
  });

  it('generateAnalysis marks UNCONFIRMED parties and presents CONFIRMED ones plainly', () => {
    const intake = read('src/server/procedures/matterIntake.ts');
    const fn = intake.slice(intake.indexOf('generateAnalysis: protectedProcedure'), intake.indexOf('getAnalysis: protectedProcedure'));
    // imports the shared marker (single source of truth — no inline copy)
    expect(intake).toContain('UNCONFIRMED_PARTY_PROMPT_MARKER');
    // branches on p.confirmed: plain line vs marked line
    expect(fn).toContain('p.confirmed ? `- ${p.role}: ${p.displayName}` : `- ${p.role}: ${p.displayName} ${UNCONFIRMED_PARTY_PROMPT_MARKER}`');
  });

  it('screening / clearance / idempotency readers are unchanged (use, never vouch, an unconfirmed party)', () => {
    const conflicts = read('src/server/db/queries/conflicts.ts');
    const partiesQ = read('src/server/db/queries/matterParties.ts');
    // runConflictCheck still screens ALL parties of this matter (no confirmed-filter on the screen)
    expect(conflicts).toContain('const thisParties = (await listPartiesForMatter(matterId, userId)).map(toLite);');
    // clearance still requires a CONFIRMED client (Inc 3a — unchanged)
    expect(conflicts).toContain('clientParties.some((p) => p.confirmed === true)');
    // ensureAutoClientParty existence check is a plain role lookup (does not vouch)
    expect(partiesQ).toContain("parties.some((p) => p.role === 'client')");
  });
});
