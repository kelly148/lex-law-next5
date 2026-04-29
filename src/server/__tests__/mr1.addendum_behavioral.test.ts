import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearTelemetryBuffer, assertTelemetryEmitted } from '../test-utils/setup.js';
import { appRouter } from '../router.js';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Mock the LLM adapter to return a known JSON array
import { setTestLlmAdapter } from '../llm/registry.js';
import { MockLlmAdapter } from '../llm/mock.js';

// Mock the job queries to bypass DB writes
import { setJobWriteFunctions } from '../db/canonicalMutation.js';

// Mock the queries
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

// We need to mock the jobs dispatcher so it doesn't try to run the job in the background asynchronously
// Actually, executeCanonicalMutation handles the job execution synchronously in tests if we await it,
// but reviewSession.create fires and forgets the reviewer jobs.
// Wait, in reviewSession.create, executeCanonicalMutation is `await`ed in a loop!
// "const reviewerResult = await executeCanonicalMutation({...})"
// This means the job completes *during* the TRPC call in the test environment.

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

describe('MR-1 Behavioral Persistence Test', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearTelemetryBuffer();
    
    // Setup base mocks
    setJobWriteFunctions({
      insertJob: async () => {},
      markJobRunning: async () => {},
      markJobCompleted: async () => {},
      markJobFailed: async () => {},
      markJobTimedOut: async () => {},
      markJobCancelled: async () => {},
      updateJobHeartbeat: async () => {},
    });

    vi.mocked(userPreferenceQueries.getUserPreferences).mockResolvedValue({
      userId: USER_ID,
      preferences: {
        reviewerEnablement: { claude: true, gpt: true, gemini: true, grok: true },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

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
      workflowState: 'review_pending',
      currentVersionId: VERSION_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(versionQueries.getVersionById).mockResolvedValue({
      id: VERSION_ID,
      userId: USER_ID,
      documentId: DOC_ID,
      iterationNumber: 1,
      content: 'Draft content',
      createdAt: new Date(),
    });

    vi.mocked(matterQueries.getMatterById).mockResolvedValue({
      id: MATTER_ID,
      userId: USER_ID,
      name: 'Test Matter',
      description: null,
      status: 'open',
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(phase4bQueries.getActiveReviewSessionForDocument).mockResolvedValue(null);
    
    vi.mocked(phase4bQueries.insertReviewSession).mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      documentId: DOC_ID,
      iterationNumber: 1,
      state: 'active',
      selections: [],
      selectedReviewers: ['claude'],
      globalInstructions: null,
      activeSessionKey: 'key',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    vi.mocked(phase4bQueries.insertFeedback).mockResolvedValue();
  });

  afterEach(() => {
    clearTelemetryBuffer();
    setJobWriteFunctions(null);
  });

  it('executes the full chain: reviewer job → txn2Commit → parseFeedbackOutput → insertFeedback', async () => {
    const caller = createCaller(USER_ID);

    // Mock the LLM to return a valid JSON array matching the expected shape
    const mockLlmOutput = JSON.stringify([
      {
        title: 'Fix indemnity clause',
        body: 'The indemnity clause is too broad.',
        severity: 'major'
      }
    ]);
    setTestLlmAdapter(new MockLlmAdapter({ content: mockLlmOutput }));

    // 1. Call reviewSession.create
    // This will await executeCanonicalMutation, which will run the job,
    // get the LLM output, and call txn2Commit.
    const result = await caller.reviewSession.create({
      documentId: DOC_ID,
      iterationNumber: 1,
      selectedReviewers: ['claude'],
    });

    expect((result.sessionId as any).id).toBe(SESSION_ID);

    // 2. Assert insertFeedback was called with the parsed data
    expect(phase4bQueries.insertFeedback).toHaveBeenCalledTimes(1);
    
    const insertCallArgs = vi.mocked(phase4bQueries.insertFeedback).mock.calls[0]![0];
    expect(insertCallArgs.documentId).toBe(DOC_ID);
    expect(insertCallArgs.reviewerRole).toBe('claude');
    
    // 3. Assert the suggestion was parsed and stamped with an ID
    expect(insertCallArgs.suggestions).toHaveLength(1);
    const suggestion = (insertCallArgs.suggestions as any[])[0];
    expect(suggestion.title).toBe('Fix indemnity clause');
    expect(suggestion.body).toBe('The indemnity clause is too broad.');
    expect(suggestion.severity).toBe('major');
    expect(suggestion.suggestionId).toBeDefined(); // ID stamped by parser
    expect(typeof suggestion.suggestionId).toBe('string');

    // 4. Assert telemetry was emitted indicating completion
    assertTelemetryEmitted('generation_completed', { operation: 'reviewer_feedback' });
  });
});
