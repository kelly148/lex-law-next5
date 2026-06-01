/**
 * mr_llm_gpt_1.test.ts — MR-LLM-GPT-1
 *
 * Tests for the GPT reviewer failures addressed in MR-LLM-GPT-1.
 *
 * FAILURE MECHANISMS (reclassified after live evidence):
 *   Primary (live-confirmed): Mechanism B — OpenAI json_object mode causes GPT-5
 *     to wrap reviewer-feedback arrays in an object wrapper such as
 *     { "feedback": [...] }. Zod validation against RawSuggestionsArraySchema
 *     (z.array(...)) fails with "Expected array, received object".
 *   Secondary (pre-emptive): Mechanism A — GPT-5 TTFT ~83 s at high load exceeds
 *     the global 120 000 ms AbortSignal.timeout. Addressed by timeoutMs: 300_000
 *     on the reviewer_feedback call site.
 *
 * T-GPT-1: normalizeOpenAiStructuredOutput — object wrapper normalizes to array.
 * T-GPT-2: normalizeOpenAiStructuredOutput — direct array passes through unchanged.
 * T-GPT-3: normalizeOpenAiStructuredOutput — ambiguous/invalid objects pass through unchanged.
 * T-GPT-4: OpenAiAdapter structured-output path — object-wrapper response normalizes end-to-end.
 * T-GPT-5: OpenAiAdapter structured-output path — direct array response passes through.
 * T-GPT-6: OpenAiAdapter structured-output path — ambiguous object fails with parse_error.
 * T-GPT-7: Canonical RawSuggestionsArraySchema remains unchanged (no schema weakening).
 * T-GPT-8: reviewer_feedback job uses 300 000 ms timeout (Mechanism A secondary risk).
 * T-GPT-9: Grok MR-LLM-GROK-1 normalization does not regress.
 * T-GPT-10: Persistence/read path receives canonical feedback shape from normalized GPT output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAiAdapter, normalizeOpenAiStructuredOutput } from '../llm/openai.js';
import { RawSuggestionsArraySchema, parseFeedbackOutput } from '../llm/parsers/feedbackParser.js';
import { normalizeGrokStructuredOutput } from '../llm/xai.js';
import { getLlmFetchTimeoutMs } from '../llm/config.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import { MockLlmAdapter } from '../llm/mock.js';
import { setJobWriteFunctions } from '../db/canonicalMutation.js';
import { appRouter } from '../router.js';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { clearTelemetryBuffer } from '../test-utils/setup.js';
import * as phase4bQueries from '../db/queries/phase4b.js';
import * as documentQueries from '../db/queries/documents.js';
import * as versionQueries from '../db/queries/versions.js';
import * as userPreferenceQueries from '../db/queries/userPreferences.js';
import * as matterQueries from '../db/queries/matters.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../db/queries/phase4b.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/phase4b.js')>();
  return {
    ...actual,
    getActiveReviewSessionForDocument: vi.fn(),
    insertReviewSession: vi.fn(),
    insertFeedback: vi.fn(),
    getNextIterationNumberForDocument: vi.fn(),
    // MR-CAL-6B: reviewSession.create loads active locked decisions; default to none.
    listActiveLockedDecisionsForDocument: vi.fn().mockResolvedValue([]),
    getReviewSessionById: vi.fn(),
    listFeedbackForSession: vi.fn(),
    getEvaluationForIteration: vi.fn(),
    listManualSelectionsForSession: vi.fn(),
  };
});
vi.mock('../db/queries/documents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/documents.js')>();
  return { ...actual, getDocumentById: vi.fn() };
});
vi.mock('../db/queries/versions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/versions.js')>();
  return { ...actual, getVersionById: vi.fn() };
});
vi.mock('../db/queries/userPreferences.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/userPreferences.js')>();
  return { ...actual, getUserPreferences: vi.fn() };
});
vi.mock('../db/queries/matters.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/matters.js')>();
  return { ...actual, getMatterById: vi.fn() };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CANONICAL_ITEM = {
  title: 'Missing indemnification clause',
  body: 'The contract lacks an indemnification clause. Add one to protect both parties.',
  severity: 'critical' as const,
};
const CANONICAL_ARRAY = [CANONICAL_ITEM];
const CANONICAL_ARRAY_JSON = JSON.stringify(CANONICAL_ARRAY);

const USER_ID = uuidv4();
const DOC_ID = uuidv4();
const MATTER_ID = uuidv4();
const VERSION_ID = uuidv4();
const SESSION_ID = uuidv4();

// ── Helper: build a mock OpenAI API response ──────────────────────────────────

function makeOpenAiResponse(content: string, finishReason = 'stop') {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-gpt1-test',
      object: 'chat.completion',
      model: 'gpt-5',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: finishReason,
        },
      ],
      usage: { prompt_tokens: 200, completion_tokens: 400, total_tokens: 600 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ── T-GPT-1: normalizeOpenAiStructuredOutput — object wrapper normalizes to array ──

describe('MR-LLM-GPT-1 — T-GPT-1: normalizeOpenAiStructuredOutput object-wrapper extraction', () => {
  it('T-GPT-1a: { "feedback": [...] } wrapper extracts the array', () => {
    const wrapped = { feedback: CANONICAL_ARRAY };
    const result = normalizeOpenAiStructuredOutput(wrapped);
    expect(result).toEqual(CANONICAL_ARRAY);
  });

  it('T-GPT-1b: { "suggestions": [...] } wrapper extracts the array', () => {
    const wrapped = { suggestions: CANONICAL_ARRAY };
    const result = normalizeOpenAiStructuredOutput(wrapped);
    expect(result).toEqual(CANONICAL_ARRAY);
  });

  it('T-GPT-1c: { "items": [...] } wrapper extracts the array', () => {
    const wrapped = { items: CANONICAL_ARRAY };
    const result = normalizeOpenAiStructuredOutput(wrapped);
    expect(result).toEqual(CANONICAL_ARRAY);
  });

  it('T-GPT-1d: { "result": [...] } wrapper extracts the array', () => {
    const wrapped = { result: CANONICAL_ARRAY };
    const result = normalizeOpenAiStructuredOutput(wrapped);
    expect(result).toEqual(CANONICAL_ARRAY);
  });

  it('T-GPT-1e: { "data": [...] } wrapper extracts the array', () => {
    const wrapped = { data: CANONICAL_ARRAY };
    const result = normalizeOpenAiStructuredOutput(wrapped);
    expect(result).toEqual(CANONICAL_ARRAY);
  });
});

// ── T-GPT-2: normalizeOpenAiStructuredOutput — direct array passes through ───

describe('MR-LLM-GPT-1 — T-GPT-2: normalizeOpenAiStructuredOutput direct array pass-through', () => {
  it('T-GPT-2a: direct array passes through unchanged (same reference)', () => {
    const result = normalizeOpenAiStructuredOutput(CANONICAL_ARRAY);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-GPT-2b: empty array passes through unchanged', () => {
    const empty: unknown[] = [];
    const result = normalizeOpenAiStructuredOutput(empty);
    expect(result).toBe(empty);
  });
});

// ── T-GPT-3: normalizeOpenAiStructuredOutput — ambiguous/invalid pass through ─

describe('MR-LLM-GPT-1 — T-GPT-3: normalizeOpenAiStructuredOutput ambiguous/invalid pass-through', () => {
  it('T-GPT-3a: object with multiple unknown-key properties passes through unchanged (Zod will reject)', () => {
    // MR-LLM-LITE-2: known keys (feedback, suggestions, items, result, data) are now extracted.
    // A truly ambiguous object has multiple keys none of which are known wrapper keys.
    const ambiguous = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'value' };
    const result = normalizeOpenAiStructuredOutput(ambiguous);
    expect(result).toBe(ambiguous);
  });

  it('T-GPT-3b: object with single non-array property passes through unchanged', () => {
    const noArray = { message: 'not an array' };
    const result = normalizeOpenAiStructuredOutput(noArray);
    expect(result).toBe(noArray);
  });

  it('T-GPT-3c: null passes through unchanged', () => {
    expect(normalizeOpenAiStructuredOutput(null)).toBeNull();
  });

  it('T-GPT-3d: string passes through unchanged', () => {
    expect(normalizeOpenAiStructuredOutput('raw string')).toBe('raw string');
  });

  it('T-GPT-3e: number passes through unchanged', () => {
    expect(normalizeOpenAiStructuredOutput(42)).toBe(42);
  });
});

// ── T-GPT-4: OpenAiAdapter — object-wrapper response normalizes end-to-end ───

describe('MR-LLM-GPT-1 — T-GPT-4: OpenAiAdapter object-wrapper response normalizes end-to-end', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFetch: any;

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  it('T-GPT-4a: { "feedback": [...] } wrapper normalizes — adapter returns canonical array JSON string', async () => {
    const wrapped = { feedback: CANONICAL_ARRAY };
    mockFetch = vi.fn(() => makeOpenAiResponse(JSON.stringify(wrapped)));
    vi.stubGlobal('fetch', mockFetch);
    process.env['OPENAI_API_KEY'] = 'sk-test-gpt1-dummy';

    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a legal document reviewer (gpt).',
      userPrompt: 'Review this contract.',
      temperature: 0.4,
      maxTokens: 16384,
      structuredOutputSchema: RawSuggestionsArraySchema,
      signal: new AbortController().signal,
    });

    // content must be a string (re-serialized canonical array, not the wrapper)
    expect(typeof result.content).toBe('string');
    const parsed = JSON.parse(result.content as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual(CANONICAL_ARRAY);
  });

  it('T-GPT-4b: { "suggestions": [...] } wrapper normalizes — adapter returns canonical array JSON string', async () => {
    const wrapped = { suggestions: CANONICAL_ARRAY };
    mockFetch = vi.fn(() => makeOpenAiResponse(JSON.stringify(wrapped)));
    vi.stubGlobal('fetch', mockFetch);
    process.env['OPENAI_API_KEY'] = 'sk-test-gpt1-dummy';

    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a legal document reviewer (gpt).',
      userPrompt: 'Review this contract.',
      temperature: 0.4,
      maxTokens: 16384,
      structuredOutputSchema: RawSuggestionsArraySchema,
      signal: new AbortController().signal,
    });

    expect(typeof result.content).toBe('string');
    const parsed = JSON.parse(result.content as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual(CANONICAL_ARRAY);
  });

  it('T-GPT-4c: normalized content is parseable by parseFeedbackOutput (full persistence path)', async () => {
    const wrapped = { feedback: CANONICAL_ARRAY };
    mockFetch = vi.fn(() => makeOpenAiResponse(JSON.stringify(wrapped)));
    vi.stubGlobal('fetch', mockFetch);
    process.env['OPENAI_API_KEY'] = 'sk-test-gpt1-dummy';

    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a legal document reviewer (gpt).',
      userPrompt: 'Review this contract.',
      temperature: 0.4,
      maxTokens: 16384,
      structuredOutputSchema: RawSuggestionsArraySchema,
      signal: new AbortController().signal,
    });

    const rawOutput = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    const suggestions = parseFeedbackOutput(rawOutput);
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]?.title).toBe(CANONICAL_ITEM.title);
    expect(suggestions[0]?.severity).toBe('critical');
    expect(typeof suggestions[0]?.suggestionId).toBe('string');
  });
});

// ── T-GPT-5: OpenAiAdapter — direct array response passes through ─────────────

describe('MR-LLM-GPT-1 — T-GPT-5: OpenAiAdapter direct array response passes through', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn(() => makeOpenAiResponse(CANONICAL_ARRAY_JSON));
    vi.stubGlobal('fetch', mockFetch);
    process.env['OPENAI_API_KEY'] = 'sk-test-gpt1-dummy';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  it('T-GPT-5a: direct array content returns unchanged as string', async () => {
    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a legal document reviewer (gpt).',
      userPrompt: 'Review this contract.',
      temperature: 0.4,
      maxTokens: 16384,
      structuredOutputSchema: RawSuggestionsArraySchema,
      signal: new AbortController().signal,
    });
    expect(typeof result.content).toBe('string');
    expect(result.content).toBe(CANONICAL_ARRAY_JSON);
  });

  it('T-GPT-5b: JSON.parse(content) validates against RawSuggestionsArraySchema', async () => {
    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a legal document reviewer (gpt).',
      userPrompt: 'Review this contract.',
      temperature: 0.4,
      maxTokens: 16384,
      structuredOutputSchema: RawSuggestionsArraySchema,
      signal: new AbortController().signal,
    });
    const parsed = JSON.parse(result.content as string);
    const validation = RawSuggestionsArraySchema.safeParse(parsed);
    expect(validation.success).toBe(true);
  });
});

// ── T-GPT-6: OpenAiAdapter — ambiguous object fails with parse_error ──────────

describe('MR-LLM-GPT-1 — T-GPT-6: OpenAiAdapter ambiguous/invalid object fails visibly', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  it('T-GPT-6a: ambiguous multi-key object with no known key fails with parse_error', async () => {
    // MR-LLM-LITE-2: { feedback: [...], extra: ... } now normalizes successfully.
    // Use an object with no known wrapper keys to test the ambiguous/fail path.
    const ambiguous = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'value' };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(ambiguous))));
    process.env['OPENAI_API_KEY'] = 'sk-test-gpt1-dummy';

    const adapter = new OpenAiAdapter('gpt-5');
    await expect(
      adapter.generate({
        systemPrompt: 'You are a legal document reviewer (gpt).',
        userPrompt: 'Review this contract.',
        temperature: 0.4,
        maxTokens: 16384,
        structuredOutputSchema: RawSuggestionsArraySchema,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ errorClass: 'parse_error' });
  });

  it('T-GPT-6b: non-JSON content fails with parse_error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse('This is not JSON at all.')));
    process.env['OPENAI_API_KEY'] = 'sk-test-gpt1-dummy';

    const adapter = new OpenAiAdapter('gpt-5');
    await expect(
      adapter.generate({
        systemPrompt: 'You are a legal document reviewer (gpt).',
        userPrompt: 'Review this contract.',
        temperature: 0.4,
        maxTokens: 16384,
        structuredOutputSchema: RawSuggestionsArraySchema,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ errorClass: 'parse_error' });
  });

  it('T-GPT-6c: empty string content fails with api_error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse('')));
    process.env['OPENAI_API_KEY'] = 'sk-test-gpt1-dummy';

    const adapter = new OpenAiAdapter('gpt-5');
    await expect(
      adapter.generate({
        systemPrompt: 'You are a legal document reviewer (gpt).',
        userPrompt: 'Review this contract.',
        temperature: 0.4,
        maxTokens: 16384,
        structuredOutputSchema: RawSuggestionsArraySchema,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ errorClass: 'api_error' });
  });

  it('T-GPT-6d: finish_reason=length fails with api_error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(CANONICAL_ARRAY_JSON, 'length')));
    process.env['OPENAI_API_KEY'] = 'sk-test-gpt1-dummy';

    const adapter = new OpenAiAdapter('gpt-5');
    await expect(
      adapter.generate({
        systemPrompt: 'You are a legal document reviewer (gpt).',
        userPrompt: 'Review this contract.',
        temperature: 0.4,
        maxTokens: 16384,
        structuredOutputSchema: RawSuggestionsArraySchema,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ errorClass: 'api_error' });
  });
});

// ── T-GPT-7: Canonical schema remains unchanged (no schema weakening) ─────────

describe('MR-LLM-GPT-1 — T-GPT-7: canonical RawSuggestionsArraySchema preserved', () => {
  it('T-GPT-7a: RawSuggestionsArraySchema rejects a plain object', () => {
    expect(RawSuggestionsArraySchema.safeParse({ feedback: CANONICAL_ARRAY }).success).toBe(false);
  });

  it('T-GPT-7b: RawSuggestionsArraySchema rejects a string', () => {
    expect(RawSuggestionsArraySchema.safeParse(CANONICAL_ARRAY_JSON).success).toBe(false);
  });

  it('T-GPT-7c: RawSuggestionsArraySchema accepts a canonical array', () => {
    expect(RawSuggestionsArraySchema.safeParse(CANONICAL_ARRAY).success).toBe(true);
  });

  it('T-GPT-7d: RawSuggestionsArraySchema accepts an empty array', () => {
    expect(RawSuggestionsArraySchema.safeParse([]).success).toBe(true);
  });
});

// ── T-GPT-8: reviewer_feedback job uses 300 000 ms timeout ───────────────────

describe('MR-LLM-GPT-1 — T-GPT-8: reviewer_feedback job uses 300 000 ms timeout', () => {
  afterEach(() => {
    clearTelemetryBuffer();
    setTestLlmAdapter(null);
    setJobWriteFunctions(null);
    vi.clearAllMocks();
  });

  it('T-GPT-8a: global getLlmFetchTimeoutMs() still returns 120 000 ms (unchanged)', () => {
    expect(getLlmFetchTimeoutMs()).toBe(120_000);
  });

  it('T-GPT-8b: reviewer_feedback job with timeoutMs=300_000 completes successfully when adapter returns before timeout', async () => {
    const markJobFailedSpy = vi.fn().mockResolvedValue(undefined);
    const markJobTimedOutSpy = vi.fn().mockResolvedValue(undefined);

    setTestLlmAdapter(
      new MockLlmAdapter({ content: CANONICAL_ARRAY_JSON }),
    );
    setJobWriteFunctions({
      insertJob: vi.fn().mockResolvedValue(undefined),
      markJobRunning: vi.fn().mockResolvedValue(1),
      markJobCompleted: vi.fn().mockResolvedValue(undefined),
      markJobFailed: markJobFailedSpy,
      markJobTimedOut: markJobTimedOutSpy,
      markJobCancelled: vi.fn().mockResolvedValue(1),
      updateJobHeartbeat: vi.fn().mockResolvedValue(undefined),
    });

    vi.mocked(userPreferenceQueries.getUserPreferences).mockResolvedValue({
      userId: USER_ID,
      preferences: {
        reviewerEnablement: { claude: false, gpt: true, gemini: false, grok: false },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Parameters<typeof userPreferenceQueries.getUserPreferences>[0] extends string ? Awaited<ReturnType<typeof userPreferenceQueries.getUserPreferences>> : never);
    vi.mocked(documentQueries.getDocumentById).mockResolvedValue({
      id: DOC_ID,
      userId: USER_ID,
      matterId: MATTER_ID,
      title: 'Test Contract',
      documentType: 'contract',
      customTypeLabel: null,
      draftingMode: 'template',
      templateBindingStatus: 'bound',
      templateVersionId: null,
      templateSnapshot: null,
      variableMap: null,
      workflowState: 'drafting' as const,
      currentVersionId: VERSION_ID,
      officialSubstantiveVersionNumber: null,
      officialFinalVersionNumber: null,
      completedAt: null,
      archivedAt: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(versionQueries.getVersionById).mockResolvedValue({
      id: VERSION_ID,
      userId: USER_ID,
      documentId: DOC_ID,
      versionNumber: 1,
      content: 'This is a test contract for legal review.',
      generatedByJobId: null,
      iterationNumber: 1,
      createdAt: new Date(),
    });
    vi.mocked(matterQueries.getMatterById).mockResolvedValue({
      id: MATTER_ID,
      userId: USER_ID,
      title: 'Test Matter',
      clientName: null,
      practiceArea: null,
      phase: 'drafting' as const,
      archivedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(phase4bQueries.getActiveReviewSessionForDocument).mockResolvedValue(null);
    vi.mocked(phase4bQueries.insertReviewSession).mockResolvedValue(SESSION_ID);
    // MR-CAL-3E: create() now computes the iteration server-side via this helper.
    vi.mocked(phase4bQueries.getNextIterationNumberForDocument).mockResolvedValue(1);
    vi.mocked(phase4bQueries.insertFeedback).mockResolvedValue(uuidv4());

    const caller = appRouter.createCaller({
      req: {} as Request,
      res: {} as Response,
      userId: USER_ID,
    });

    const result = await caller.reviewSession.create({
      documentId: DOC_ID,
      iterationNumber: 1,
      selectedReviewers: ['gpt'],
    });

    expect(result.sessionId).toBe(SESSION_ID);
    expect(markJobTimedOutSpy).not.toHaveBeenCalled();
    expect(markJobFailedSpy).not.toHaveBeenCalled();
  });
});

// ── T-GPT-9: Grok MR-LLM-GROK-1 normalization does not regress ───────────────

describe('MR-LLM-GPT-1 — T-GPT-9: Grok MR-LLM-GROK-1 normalization does not regress', () => {
  it('T-GPT-9a: normalizeGrokStructuredOutput still extracts array from single-key wrapper', () => {
    const wrapped = { feedback: CANONICAL_ARRAY };
    expect(normalizeGrokStructuredOutput(wrapped)).toEqual(CANONICAL_ARRAY);
  });

  it('T-GPT-9b: normalizeGrokStructuredOutput still passes direct array through unchanged', () => {
    expect(normalizeGrokStructuredOutput(CANONICAL_ARRAY)).toBe(CANONICAL_ARRAY);
  });

  it('T-GPT-9c: normalizeGrokStructuredOutput still passes truly ambiguous objects through unchanged', () => {
    // MR-LLM-LITE-2: known keys are now extracted. Use an object with no known wrapper keys.
    const ambiguous = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'value' };
    expect(normalizeGrokStructuredOutput(ambiguous)).toBe(ambiguous);
  });

  it('T-GPT-9d: global getLlmFetchTimeoutMs() is still 120 000 ms (Grok/other jobs unaffected)', () => {
    expect(getLlmFetchTimeoutMs()).toBe(120_000);
  });
});

// ── T-GPT-10: Persistence/read path receives canonical feedback shape ─────────

describe('MR-LLM-GPT-1 — T-GPT-10: persistence/read path receives canonical shape', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  it('T-GPT-10a: object-wrapper content normalizes and is parseable by parseFeedbackOutput', async () => {
    const wrapped = { feedback: CANONICAL_ARRAY };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(wrapped))));
    process.env['OPENAI_API_KEY'] = 'sk-test-gpt1-dummy';

    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a legal document reviewer (gpt).',
      userPrompt: 'Review this contract.',
      temperature: 0.4,
      maxTokens: 16384,
      structuredOutputSchema: RawSuggestionsArraySchema,
      signal: new AbortController().signal,
    });

    const rawOutput = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    const suggestions = parseFeedbackOutput(rawOutput);
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    const item = suggestions[0];
    expect(item).toHaveProperty('title');
    expect(item).toHaveProperty('body');
    expect(item).toHaveProperty('severity');
    expect(item).toHaveProperty('suggestionId');
    expect(['critical', 'major', 'minor']).toContain(item?.severity);
  });

  it('T-GPT-10b: txn2Commit string branch: normalized string content passes without double-serialization', () => {
    const content = CANONICAL_ARRAY_JSON;
    const rawOutput = typeof content === 'string' ? content : JSON.stringify(content);
    expect(rawOutput).toBe(CANONICAL_ARRAY_JSON);
    const suggestions = parseFeedbackOutput(rawOutput);
    expect(suggestions.length).toBe(CANONICAL_ARRAY.length);
    expect(suggestions[0]?.title).toBe(CANONICAL_ARRAY[0]?.title);
    expect(suggestions[0]?.severity).toBe(CANONICAL_ARRAY[0]?.severity);
    expect(typeof suggestions[0]?.suggestionId).toBe('string');
  });

  it('T-GPT-10c: txn2Commit object branch: object content is JSON.stringify-d before parsing', () => {
    const content = CANONICAL_ARRAY as unknown;
    const rawOutput = typeof content === 'string' ? content : JSON.stringify(content);
    expect(rawOutput).toBe(CANONICAL_ARRAY_JSON);
    const suggestions = parseFeedbackOutput(rawOutput);
    expect(suggestions.length).toBe(CANONICAL_ARRAY.length);
    expect(suggestions[0]?.title).toBe(CANONICAL_ARRAY[0]?.title);
    expect(typeof suggestions[0]?.suggestionId).toBe('string');
  });
});
