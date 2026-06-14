/**
 * CHAT-COPILOT-2 Increment A — A1 egress control plane (G1/G2/G3/G4 + Q7 supervision).
 *
 * Exercises the broker (egressClient.send) directly: the allowlist is FAIL-CLOSED (empty => every send
 * blocked), an allowlisted provider is dispatched, a 'no_external' hold blocks even an allowlisted
 * provider, image egress is NEVER permitted, there is NO silent provider fallback (a different provider
 * is a separate gated send + a separate event), blocked sends are logged, and the audit log is queryable
 * for supervision (Q7). All DB-free via the egress + canonical store seams.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { egressClient, type EgressAuditContext } from '../llm/egressClient.js';
import { setEgressEventStore, listEgressEvents } from '../db/queries/chatEgress.js';
import { createInMemoryEgressEventStore } from './inMemoryEgressStore.js';
import { setGroundedChatProviderAllowlistForTests } from '../llm/chatCopilotConfig.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import {
  setJobWriteFunctions,
  setMatterStateProvider,
  setPaProfileProvider,
  setPromptSnapshotWriter,
  type CanonicalMutationParams,
} from '../db/canonicalMutation.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

class StubAdapter implements LlmClient {
  generated = 0;
  generate(_p: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.generated += 1;
    return Promise.resolve({ content: 'ok', tokensPrompt: 1, tokensCompletion: 1, providerMetadata: {} });
  }
}

function makeCanonical(modelString = 'anthropic:claude-opus-4-5'): CanonicalMutationParams {
  return {
    userId: U1,
    jobType: 'chat_turn',
    modelString,
    matterId: MATTER_A,
    txn1Enqueue: (jobId) => Promise.resolve({ jobId }),
    buildLlmParams: () => ({ systemPrompt: 'sys', userPrompt: 'hi', maxTokens: 16 }),
    txn2Commit: () => Promise.resolve(),
    txn2Revert: () => Promise.resolve(),
    telemetryCtx: { userId: U1, matterId: MATTER_A, documentId: null, jobId: null },
  };
}

function makeAudit(over: Partial<EgressAuditContext> = {}): EgressAuditContext {
  return {
    kind: 'chat_primary',
    matterId: MATTER_A,
    conversationId: null,
    holdFlag: 'none',
    serializedPayload: 'sys\n\nhi',
    carriesImageEgress: false,
    ...over,
  };
}

let stub: StubAdapter;

beforeEach(() => {
  setEgressEventStore(createInMemoryEgressEventStore());
  stub = new StubAdapter();
  setTestLlmAdapter(stub);
  setJobWriteFunctions({
    insertJob: vi.fn().mockResolvedValue(undefined),
    markJobRunning: vi.fn().mockResolvedValue(1),
    markJobCompleted: vi.fn().mockResolvedValue(undefined),
    markJobFailed: vi.fn().mockResolvedValue(undefined),
    markJobTimedOut: vi.fn().mockResolvedValue(undefined),
    markJobCancelled: vi.fn().mockResolvedValue(1),
    updateJobHeartbeat: vi.fn().mockResolvedValue(undefined),
  });
  setMatterStateProvider(async () => '');
  setPaProfileProvider(async () => null);
  setPromptSnapshotWriter(async () => {});
});

afterEach(() => {
  setEgressEventStore(null);
  setTestLlmAdapter(null);
  setJobWriteFunctions(null);
  setMatterStateProvider(null);
  setPaProfileProvider(null);
  setPromptSnapshotWriter(null);
  setGroundedChatProviderAllowlistForTests(null);
  vi.clearAllMocks();
});

describe('CHAT-COPILOT-2 A1 — egress broker (G1/G2/G3/G4)', () => {
  it('G1 FAIL-CLOSED: an EMPTY allowlist blocks every send + logs a blocked event (no dispatch)', async () => {
    await expect(egressClient.send({ audit: makeAudit(), canonical: makeCanonical() })).rejects.toThrow(
      /EGRESS_BLOCKED:.*provider_not_allowlisted/,
    );
    expect(stub.generated).toBe(0); // never dispatched
    const events = await listEgressEvents(U1, { matterId: MATTER_A });
    expect(events).toHaveLength(1);
    expect(events[0]!.decision).toBe('blocked');
    expect(events[0]!.status).toBe('blocked');
    expect(events[0]!.kind).toBe('chat_primary');
    expect(events[0]!.blockReason).toContain('provider_not_allowlisted');
    // the bundle hash + allowlist fingerprint are recorded even on a blocked send
    expect(events[0]!.inputBundleHash).toBeTruthy();
    expect(events[0]!.allowlistVersion).toBeTruthy();
  });

  it('an ALLOWLISTED provider is dispatched + a success event is logged (decision allowed, status success)', async () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    const r = await egressClient.send({ audit: makeAudit(), canonical: makeCanonical() });
    expect(r.result.status).toBe('completed');
    expect(stub.generated).toBe(1);
    const events = await listEgressEvents(U1, {});
    expect(events).toHaveLength(1);
    expect(events[0]!.decision).toBe('allowed');
    expect(events[0]!.status).toBe('success');
    expect(events[0]!.provider).toBe('anthropic');
    expect(events[0]!.completedAt).not.toBeNull();
  });

  it('G2: holdFlag no_external BLOCKS the send even when the provider is allowlisted (holdHonored logged)', async () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    await expect(
      egressClient.send({ audit: makeAudit({ holdFlag: 'no_external' }), canonical: makeCanonical() }),
    ).rejects.toThrow(/EGRESS_BLOCKED:.*hold_no_external/);
    expect(stub.generated).toBe(0);
    const events = await listEgressEvents(U1, {});
    expect(events[0]!.decision).toBe('blocked');
    expect(events[0]!.holdHonored).toBe(true);
  });

  it('G4: image egress is NEVER permitted — blocked even when allowlisted + no hold', async () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    await expect(
      egressClient.send({ audit: makeAudit({ carriesImageEgress: true }), canonical: makeCanonical() }),
    ).rejects.toThrow(/EGRESS_BLOCKED:.*image_egress_forbidden/);
    expect(stub.generated).toBe(0);
    const events = await listEgressEvents(U1, {});
    expect(events[0]!.decision).toBe('blocked');
  });

  it('NO silent fallback: a different provider is a SEPARATE gated send + a SEPARATE event', async () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']); // openai NOT allowlisted
    const ok = await egressClient.send({ audit: makeAudit(), canonical: makeCanonical('anthropic:claude-opus-4-5') });
    expect(ok.result.status).toBe('completed');
    // a "fallback" to openai does not ride the anthropic gate — it is independently gated (here blocked).
    await expect(
      egressClient.send({ audit: makeAudit(), canonical: makeCanonical('openai:gpt-5') }),
    ).rejects.toThrow(/EGRESS_BLOCKED/);
    const events = await listEgressEvents(U1, {});
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.provider).sort()).toEqual(['anthropic', 'openai']);
    expect(events.find((e) => e.provider === 'anthropic')!.decision).toBe('allowed');
    expect(events.find((e) => e.provider === 'openai')!.decision).toBe('blocked');
  });
});

describe('CHAT-COPILOT-2 A1 — Q7 queryable supervision', () => {
  it('lists egress events by matter + provider, owner-scoped', async () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    await egressClient.send({ audit: makeAudit(), canonical: makeCanonical('anthropic:claude-opus-4-5') });
    await egressClient.send({ audit: makeAudit(), canonical: makeCanonical('anthropic:claude-opus-4-5') });
    expect((await listEgressEvents(U1, { provider: 'anthropic' })).length).toBe(2);
    expect((await listEgressEvents(U1, { matterId: MATTER_A })).length).toBe(2);
    expect((await listEgressEvents(U1, { provider: 'openai' })).length).toBe(0);
    // owner-scoped: another user sees none of U1's events
    expect((await listEgressEvents(U2, {})).length).toBe(0);
  });
});
