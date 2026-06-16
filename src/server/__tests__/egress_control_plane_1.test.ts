/**
 * EGRESS-CONTROL-PLANE-1 (Increment 1) — acceptance test suite for the surface-agnostic egress control
 * plane: the document egress adapter (documentEgressSend), the shared auditedEgress primitive, and the
 * scoped-hold evaluator (resolveEffectiveHold).
 *
 * Encodes the triad-disposition acceptance set:
 *   - a no_external hold (matter OR global) blocks a document send, records exactly one BLOCKED row with the
 *     binding holdScope, and does NOT dispatch;
 *   - with no hold + an allowlisted provider, the row is written BEFORE the provider call, the call happens
 *     EXACTLY once, and the row completes 'success';
 *   - an audit-WRITE failure aborts the send (no unlogged egress);
 *   - hold-scope correctness (conversation hold does not bleed onto an unrelated document; matter hold binds
 *     its own matter only);
 *   - hold-check uncertainty (the store throws) fails CLOSED ('hold_check_uncertain');
 *   - store-by-reference: the row stores a HASH, never the draft text; a document send carries no synthetic
 *     conversationId; the CI-guard predicate flags a new raw provider importer.
 *
 * DB-free: setEgressEventStore / setEgressHoldStore inject in-memory stores; setTestLlmAdapter mocks the
 * provider AND counts generate() calls (and the insertion order vs. dispatch). GROUNDED_CHAT_PROVIDERS is
 * set so the sendability provider (anthropic) IS allowlisted on the allowed-path tests, and cleared where
 * provider-not-allowlisted behavior is exercised.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  documentEgressSend,
  DocumentEgressBlockedError,
} from '../egress/documentEgress.js';
import { auditedEgress } from '../egress/auditedEgress.js';
import {
  setEgressEventStore,
  type EgressEventStore,
  type EgressEventCompletionPatch,
  type EgressEventFilter,
} from '../db/queries/egressEvents.js';
import {
  setEgressHoldStore,
  resolveEffectiveHold,
  type EgressHoldStore,
} from '../db/queries/egressHold.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import { GROUNDED_CHAT_PROVIDERS_ENV } from '../llm/chatCopilotConfig.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';
import type { NewEgressEvent, NewEgressHold } from '../db/schema.js';
import type {
  EgressEventRow,
  EgressHoldRow,
  EgressHoldScope,
  EgressSubject,
} from '../../shared/schemas/egress.js';

// ── Fixed ids (valid UUIDs — the subject schema .uuid()-validates matterId/userId/documentId/versionId). ──
const USER_ID = '11111111-1111-1111-1111-111111111111';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MATTER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DOC_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const VERSION_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CONVO_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const HOLD_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

// The sendability classifier model — anthropic (the allowlisted provider for the allowed-path tests).
const MODEL_STRING = 'anthropic:claude-sonnet-4-5';

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory event store — records inserted rows in ORDER (so we can assert the row predates dispatch and
// inspect contents). insert() converts the NewEgressEvent insert shape into a full EgressEventRow, applying
// the DB column defaults (createdAt now, completedAt null) the real Drizzle store would supply.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
interface RecordingEventStore extends EgressEventStore {
  rows: EgressEventRow[];
  insertThrows: boolean;
}

function rowFromInsert(row: NewEgressEvent): EgressEventRow {
  return {
    id: row.id!,
    userId: row.userId!,
    matterId: row.matterId!,
    surface: row.surface!,
    subjectType: row.subjectType!,
    conversationId: row.conversationId ?? null,
    documentId: row.documentId ?? null,
    documentVersionId: row.documentVersionId ?? null,
    jobId: row.jobId ?? null,
    holdScope: row.holdScope ?? null,
    decision: row.decision!,
    blockReason: row.blockReason ?? null,
    provider: row.provider!,
    model: row.model!,
    policyVersion: row.policyVersion ?? null,
    inputBundleHash: row.inputBundleHash ?? null,
    correlationId: row.correlationId!,
    status: row.status ?? 'pending',
    failureReason: row.failureReason ?? null,
    createdAt: new Date(),
    completedAt: null,
  };
}

function makeEventStore(): RecordingEventStore {
  const store: RecordingEventStore = {
    rows: [],
    insertThrows: false,
    insert(row: NewEgressEvent): Promise<EgressEventRow> {
      if (store.insertThrows) {
        return Promise.reject(new Error('audit_write_failed'));
      }
      const full = rowFromInsert(row);
      store.rows.push(full);
      return Promise.resolve(full);
    },
    complete(id: string, _userId: string, patch: EgressEventCompletionPatch): Promise<EgressEventRow | null> {
      const found = store.rows.find((r) => r.id === id);
      if (!found) return Promise.resolve(null);
      found.status = patch.status;
      found.failureReason = patch.failureReason ?? null;
      found.completedAt = patch.completedAt;
      return Promise.resolve(found);
    },
    get(id: string, _userId: string): Promise<EgressEventRow | null> {
      return Promise.resolve(store.rows.find((r) => r.id === id) ?? null);
    },
    list(_userId: string, _filter: EgressEventFilter): Promise<EgressEventRow[]> {
      return Promise.resolve(store.rows.slice());
    },
  };
  return store;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory hold store — preload active holds; listActiveForSubject mirrors the real store's filter
// (global + matter(subjectId=matterId) + conversation(subjectId=conversationId when given)). Set
// `throwOnList` to drive the hold-check-uncertain path.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
interface PreloadHoldStore extends EgressHoldStore {
  holds: EgressHoldRow[];
  throwOnList: boolean;
}

function makeHoldRow(over: Partial<EgressHoldRow> & Pick<EgressHoldRow, 'scope'>): EgressHoldRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    userId: USER_ID,
    subjectId: null,
    matterId: null,
    holdFlag: 'no_external',
    reason: null,
    active: true,
    createdByUserId: HOLD_USER_ID,
    createdAt: new Date(),
    releasedAt: null,
    ...over,
  };
}

function makeHoldStore(): PreloadHoldStore {
  const store: PreloadHoldStore = {
    holds: [],
    throwOnList: false,
    listActiveForSubject(userId: string, matterId: string, conversationId: string | null): Promise<EgressHoldRow[]> {
      if (store.throwOnList) {
        return Promise.reject(new Error('hold_store_unavailable'));
      }
      const matched = store.holds.filter((h) => {
        if (!h.active || h.userId !== userId) return false;
        if (h.scope === 'global') return true;
        if (h.scope === 'matter') return h.subjectId === matterId;
        if (h.scope === 'conversation') return conversationId !== null && h.subjectId === conversationId;
        return false;
      });
      return Promise.resolve(matched);
    },
    insert(_row: NewEgressHold): Promise<void> {
      return Promise.resolve();
    },
  };
  return store;
}

// ── Provider mock — counts generate() calls and captures how many event rows existed at dispatch time
//    (so we can assert the row was recorded BEFORE the provider call). ──
const ADAPTER_RESULT: LlmGenerateResult = {
  content: 'SENDABLE',
  tokensPrompt: 3,
  tokensCompletion: 1,
  providerMetadata: {},
};

interface CountingAdapter extends LlmClient {
  generated: number;
  rowsAtDispatch: number;
}

function makeAdapter(eventStore: RecordingEventStore): CountingAdapter {
  const adapter: CountingAdapter = {
    generated: 0,
    rowsAtDispatch: -1,
    generate(_p: LlmGenerateParams): Promise<LlmGenerateResult> {
      adapter.generated += 1;
      adapter.rowsAtDispatch = eventStore.rows.length;
      return Promise.resolve(ADAPTER_RESULT);
    },
  };
  return adapter;
}

function documentSubject(over: Partial<Extract<EgressSubject, { type: 'document' }>> = {}): EgressSubject {
  return {
    type: 'document',
    subjectId: VERSION_ID,
    matterId: MATTER_A,
    userId: USER_ID,
    documentId: DOC_ID,
    documentVersionId: VERSION_ID,
    ...over,
  };
}

const SENTINEL = 'SENTINEL_DRAFT_TEXT_xyz';

function llmParams(): LlmGenerateParams {
  return { systemPrompt: 'sys', userPrompt: 'classify', signal: new AbortController().signal };
}

let eventStore: RecordingEventStore;
let holdStore: PreloadHoldStore;
let adapter: CountingAdapter;
let savedProvidersEnv: string | undefined;

function setProvidersEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env[GROUNDED_CHAT_PROVIDERS_ENV];
  } else {
    process.env[GROUNDED_CHAT_PROVIDERS_ENV] = value;
  }
}

beforeEach(() => {
  savedProvidersEnv = process.env[GROUNDED_CHAT_PROVIDERS_ENV];
  eventStore = makeEventStore();
  holdStore = makeHoldStore();
  adapter = makeAdapter(eventStore);
  setEgressEventStore(eventStore);
  setEgressHoldStore(holdStore);
  setTestLlmAdapter(adapter);
  // Default: anthropic IS allowlisted (the allowed-path baseline; provider-not-allowlisted tests override).
  setProvidersEnv('anthropic');
});

afterEach(() => {
  setEgressEventStore(null);
  setEgressHoldStore(null);
  setTestLlmAdapter(null);
  setProvidersEnv(savedProvidersEnv);
});

describe('EGRESS-CONTROL-PLANE-1 — documentEgressSend blocking behavior', () => {
  it('1. a MATTER no_external hold blocks the send: rejects, no dispatch, one BLOCKED row (holdScope=matter)', async () => {
    holdStore.holds = [makeHoldRow({ scope: 'matter', subjectId: MATTER_A, matterId: MATTER_A })];

    await expect(
      documentEgressSend({
        subject: documentSubject(),
        surface: 'sendability',
        modelString: MODEL_STRING,
        llmParams: llmParams(),
        serializedPayload: SENTINEL,
      }),
    ).rejects.toBeInstanceOf(DocumentEgressBlockedError);

    expect(adapter.generated).toBe(0); // fail-closed: never dispatched
    expect(eventStore.rows).toHaveLength(1);
    const row = eventStore.rows[0]!;
    expect(row.decision).toBe('blocked');
    expect(row.status).toBe('blocked');
    expect(row.blockReason).toContain('hold_no_external');
    expect(row.holdScope).toBe<EgressHoldScope>('matter');
  });

  it('2. a GLOBAL no_external hold blocks the send (precedence: a global hold binds) — holdScope=global', async () => {
    holdStore.holds = [makeHoldRow({ scope: 'global', subjectId: null, matterId: null })];

    await expect(
      documentEgressSend({
        subject: documentSubject(),
        surface: 'sendability',
        modelString: MODEL_STRING,
        llmParams: llmParams(),
        serializedPayload: SENTINEL,
      }),
    ).rejects.toBeInstanceOf(DocumentEgressBlockedError);

    expect(adapter.generated).toBe(0);
    expect(eventStore.rows).toHaveLength(1);
    const row = eventStore.rows[0]!;
    expect(row.decision).toBe('blocked');
    expect(row.status).toBe('blocked');
    expect(row.blockReason).toContain('hold_no_external');
    expect(row.holdScope).toBe<EgressHoldScope>('global');
  });

  it('4. an audit-WRITE failure aborts the send (no unlogged egress): rejects, generate NOT called', async () => {
    eventStore.insertThrows = true; // recordDecision throws → primitive aborts before dispatch

    await expect(
      documentEgressSend({
        subject: documentSubject(),
        surface: 'sendability',
        modelString: MODEL_STRING,
        llmParams: llmParams(),
        serializedPayload: SENTINEL,
      }),
    ).rejects.toThrow(/audit_write_failed/);

    expect(adapter.generated).toBe(0); // no unlogged egress
    expect(eventStore.rows).toHaveLength(0);
  });

  it('6. hold-check uncertainty (the hold store throws) fails CLOSED: blocked, hold_check_uncertain, no dispatch', async () => {
    holdStore.throwOnList = true; // resolveEffectiveHold throws → uncertain

    await expect(
      documentEgressSend({
        subject: documentSubject(),
        surface: 'sendability',
        modelString: MODEL_STRING,
        llmParams: llmParams(),
        serializedPayload: SENTINEL,
      }),
    ).rejects.toBeInstanceOf(DocumentEgressBlockedError);

    expect(adapter.generated).toBe(0);
    expect(eventStore.rows).toHaveLength(1);
    const row = eventStore.rows[0]!;
    expect(row.decision).toBe('blocked');
    expect(row.status).toBe('blocked');
    expect(row.blockReason).toContain('hold_check_uncertain');
  });
});

describe('EGRESS-CONTROL-PLANE-1 — documentEgressSend allowed behavior', () => {
  it('3. no hold + provider allowlisted: row recorded BEFORE the single dispatch; allowed→success; resolves with the result', async () => {
    const result = await documentEgressSend({
      subject: documentSubject(),
      surface: 'sendability',
      modelString: MODEL_STRING,
      llmParams: llmParams(),
      serializedPayload: SENTINEL,
    });

    expect(adapter.generated).toBe(1); // dispatched EXACTLY once
    expect(adapter.rowsAtDispatch).toBe(1); // the row existed in the store BEFORE generate() ran (record-before-dispatch)
    expect(eventStore.rows).toHaveLength(1);
    const row = eventStore.rows[0]!;
    expect(row.decision).toBe('allowed');
    expect(row.status).toBe('success'); // completed best-effort after the successful dispatch
    expect(row.completedAt).not.toBeNull();
    expect(row.holdScope).toBeNull();
    expect(result).toEqual(ADAPTER_RESULT); // resolves with the provider result
  });

  it('3b. provider NOT allowlisted (env cleared): blocked (provider_not_allowlisted), no dispatch', async () => {
    setProvidersEnv(undefined); // empty allowlist → fail-closed

    await expect(
      documentEgressSend({
        subject: documentSubject(),
        surface: 'sendability',
        modelString: MODEL_STRING,
        llmParams: llmParams(),
        serializedPayload: SENTINEL,
      }),
    ).rejects.toBeInstanceOf(DocumentEgressBlockedError);

    expect(adapter.generated).toBe(0);
    expect(eventStore.rows).toHaveLength(1);
    const row = eventStore.rows[0]!;
    expect(row.decision).toBe('blocked');
    expect(row.blockReason).toContain('provider_not_allowlisted');
  });
});

describe('EGRESS-CONTROL-PLANE-1 — hold-scope correctness (#5)', () => {
  it('5a. a CONVERSATION-scope hold does NOT block an unrelated document send (no conversation in the subject)', async () => {
    // A conversation hold exists, but a document subject carries no conversationId, so it cannot match.
    holdStore.holds = [makeHoldRow({ scope: 'conversation', subjectId: CONVO_ID, matterId: MATTER_A })];

    const result = await documentEgressSend({
      subject: documentSubject(),
      surface: 'sendability',
      modelString: MODEL_STRING,
      llmParams: llmParams(),
      serializedPayload: SENTINEL,
    });

    expect(adapter.generated).toBe(1); // allowed — the conversation hold does not reach the document send
    expect(result).toEqual(ADAPTER_RESULT);
    expect(eventStore.rows[0]!.decision).toBe('allowed');
  });

  it('5b. a MATTER hold for matter M blocks a document send whose subject.matterId === M', async () => {
    holdStore.holds = [makeHoldRow({ scope: 'matter', subjectId: MATTER_A, matterId: MATTER_A })];

    await expect(
      documentEgressSend({
        subject: documentSubject({ matterId: MATTER_A }),
        surface: 'sendability',
        modelString: MODEL_STRING,
        llmParams: llmParams(),
        serializedPayload: SENTINEL,
      }),
    ).rejects.toBeInstanceOf(DocumentEgressBlockedError);

    expect(adapter.generated).toBe(0);
    expect(eventStore.rows[0]!.holdScope).toBe<EgressHoldScope>('matter');
  });

  it('5c. a MATTER hold for a DIFFERENT matter does NOT block (send is for matter A, hold is on matter B)', async () => {
    holdStore.holds = [makeHoldRow({ scope: 'matter', subjectId: MATTER_B, matterId: MATTER_B })];

    const result = await documentEgressSend({
      subject: documentSubject({ matterId: MATTER_A }),
      surface: 'sendability',
      modelString: MODEL_STRING,
      llmParams: llmParams(),
      serializedPayload: SENTINEL,
    });

    expect(adapter.generated).toBe(1); // allowed — the hold is scoped to a different matter
    expect(result).toEqual(ADAPTER_RESULT);
    expect(eventStore.rows[0]!.decision).toBe('allowed');
  });
});

describe('EGRESS-CONTROL-PLANE-1 — store-by-reference + no synthetic conversationId', () => {
  it('7. an allowed document-send row has conversationId null, documentId/versionId set, subjectType document', async () => {
    await documentEgressSend({
      subject: documentSubject(),
      surface: 'sendability',
      modelString: MODEL_STRING,
      llmParams: llmParams(),
      serializedPayload: SENTINEL,
    });

    const row = eventStore.rows[0]!;
    expect(row.conversationId).toBeNull(); // NO synthetic conversationId for a document send
    expect(row.documentId).toBe(DOC_ID);
    expect(row.documentVersionId).toBe(VERSION_ID);
    expect(row.subjectType).toBe('document');
  });

  it('8. the ledger stores a HASH, never the draft text — the sentinel appears in NO field on the row', async () => {
    await documentEgressSend({
      subject: documentSubject(),
      surface: 'sendability',
      modelString: MODEL_STRING,
      llmParams: llmParams(),
      serializedPayload: `prefix ${SENTINEL} suffix`,
    });

    const row = eventStore.rows[0]!;
    // inputBundleHash is a hash — present, and it does NOT equal/contain the sentinel draft text.
    expect(row.inputBundleHash).toBeTruthy();
    expect(row.inputBundleHash).not.toBe(SENTINEL);
    expect(row.inputBundleHash!.includes(SENTINEL)).toBe(false);
    // And NO field on the row carries the sentinel text anywhere.
    const serialized = JSON.stringify(row);
    expect(serialized.includes(SENTINEL)).toBe(false);
  });
});

describe('EGRESS-CONTROL-PLANE-1 — CI-guard predicate (#9, lightweight replica)', () => {
  // The real guard lives in architecture_egress_broker.test.ts; here we replicate ONLY its predicate to
  // demonstrate that a new RAW provider importer outside the chokepoints would be flagged as an offender.
  const REGISTRY_RE = /\/llm\/registry(\.js)?$/;
  const REGISTRY_ALLOWED = ['db/canonicalMutation.ts', 'egress/documentEgress.ts', 'llm/registry.ts'];

  it('9. a new raw `from .../llm/registry.js` import in a non-allowlisted path is an offender', () => {
    // The specifier a raw provider importer would use matches the registry regex...
    expect(REGISTRY_RE.test('../llm/registry.js')).toBe(true);
    expect(REGISTRY_RE.test('../../server/llm/registry.js')).toBe(true);
    // ...and a non-chokepoint path is NOT on the allowlist, so it would be reported as an offender.
    const offender = 'src/server/procedures/foo.ts';
    expect(REGISTRY_ALLOWED.some((a) => offender.endsWith(a))).toBe(false);
    // The approved chokepoint IS on the allowlist (so it is NOT flagged).
    expect(REGISTRY_ALLOWED.some((a) => 'src/server/egress/documentEgress.ts'.endsWith(a))).toBe(true);
  });
});

describe('EGRESS-CONTROL-PLANE-1 — resolveEffectiveHold precedence (evaluator unit)', () => {
  it('returns the MOST-restrictive scope across global > matter > conversation', async () => {
    // All three scopes hold simultaneously for a conversation subject; global must win.
    holdStore.holds = [
      makeHoldRow({ scope: 'conversation', subjectId: CONVO_ID, matterId: MATTER_A }),
      makeHoldRow({ scope: 'matter', subjectId: MATTER_A, matterId: MATTER_A }),
      makeHoldRow({ scope: 'global', subjectId: null, matterId: null }),
    ];
    const conversationSubject: EgressSubject = {
      type: 'conversation',
      subjectId: CONVO_ID,
      matterId: MATTER_A,
      userId: USER_ID,
      conversationId: CONVO_ID,
    };
    const eff = await resolveEffectiveHold(conversationSubject);
    expect(eff.holdFlag).toBe('no_external');
    expect(eff.scope).toBe<EgressHoldScope>('global');
  });

  it('falls back to matter when no global hold, and to conversation when only a conversation hold', async () => {
    // Only matter + conversation → matter wins (matter > conversation).
    holdStore.holds = [
      makeHoldRow({ scope: 'conversation', subjectId: CONVO_ID, matterId: MATTER_A }),
      makeHoldRow({ scope: 'matter', subjectId: MATTER_A, matterId: MATTER_A }),
    ];
    const subject: EgressSubject = {
      type: 'conversation',
      subjectId: CONVO_ID,
      matterId: MATTER_A,
      userId: USER_ID,
      conversationId: CONVO_ID,
    };
    expect((await resolveEffectiveHold(subject)).scope).toBe<EgressHoldScope>('matter');

    // Only a conversation hold → conversation binds.
    holdStore.holds = [makeHoldRow({ scope: 'conversation', subjectId: CONVO_ID, matterId: MATTER_A })];
    expect((await resolveEffectiveHold(subject)).scope).toBe<EgressHoldScope>('conversation');
  });

  it('returns {none, null} when no active no_external hold applies', async () => {
    holdStore.holds = [];
    const eff = await resolveEffectiveHold(documentSubject());
    expect(eff.holdFlag).toBe('none');
    expect(eff.scope).toBeNull();
  });
});

describe('EGRESS-CONTROL-PLANE-1 — auditedEgress primitive (ordering + fail-closed + best-effort)', () => {
  it('records the decision BEFORE dispatch and completes after a successful dispatch', async () => {
    const events: string[] = [];
    const out = await auditedEgress<string>({
      eventId: 'evt-1',
      evaluateHold: () => ({ decision: 'allowed', blockReason: null }),
      recordDecision: () => {
        events.push('record');
        return Promise.resolve();
      },
      onBlocked: (r) => new Error(`blocked:${r}`),
      dispatch: () => {
        events.push('dispatch');
        return Promise.resolve('RESULT');
      },
      completeDecision: () => {
        events.push('complete');
        return Promise.resolve();
      },
    });
    expect(out.result).toBe('RESULT');
    expect(out.eventId).toBe('evt-1');
    expect(events).toEqual(['record', 'dispatch', 'complete']); // record strictly before dispatch
  });

  it('a BLOCKED decision throws WITHOUT dispatching (after the blocked row is recorded)', async () => {
    let recorded = false;
    let dispatched = false;
    await expect(
      auditedEgress<string>({
        eventId: 'evt-2',
        evaluateHold: () => ({ decision: 'blocked', blockReason: 'hold_no_external' }),
        recordDecision: () => {
          recorded = true;
          return Promise.resolve();
        },
        onBlocked: (r) => new Error(`blocked:${r}`),
        dispatch: () => {
          dispatched = true;
          return Promise.resolve('NOPE');
        },
        completeDecision: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/blocked:hold_no_external/);
    expect(recorded).toBe(true); // the blocked row IS recorded first
    expect(dispatched).toBe(false); // ...and dispatch never runs
  });

  it('a recordDecision throw ABORTS the send (no dispatch — no unlogged egress)', async () => {
    let dispatched = false;
    await expect(
      auditedEgress<string>({
        eventId: 'evt-3',
        evaluateHold: () => ({ decision: 'allowed', blockReason: null }),
        recordDecision: () => Promise.reject(new Error('record_failed')),
        onBlocked: (r) => new Error(`blocked:${r}`),
        dispatch: () => {
          dispatched = true;
          return Promise.resolve('NOPE');
        },
        completeDecision: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/record_failed/);
    expect(dispatched).toBe(false);
  });

  it('a completeDecision throw is best-effort: it does NOT mask the successful dispatch result', async () => {
    const out = await auditedEgress<string>({
      eventId: 'evt-4',
      evaluateHold: () => ({ decision: 'allowed', blockReason: null }),
      recordDecision: () => Promise.resolve(),
      onBlocked: (r) => new Error(`blocked:${r}`),
      dispatch: () => Promise.resolve('RESULT'),
      completeDecision: () => Promise.reject(new Error('complete_failed')),
    });
    expect(out.result).toBe('RESULT'); // the completion throw is swallowed; the dispatch result stands
  });
});
