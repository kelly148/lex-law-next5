/**
 * CHAT-COPILOT-1-GCFG — grounding-config env-drive + per-message isolation hardening.
 *
 * A reversible config/hardening fast-follow on the merged copilot. Proves, with no DB:
 *   - ENV-DRIVE (FAIL-CLOSED): the grounded-chat provider allowlist is sourced from GROUNDED_CHAT_PROVIDERS.
 *     ABSENT / empty / whitespace-only / unparseable => [] (no provider allowed) => grounding inert. A set
 *     value allows ONLY the listed (trimmed + lowercased) provider ids. isGroundedChatProviderAllowed stays
 *     the single chokepoint; the test seam is preserved. (The KEY end-to-end fail-closed test — empty
 *     allowlist => no doc/material text reaches the model — lives in chat_copilot_1_inc34 and still passes,
 *     because the default unset env yields the empty allowlist.)
 *   - OBSERVABILITY: groundedChatStatusLine() is a single NON-SECRET line reflecting OFF/ON + provider ids.
 *   - ISOLATION HARDENING: per-message exclude/redact assert the message's conversation matches the caller's
 *     owner + matter CONTEXT (assertConversationContext), not owner-scope alone. Wrong matter (same owner) or
 *     wrong owner => NOT_FOUND; the correct same-context path is unchanged.
 *
 * The flag-OFF zero-read regression is unchanged by GCFG and stays covered by the Inc 1 / Inc 3+4 suites.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  GROUNDED_CHAT_PROVIDERS_ENV,
  parseGroundedChatProviders,
  isGroundedChatProviderAllowed,
  setGroundedChatProviderAllowlistForTests,
  groundedChatStatusLine,
} from '../llm/chatCopilotConfig.js';
import {
  setChatCopilotStore,
  createConversation,
  appendChatMessage,
  setMessageExcludeFromGrounding,
  redactMessage,
} from '../db/queries/chatCopilot.js';
import { createInMemoryChatCopilotStore } from './inMemoryChatCopilotStore.js';
import type { RichChatTurnInput } from '../llm/chatCopilotPolicy.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MATTER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const lawFirmElected = {
  engagementCapacity: 'law_firm',
  engagementCapacityElectedAt: new Date('2026-06-13T00:00:00Z'),
  paKey: null,
  practiceArea: null,
};

const turn = (over: Partial<RichChatTurnInput> = {}): RichChatTurnInput => ({
  role: 'attorney',
  text: 'Draft a clause about X.',
  masterApplied: false,
  masterSource: null,
  capacitySnapshot: null,
  draftingGateDecisionId: null,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// Env-drive the grounded-chat provider allowlist (FAIL-CLOSED)
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-COPILOT-1-GCFG — env-driven grounded-chat provider allowlist (fail-closed)', () => {
  let savedEnv: string | undefined;
  beforeEach(() => {
    savedEnv = process.env[GROUNDED_CHAT_PROVIDERS_ENV];
    delete process.env[GROUNDED_CHAT_PROVIDERS_ENV];
    setGroundedChatProviderAllowlistForTests(null); // exercise the ENV path, not the test override
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env[GROUNDED_CHAT_PROVIDERS_ENV];
    else process.env[GROUNDED_CHAT_PROVIDERS_ENV] = savedEnv;
    setGroundedChatProviderAllowlistForTests(null);
  });

  it('GROUNDED_CHAT_PROVIDERS ABSENT => allowlist empty => no provider allowed (the KEY fail-closed posture)', () => {
    expect(parseGroundedChatProviders()).toEqual([]);
    expect(isGroundedChatProviderAllowed('anthropic')).toBe(false);
    expect(isGroundedChatProviderAllowed('openai')).toBe(false);
    expect(isGroundedChatProviderAllowed('anything-at-all')).toBe(false);
    expect(groundedChatStatusLine()).toBe('grounded-chat: OFF (allowlist empty)');
  });

  it('GROUNDED_CHAT_PROVIDERS="anthropic" => only anthropic is allowed; openai is not', () => {
    process.env[GROUNDED_CHAT_PROVIDERS_ENV] = 'anthropic';
    expect(parseGroundedChatProviders()).toEqual(['anthropic']);
    expect(isGroundedChatProviderAllowed('anthropic')).toBe(true);
    expect(isGroundedChatProviderAllowed('openai')).toBe(false);
    expect(groundedChatStatusLine()).toBe('grounded-chat: ON (providers: anthropic)');
  });

  it('multiple providers parse (trimmed + lowercased, empties dropped); each is allowed, others are not', () => {
    process.env[GROUNDED_CHAT_PROVIDERS_ENV] = ' Anthropic , ,OpenAI ,, ';
    expect(parseGroundedChatProviders()).toEqual(['anthropic', 'openai']);
    expect(isGroundedChatProviderAllowed('anthropic')).toBe(true);
    expect(isGroundedChatProviderAllowed('openai')).toBe(true);
    expect(isGroundedChatProviderAllowed('OPENAI')).toBe(true); // the query is normalized at the chokepoint
    expect(isGroundedChatProviderAllowed('google')).toBe(false);
    expect(groundedChatStatusLine()).toBe('grounded-chat: ON (providers: anthropic, openai)');
  });

  it('malformed / whitespace-only / empty / comma-only env => FAIL-CLOSED (allowlist empty, nothing allowed)', () => {
    for (const bad of ['', '   ', ',', ' , , ', '\t', '\n', ',,,']) {
      process.env[GROUNDED_CHAT_PROVIDERS_ENV] = bad;
      expect(parseGroundedChatProviders(), `env=${JSON.stringify(bad)}`).toEqual([]);
      expect(isGroundedChatProviderAllowed('anthropic')).toBe(false);
      expect(groundedChatStatusLine()).toBe('grounded-chat: OFF (allowlist empty)');
    }
  });

  it('the test seam still overrides the env (single chokepoint preserved)', () => {
    process.env[GROUNDED_CHAT_PROVIDERS_ENV] = 'anthropic'; // env would allow anthropic ...
    setGroundedChatProviderAllowlistForTests([]); // ... but the override wins -> inert
    expect(isGroundedChatProviderAllowed('anthropic')).toBe(false);
    setGroundedChatProviderAllowlistForTests(['openai']);
    expect(isGroundedChatProviderAllowed('openai')).toBe(true);
    expect(isGroundedChatProviderAllowed('anthropic')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-message isolation hardening: owner + matter CONTEXT (not owner-scope alone)
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-COPILOT-1-GCFG — per-message exclude/redact isolation hardening', () => {
  beforeEach(() => setChatCopilotStore(createInMemoryChatCopilotStore()));
  afterEach(() => setChatCopilotStore(null));

  it('WRONG matter (same owner) and WRONG owner are rejected NOT_FOUND; the correct context is unchanged', async () => {
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected });
    const msg = await appendChatMessage({
      conversationId: conv.id,
      ctx: { userId: U1, matterId: MATTER_A },
      turn: turn({ text: 'bound to matter A' }),
    });

    // wrong MATTER, same owner -> NOT_FOUND (context, not just owner-scope)
    await expect(setMessageExcludeFromGrounding(msg.id, U1, MATTER_B, true)).rejects.toThrow(/not found/i);
    await expect(redactMessage(msg.id, U1, MATTER_B)).rejects.toThrow(/not found/i);

    // wrong OWNER -> NOT_FOUND (the message read is owner-scoped)
    await expect(setMessageExcludeFromGrounding(msg.id, U2, MATTER_A, true)).rejects.toThrow(/not found/i);
    await expect(redactMessage(msg.id, U2, MATTER_A)).rejects.toThrow(/not found/i);

    // the message stayed untouched through every rejected attempt; the correct context still works
    const stillStored = await setMessageExcludeFromGrounding(msg.id, U1, MATTER_A, true);
    expect(stillStored?.excludeFromGrounding).toBe(true);
    expect(stillStored?.content).toBe('bound to matter A');

    // correct owner + matter context: redaction works (unchanged behavior)
    const redacted = await redactMessage(msg.id, U1, MATTER_A);
    expect(redacted?.content).toBeNull();
    expect(redacted?.doNotPersist).toBe(true);
  });
});
