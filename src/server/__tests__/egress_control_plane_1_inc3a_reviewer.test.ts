/**
 * EGRESS-CONTROL-PLANE-1 Increment 3a — the REVIEWER fan-out is onboarded onto the egress control plane.
 *
 * Inc 1 onboarded sendability; Inc 3a onboards the reviewer surface: the single provider call in
 * canonicalMutation.runJob now routes through documentEgressSend (an `egress` descriptor on the reviewer's
 * canonical params, surface 'reviewer', subject 'document_job') — so the reviewer transmit gets log AND hold
 * from the plane, with runJob's retry/abort/heartbeat machinery riding INSIDE the one decision row.
 *
 * What this suite proves (DB-free — in-memory egress stores + a counting adapter + no-op job writes):
 *   A. documentEgressSend honors the optional `dispatch` OVERRIDE — it uses the supplied dispatch instead of
 *      the internal resolveAdapter(...).generate, still records exactly one pre-dispatch decision row, and
 *      still BLOCKS (no dispatch) under a no_external hold.
 *   B. buildReviewerCanonicalParams ATTACHES the egress descriptor (surface 'reviewer'; a document_job subject
 *      carrying documentVersionId — the send-gate version-binding; an onBlocked hook on the async path).
 *   C. runJob ROUTES an egress-bearing job through the plane: allowed → one provider call + one
 *      'allowed'→'success' row + job completed; a no_external hold → ZERO provider calls + one 'blocked' row +
 *      onBlocked fired + job terminalized 'cancelled' (NOT failed) + txn2Commit/txn2Revert never run.
 *
 * Inc 3b (the hold-blocked-partial send-gate acknowledgment) is OUT of scope.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  documentEgressSend,
  DocumentEgressBlockedError,
} from '../egress/documentEgress.js';
import {
  setEgressEventStore,
  type EgressEventStore,
  type EgressEventCompletionPatch,
  type EgressEventFilter,
} from '../db/queries/egressEvents.js';
import { setEgressHoldStore, type EgressHoldStore } from '../db/queries/egressHold.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import { GROUNDED_CHAT_PROVIDERS_ENV } from '../llm/chatCopilotConfig.js';
import {
  executeCanonicalMutation,
  setJobWriteFunctions,
  type CanonicalMutationParams,
} from '../db/canonicalMutation.js';
import { buildReviewerCanonicalParams, type ReviewerDurableInput } from '../jobs/reviewerJobFactory.js';
import { LlmProviderError, type LlmClient, type LlmGenerateParams, type LlmGenerateResult } from '../llm/types.js';
import type { NewEgressEvent, NewEgressHold } from '../db/schema.js';
import type { EgressEventRow, EgressHoldRow, EgressSubject } from '../../shared/schemas/egress.js';

// ── Fixed ids (valid UUIDs — the subject schema .uuid()-validates matterId/userId/documentId/versionId). ──
const USER_ID = '11111111-1111-1111-1111-111111111111';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DOC_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const VERSION_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const JOB_ID = '99999999-9999-9999-9999-999999999999';
const HOLD_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const MODEL_STRING = 'anthropic:claude-sonnet-4-5'; // anthropic is the allowlisted provider in these tests

// ── In-memory egress_events store — records inserted rows in ORDER. ──
interface RecordingEventStore extends EgressEventStore {
  rows: EgressEventRow[];
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
    insert(row: NewEgressEvent): Promise<EgressEventRow> {
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

// ── In-memory egress_hold store — preload active holds; mirrors the real store's scope filter. ──
interface PreloadHoldStore extends EgressHoldStore {
  holds: EgressHoldRow[];
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
    listActiveForSubject(userId: string, matterId: string, conversationId: string | null): Promise<EgressHoldRow[]> {
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

// ── Counting provider adapter (the resolveAdapter(...).generate target). ──
const ADAPTER_RESULT: LlmGenerateResult = { content: '[]', tokensPrompt: 3, tokensCompletion: 1, providerMetadata: {} };
interface CountingAdapter extends LlmClient {
  generated: number;
}
function makeAdapter(): CountingAdapter {
  const adapter: CountingAdapter = {
    generated: 0,
    generate(_p: LlmGenerateParams): Promise<LlmGenerateResult> {
      adapter.generated += 1;
      return Promise.resolve(ADAPTER_RESULT);
    },
  };
  return adapter;
}

/** Throws a transient (retryable) error for the first `failTimes` calls, then succeeds. */
class FlakyAdapter implements LlmClient {
  public generated = 0;
  constructor(private readonly failTimes: number) {}
  generate(): Promise<LlmGenerateResult> {
    this.generated += 1;
    if (this.generated <= this.failTimes) {
      return Promise.reject(new LlmProviderError('rate_limited', 'transient 429'));
    }
    return Promise.resolve(ADAPTER_RESULT);
  }
}

// ── No-op / recording job writes (mirrors model_reliability_uat_1_retry.test.ts). ──
function makeJobWrites(): {
  jw: Parameters<typeof setJobWriteFunctions>[0];
  calls: { completed: number; cancelled: number; failed: number; timedOut: number };
} {
  const calls = { completed: 0, cancelled: 0, failed: 0, timedOut: 0 };
  const jw = {
    insertJob: async (): Promise<string> => 'job',
    markJobRunning: async (): Promise<number> => 1,
    markJobCompleted: async (): Promise<number> => {
      calls.completed += 1;
      return 1;
    },
    markJobFailed: async (): Promise<void> => {
      calls.failed += 1;
    },
    markJobTimedOut: async (): Promise<void> => {
      calls.timedOut += 1;
    },
    markJobCancelled: async (): Promise<number> => {
      calls.cancelled += 1;
      return 1;
    },
    updateJobHeartbeat: async (): Promise<void> => {},
  };
  return { jw, calls };
}

function documentJobSubject(): EgressSubject {
  return {
    type: 'document_job',
    subjectId: JOB_ID,
    matterId: MATTER_A,
    userId: USER_ID,
    documentId: DOC_ID,
    documentVersionId: VERSION_ID,
    jobId: JOB_ID,
  };
}

function reviewerDurableInput(over: Partial<ReviewerDurableInput> = {}): ReviewerDurableInput {
  return {
    jobId: JOB_ID,
    userId: USER_ID,
    matterId: MATTER_A,
    documentId: DOC_ID,
    documentVersionId: VERSION_ID,
    reviewSessionId: '22222222-2222-2222-2222-222222222222',
    iterationNumber: 0,
    reviewerRole: 'claude',
    reviewerTitle: 'Claude',
    modelString: MODEL_STRING,
    systemPrompt: 'You are a reviewer.',
    userPrompt: 'Review.',
    temperature: 0.4,
    maxTokens: 256,
    timeoutMs: 300_000,
    async: true,
    ...over,
  };
}

let eventStore: RecordingEventStore;
let holdStore: PreloadHoldStore;
let adapter: CountingAdapter;
let savedProvidersEnv: string | undefined;

beforeEach(() => {
  savedProvidersEnv = process.env[GROUNDED_CHAT_PROVIDERS_ENV];
  eventStore = makeEventStore();
  holdStore = makeHoldStore();
  adapter = makeAdapter();
  setEgressEventStore(eventStore);
  setEgressHoldStore(holdStore);
  setTestLlmAdapter(adapter);
  process.env[GROUNDED_CHAT_PROVIDERS_ENV] = 'anthropic';
});

afterEach(() => {
  setEgressEventStore(null);
  setEgressHoldStore(null);
  setTestLlmAdapter(null);
  setJobWriteFunctions(null);
  if (savedProvidersEnv === undefined) {
    delete process.env[GROUNDED_CHAT_PROVIDERS_ENV];
  } else {
    process.env[GROUNDED_CHAT_PROVIDERS_ENV] = savedProvidersEnv;
  }
});

describe('EGRESS Inc 3a — documentEgressSend honors a dispatch override (A)', () => {
  it('uses the supplied dispatch (NOT resolveAdapter); records one allowed→success row', async () => {
    let overrideCalls = 0;
    const OVERRIDE: LlmGenerateResult = { content: 'FROM_OVERRIDE', tokensPrompt: 1, tokensCompletion: 1, providerMetadata: {} };
    const result = await documentEgressSend({
      subject: documentJobSubject(),
      surface: 'reviewer',
      modelString: MODEL_STRING,
      llmParams: { systemPrompt: 's', userPrompt: 'u', signal: new AbortController().signal },
      serializedPayload: 'bundle',
      dispatch: () => {
        overrideCalls += 1;
        return Promise.resolve(OVERRIDE);
      },
    });
    expect(overrideCalls).toBe(1); // the override ran
    expect(adapter.generated).toBe(0); // the internal resolveAdapter().generate did NOT
    expect(result).toEqual(OVERRIDE);
    expect(eventStore.rows).toHaveLength(1);
    expect(eventStore.rows[0]!.surface).toBe('reviewer');
    expect(eventStore.rows[0]!.decision).toBe('allowed');
    expect(eventStore.rows[0]!.status).toBe('success');
  });

  it('a no_external hold BLOCKS: the override is never called, one blocked row, throws', async () => {
    holdStore.holds = [makeHoldRow({ scope: 'matter', subjectId: MATTER_A, matterId: MATTER_A })];
    let overrideCalls = 0;
    await expect(
      documentEgressSend({
        subject: documentJobSubject(),
        surface: 'reviewer',
        modelString: MODEL_STRING,
        llmParams: { systemPrompt: 's', userPrompt: 'u', signal: new AbortController().signal },
        serializedPayload: 'bundle',
        dispatch: () => {
          overrideCalls += 1;
          return Promise.resolve(ADAPTER_RESULT);
        },
      }),
    ).rejects.toBeInstanceOf(DocumentEgressBlockedError);
    expect(overrideCalls).toBe(0); // fail-closed: the dispatch never ran
    expect(eventStore.rows).toHaveLength(1);
    expect(eventStore.rows[0]!.decision).toBe('blocked');
    expect(eventStore.rows[0]!.blockReason).toContain('hold_no_external');
  });

  it('enforceProviderAllowlist:false bypasses the (empty, prod-default) chat-grounding allowlist — reviewer is NOT blocked', async () => {
    delete process.env[GROUNDED_CHAT_PROVIDERS_ENV]; // prod default: empty grounded-chat allowlist
    let overrideCalls = 0;
    const result = await documentEgressSend({
      subject: documentJobSubject(),
      surface: 'reviewer',
      modelString: MODEL_STRING,
      llmParams: { systemPrompt: 's', userPrompt: 'u', signal: new AbortController().signal },
      serializedPayload: 'bundle',
      enforceProviderAllowlist: false, // the reviewer surface — providers are boot-validated, not chat-gated
      dispatch: () => {
        overrideCalls += 1;
        return Promise.resolve(ADAPTER_RESULT);
      },
    });
    expect(overrideCalls).toBe(1); // ALLOWED — the empty chat-grounding allowlist must NOT block the reviewer
    expect(result).toEqual(ADAPTER_RESULT);
    expect(eventStore.rows).toHaveLength(1);
    expect(eventStore.rows[0]!.decision).toBe('allowed');
    expect(eventStore.rows[0]!.status).toBe('success');
  });
});

describe('EGRESS Inc 3a — buildReviewerCanonicalParams attaches the egress descriptor (B)', () => {
  it('surface=reviewer, a document_job subject carrying documentVersionId, async onBlocked present', () => {
    const params = buildReviewerCanonicalParams(reviewerDurableInput({ async: true }));
    expect(params.egress).toBeDefined();
    expect(params.egress!.surface).toBe('reviewer');
    const subj = params.egress!.buildSubject(JOB_ID);
    if (subj.type !== 'document_job') throw new Error(`expected document_job subject, got ${subj.type}`);
    expect(subj.matterId).toBe(MATTER_A);
    expect(subj.documentId).toBe(DOC_ID);
    expect(subj.documentVersionId).toBe(VERSION_ID); // send-gate version-binding rides the subject
    expect(subj.jobId).toBe(JOB_ID);
    const payload = params.egress!.buildSerializedPayload({ systemPrompt: 'SYS_X', userPrompt: 'USR_Y' });
    expect(payload).toContain('SYS_X');
    expect(payload).toContain('USR_Y');
    expect(typeof params.egress!.onBlocked).toBe('function');
  });

  it('the SYNC path (no lanes) omits onBlocked (no lane to mark)', () => {
    const params = buildReviewerCanonicalParams(reviewerDurableInput({ async: false }));
    expect(params.egress).toBeDefined();
    expect(params.egress!.surface).toBe('reviewer');
    expect(params.egress!.onBlocked).toBeUndefined();
  });
});

describe('EGRESS Inc 3a — runJob routes an egress-bearing job through the plane (C)', () => {
  function egressParams(over: {
    txn2Commit?: () => Promise<void>;
    txn2Revert?: () => Promise<void>;
    onBlocked?: (args: { jobId: string; blockReason: string }) => void | Promise<void>;
  }): CanonicalMutationParams {
    return {
      userId: USER_ID,
      jobType: 'reviewer_feedback',
      modelString: MODEL_STRING,
      // No matterId → matter-state / PA-profile injection branches are skipped (no DB).
      txn1Enqueue: async (jobId: string) => ({ jobId }),
      buildLlmParams: () => ({ systemPrompt: 'You are a reviewer.', userPrompt: 'Review.', maxTokens: 256, temperature: 0.4 }),
      egress: {
        surface: 'reviewer',
        enforceProviderAllowlist: false, // reviewer reality: not gated by the chat-grounding allowlist
        buildSubject: () => documentJobSubject(),
        buildSerializedPayload: (lp) => JSON.stringify({ systemPrompt: lp.systemPrompt, userPrompt: lp.userPrompt }),
        ...(over.onBlocked ? { onBlocked: over.onBlocked } : {}),
      },
      txn2Commit: over.txn2Commit ?? (async () => {}),
      txn2Revert: over.txn2Revert ?? (async () => {}),
      telemetryCtx: { userId: USER_ID, matterId: null, documentId: null, jobId: null },
    };
  }

  it('ALLOWED (no hold): one provider call, one allowed→success row, job completed, txn2Commit ran', async () => {
    const { jw, calls } = makeJobWrites();
    setJobWriteFunctions(jw);
    let committed = 0;
    const result = await executeCanonicalMutation(egressParams({ txn2Commit: async () => { committed += 1; } }));

    expect(result.status).toBe('completed');
    expect(adapter.generated).toBe(1); // the single provider dispatch ran (through the plane)
    expect(committed).toBe(1);
    expect(calls.completed).toBe(1);
    expect(calls.cancelled).toBe(0);
    expect(calls.failed).toBe(0);
    expect(eventStore.rows).toHaveLength(1);
    expect(eventStore.rows[0]!.surface).toBe('reviewer');
    expect(eventStore.rows[0]!.decision).toBe('allowed');
    expect(eventStore.rows[0]!.status).toBe('success');
    expect(eventStore.rows[0]!.documentVersionId).toBe(VERSION_ID); // version-binding on the row
  });

  it('HELD (no_external): zero provider calls, one blocked row, onBlocked fired, job cancelled (NOT failed), no commit/revert', async () => {
    holdStore.holds = [makeHoldRow({ scope: 'matter', subjectId: MATTER_A, matterId: MATTER_A })];
    const { jw, calls } = makeJobWrites();
    setJobWriteFunctions(jw);
    let committed = 0;
    let reverted = 0;
    let blockedWith: string | null = null;
    const result = await executeCanonicalMutation(
      egressParams({
        txn2Commit: async () => { committed += 1; },
        txn2Revert: async () => { reverted += 1; },
        onBlocked: ({ blockReason }) => { blockedWith = blockReason; },
      }),
    );

    expect(result.status).toBe('cancelled'); // deliberate withhold — not 'failed'
    expect(result.errorClass).toBe('blocked_by_hold');
    expect(adapter.generated).toBe(0); // fail-closed: never dispatched
    expect(blockedWith).toContain('hold_no_external'); // onBlocked got the reason
    expect(calls.cancelled).toBe(1);
    expect(calls.failed).toBe(0);
    expect(calls.completed).toBe(0);
    expect(committed).toBe(0); // success path skipped
    expect(reverted).toBe(0); // failure path skipped — a hold is NOT a failure
    expect(eventStore.rows).toHaveLength(1);
    expect(eventStore.rows[0]!.decision).toBe('blocked');
    expect(eventStore.rows[0]!.status).toBe('blocked');
    expect(eventStore.rows[0]!.surface).toBe('reviewer');
  });

  it('ALLOWED with the EMPTY (prod-default) chat-grounding allowlist: reviewer still transmits (regression lock)', async () => {
    delete process.env[GROUNDED_CHAT_PROVIDERS_ENV]; // prod default — the reviewer must NOT depend on this
    const { jw, calls } = makeJobWrites();
    setJobWriteFunctions(jw);
    const result = await executeCanonicalMutation(egressParams({}));

    expect(result.status).toBe('completed'); // NOT blocked by the empty chat-grounding allowlist
    expect(adapter.generated).toBe(1);
    expect(calls.completed).toBe(1);
    expect(calls.cancelled).toBe(0);
    expect(eventStore.rows).toHaveLength(1);
    expect(eventStore.rows[0]!.decision).toBe('allowed');
  });

  it('exactly ONE egress_events row across a transient provider RETRY (one decision row, retries inside the dispatch)', async () => {
    const flaky = new FlakyAdapter(1); // fail transiently once, then succeed
    setTestLlmAdapter(flaky);
    const { jw } = makeJobWrites();
    setJobWriteFunctions(jw);
    const result = await executeCanonicalMutation(egressParams({}));

    expect(result.status).toBe('completed');
    expect(flaky.generated).toBe(2); // 1 transient failure + 1 retry that succeeded (retry rode INSIDE the dispatch)
    expect(eventStore.rows).toHaveLength(1); // still exactly ONE egress decision row
    expect(eventStore.rows[0]!.decision).toBe('allowed');
    expect(eventStore.rows[0]!.status).toBe('success');
  });
});
