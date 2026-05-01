/**
 * mr_llm_1_s8.test.ts — MR-LLM-1 S8 Integration Tests
 *
 * Integration tests for the finish_reason and empty-content guards added to the
 * OpenAI adapter structured-output path (MR-LLM-1 S8 Phase A).
 *
 * These tests verify that when the OpenAI adapter throws LlmProviderError('api_error', ...)
 * due to Guard A (finish_reason blocked) or Guard B (empty content), the canonical
 * mutation dispatcher correctly propagates the errorClass to markJobFailed.
 *
 * Pattern: setTestLlmAdapter(MockLlmAdapter) + setJobWriteFunctions with vi.fn() spy
 * on markJobFailed to capture the errorClass argument.
 *
 * Infrastructure: uses existing setTestLlmAdapter, MockLlmAdapter, setJobWriteFunctions,
 * and appRouter.createCaller — no new infrastructure (AHC-12 compliant).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { clearTelemetryBuffer } from '../test-utils/setup.js';
import { appRouter } from '../router.js';
import type { Request, Response } from 'express';
import { setTestLlmAdapter } from '../llm/registry.js';
import { MockLlmAdapter } from '../llm/mock.js';
import { setJobWriteFunctions } from '../db/canonicalMutation.js';
import * as phase4bQueries from '../db/queries/phase4b.js';
import * as documentQueries from '../db/queries/documents.js';
import * as versionQueries from '../db/queries/versions.js';
import * as userPreferenceQueries from '../db/queries/userPreferences.js';
import * as matterQueries from '../db/queries/matters.js';

vi.mock('../db/queries/phase4b.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/phase4b.js')>();
  return {
    ...actual,
    getActiveReviewSessionForDocument: vi.fn(),
    insertReviewSession: vi.fn(),
    insertFeedback: vi.fn(),
    getReviewSessionById: vi.fn(),
    listFeedbackForSession: vi.fn(),
    getEvaluationForIteration: vi.fn(),
    listManualSelectionsForSession: vi.fn(),
  };
});

vi.mock('../db/queries/documents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/documents.js')>();
  return {
    ...actual,
    getDocumentById: vi.fn(),
  };
});

vi.mock('../db/queries/versions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/versions.js')>();
  return {
    ...actual,
    getVersionById: vi.fn(),
  };
});

vi.mock('../db/queries/userPreferences.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/userPreferences.js')>();
  return {
    ...actual,
    getUserPreferences: vi.fn(),
  };
});

vi.mock('../db/queries/matters.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/matters.js')>();
  return {
    ...actual,
    getMatterById: vi.fn(),
  };
});

const createCaller = (userId: string) => {
  return appRouter.createCaller({
    req: {} as Request,
    res: {} as Response,
    userId,
  });
};

const USER_ID = uuidv4();
const DOC_ID = uuidv4();
const MATTER_ID = uuidv4();
const VERSION_ID = uuidv4();
const SESSION_ID = uuidv4();

describe('MR-LLM-1 S8 Integration — api_error propagation to markJobFailed', () => {
  let markJobFailedSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    clearTelemetryBuffer();

    // Inject a vi.fn() spy on markJobFailed to capture errorClass
    markJobFailedSpy = vi.fn().mockResolvedValue(undefined);

    setJobWriteFunctions({
      insertJob: vi.fn().mockResolvedValue('noop') as unknown as (newJob: unknown) => Promise<string>,
      markJobRunning: vi.fn().mockResolvedValue(1) as unknown as (jobId: string, userId: string) => Promise<number>,
      markJobCompleted: vi.fn().mockResolvedValue(1) as unknown as (jobId: string, userId: string, output: unknown, tokensPrompt: number, tokensCompletion: number) => Promise<number>,
      markJobFailed: markJobFailedSpy as unknown as (jobId: string, userId: string, errorClass: string, errorMessage: string) => Promise<void>,
      markJobTimedOut: vi.fn().mockResolvedValue(undefined) as unknown as (jobId: string, userId: string, errorMessage: string) => Promise<void>,
      markJobCancelled: vi.fn().mockResolvedValue(1) as unknown as (jobId: string, userId: string) => Promise<number>,
      updateJobHeartbeat: vi.fn().mockResolvedValue(undefined) as unknown as (jobId: string, userId: string) => Promise<void>,
    });

    vi.mocked(userPreferenceQueries.getUserPreferences).mockResolvedValue({
      userId: USER_ID,
      preferences: {
        reviewerEnablement: { claude: false, gpt: true, gemini: false, grok: false },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    vi.mocked(documentQueries.getDocumentById).mockResolvedValue({
      id: DOC_ID,
      userId: USER_ID,
      matterId: MATTER_ID,
      title: 'Test Doc',
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
      content: 'Draft content for review.',
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
    vi.mocked(phase4bQueries.insertFeedback).mockResolvedValue(uuidv4());
  });

  afterEach(() => {
    clearTelemetryBuffer();
    setTestLlmAdapter(null);
    setJobWriteFunctions(null);
  });

  // ── T-S8-Mr1 — content_filter finish_reason → job marked failed with errorClass='api_error' ──
  it('T-S8-Mr1: when adapter throws LlmProviderError(api_error, content_filter), markJobFailed is called with errorClass=api_error', async () => {
    // Inject a mock adapter that throws LlmProviderError('api_error') simulating
    // the finish_reason='content_filter' guard in the OpenAI adapter.
    setTestLlmAdapter(
      new MockLlmAdapter({
        errorClass: 'api_error',
        errorMessage: 'OpenAI structured output blocked: finish_reason=content_filter',
      }),
    );

    const caller = createCaller(USER_ID);
    // reviewSession.create awaits executeCanonicalMutation synchronously in tests.
    // The job will fail, and the result status will be 'failed'.
    const result = await caller.reviewSession.create({
      documentId: DOC_ID,
      iterationNumber: 1,
      selectedReviewers: ['gpt'],
    });

    // The session is created (sessionId returned), but the reviewer job failed.
    expect(result.sessionId).toBe(SESSION_ID);

    // markJobFailed must have been called at least once with errorClass='api_error'
    expect(markJobFailedSpy).toHaveBeenCalled();
    const calls = markJobFailedSpy.mock.calls as Array<[string, string, string, string]>;
    const errorClasses = calls.map((args) => args[2]);
    expect(errorClasses).toContain('api_error');
  });

  // ── T-S8-Mr2 — empty content → job marked failed with errorClass='api_error' ──
  it('T-S8-Mr2: when adapter throws LlmProviderError(api_error, empty content), markJobFailed is called with errorClass=api_error', async () => {
    // Inject a mock adapter that throws LlmProviderError('api_error') simulating
    // the empty-content guard (Guard B) in the OpenAI adapter.
    setTestLlmAdapter(
      new MockLlmAdapter({
        errorClass: 'api_error',
        errorMessage: 'OpenAI structured output returned empty content',
      }),
    );

    const caller = createCaller(USER_ID);
    const result = await caller.reviewSession.create({
      documentId: DOC_ID,
      iterationNumber: 1,
      selectedReviewers: ['gpt'],
    });

    expect(result.sessionId).toBe(SESSION_ID);

    expect(markJobFailedSpy).toHaveBeenCalled();
    const calls = markJobFailedSpy.mock.calls as Array<[string, string, string, string]>;
    const errorClasses = calls.map((args) => args[2]);
    expect(errorClasses).toContain('api_error');
  });
});
