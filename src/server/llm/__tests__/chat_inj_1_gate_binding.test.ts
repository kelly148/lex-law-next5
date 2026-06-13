/**
 * CHAT-INJ-1 — R2/R10 production gate-binding test.
 *
 * The other suites stub the conflicts gate via setChatGateReader. This one closes the load-bearing
 * gap: it proves the DEFAULT (un-seamed) reader delegates to the REAL resolveDraftingGate for the
 * bound matter, so the chat master is bound to the SAME override-aware, fail-closed pass-state
 * drafting uses (R10) — the mechanism by which a bare-default 'law_firm' matter with no cleared gate
 * is never injected (R2 "never the representational default"). resolveDraftingGate itself is mocked
 * (its CONFIRMED-client / override semantics are covered by the conflicts + gate-override suites);
 * here we assert ONLY the wiring: chat -> resolveDraftingGate(matterId, userId) -> .allowed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../db/queries/gateOverride.js', async (orig) => {
  const actual = await orig<typeof import('../../db/queries/gateOverride.js')>();
  return { ...actual, resolveDraftingGate: vi.fn() };
});

import { resolveDraftingGate } from '../../db/queries/gateOverride.js';
import { resolveChatMaster, setChatGateReader } from '../chatMasterComposition.js';
import { MASTER_CLAUDE_LAWFIRM } from '../promptAssets.js';

const FLAG = 'MASTER_CHAT_ENABLED';
const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
// CAPACITY-ELECTION-UX (R3): an AFFIRMATIVELY-ELECTED law_firm seat (marker set) so the decision
// reaches the gate bind under test; an unelected matter would short-circuit before the gate (covered
// by the residual tests in chat_inj_1_master_composition).
const lawFirmMatter = { engagementCapacity: 'law_firm', engagementCapacityElectedAt: new Date('2026-06-13T00:00:00Z'), paKey: null, practiceArea: null };

type GateResult = Awaited<ReturnType<typeof resolveDraftingGate>>;
const gateResult = (allowed: boolean): GateResult =>
  ({
    allowed,
    clearance: { state: allowed ? 'CLEARED' : 'NOT_ESTABLISHED', reasons: allowed ? [] : ['no_client_party'] },
    blockingReasons: [],
    blockingPreconditions: [],
    overriddenPreconditions: [],
    activeOverrides: [],
  } as unknown as GateResult);

let saved: string | undefined;
beforeEach(() => {
  saved = process.env[FLAG];
  process.env[FLAG] = 'true';
  setChatGateReader(null); // use the REAL default reader (delegates to resolveDraftingGate)
  vi.mocked(resolveDraftingGate).mockReset();
});
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
  setChatGateReader(null);
  vi.clearAllMocks();
});

describe('CHAT-INJ-1 — R2/R10 production gate binding (default reader -> resolveDraftingGate)', () => {
  it('consults resolveDraftingGate for EXACTLY the bound matter', async () => {
    vi.mocked(resolveDraftingGate).mockResolvedValue(gateResult(true));
    await resolveChatMaster({ matterId: MATTER, userId: USER, matter: lawFirmMatter, principal: { userId: USER } });
    expect(resolveDraftingGate).toHaveBeenCalledTimes(1);
    expect(resolveDraftingGate).toHaveBeenCalledWith(MATTER, USER);
  });

  it('gate NOT allowed (no cleared/overridden gate) -> neutral, never the representational default', async () => {
    vi.mocked(resolveDraftingGate).mockResolvedValue(gateResult(false));
    const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: lawFirmMatter, principal: { userId: USER } });
    expect(d.inject).toBe(false);
    expect(d.source).toBe('neutral');
    expect(d.reason).toBe('gate_not_cleared');
  });

  it('gate allowed (cleared or attested override) -> injects the representational master', async () => {
    vi.mocked(resolveDraftingGate).mockResolvedValue(gateResult(true));
    const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: lawFirmMatter, principal: { userId: USER } });
    expect(d.inject).toBe(true);
    expect(d.source).toBe(MASTER_CLAUDE_LAWFIRM);
  });

  it('a real resolveDraftingGate throw is fail-closed -> neutral', async () => {
    vi.mocked(resolveDraftingGate).mockRejectedValue(new Error('gate evaluation failed'));
    const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: lawFirmMatter, principal: { userId: USER } });
    expect(d.inject).toBe(false);
    expect(d.reason).toBe('gate_not_cleared');
  });
});
