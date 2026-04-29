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

    // Fix 1: setJobWriteFunctions mocks must match JobWriteFunctions type.
    // markJobRunning, markJobCompleted, markJobCancelled return Promise<number>.
    // insertJob returns Promise<string>. Pattern mirrors phase2.acceptance.test.ts:58-80.
    // Schema refs: src/server/db/canonicalMutation.ts:125-133 (JobWriteFunctions type);
    //              src/server/db/queries/jobs.ts:191-194, 245-251, 344-347 (return types).
    setJobWriteFunctions({
      insertJob: async (_newJob: unknown): Promise<string> => 'noop',
      markJobRunning: async (_jobId: string, _userId: string): Promise<number> => 1,
      markJobCompleted: async (
        _jobId: string,
        _userId: string,
        _output: unknown,
        _tokensPrompt: number,
        _tokensCompletion: number,
      ): Promise<number> => 1,
      markJobFailed: async (
        _jobId: string,
        _userId: string,
        _errorClass: string,
        _errorMessage: string,
      ): Promise<void> => {},
      markJobTimedOut: async (
        _jobId: string,
        _userId: string,
        _errorMessage: string,
      ): Promise<void> => {},
      markJobCancelled: async (_jobId: string, _userId: string): Promise<number> => 1,
      updateJobHeartbeat: async (_jobId: string, _userId: string): Promise<void> => {},
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
      // Fix 2: 'review_pending' is not a valid DocumentWorkflowState.
      // Valid values: 'drafting' | 'substantively_accepted' | 'finalizing' | 'complete' | 'archived'
      // Schema ref: src/shared/schemas/matters.ts:32-37 (DOCUMENT_WORKFLOW_STATE_VALUES).
      // An in-review document is still in 'drafting' state (review is a sub-phase of drafting).
      workflowState: 'drafting' as const,
      currentVersionId: VERSION_ID,
      // Fix 2b: DocumentRow also requires completedAt, archivedAt,
      // officialSubstantiveVersionNumber, officialFinalVersionNumber, notes.
      // Schema ref: src/shared/schemas/matters.ts:69-91 (DocumentRowSchema).
      officialSubstantiveVersionNumber: null,
      officialFinalVersionNumber: null,
      completedAt: null,
      archivedAt: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Fix 3: getVersionById returns VersionRow which requires versionNumber and generatedByJobId.
    // Schema ref: src/shared/schemas/matters.ts:99-109 (VersionRowSchema).
    vi.mocked(versionQueries.getVersionById).mockResolvedValue({
      id: VERSION_ID,
      userId: USER_ID,
      documentId: DOC_ID,
      versionNumber: 1,
      content: 'Draft content',
      generatedByJobId: null,
      iterationNumber: 1,
      createdAt: new Date(),
    });

    // Fix 4: getMatterById returns MatterRow which uses 'title' not 'name', and 'phase' not 'status'.
    // Schema ref: src/shared/schemas/matters.ts:14-25 (MatterRowSchema).
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

    // Fix 5: insertReviewSession returns Promise<string> (the inserted row ID), not an object.
    // Schema ref: src/server/db/queries/phase4b.ts:676-683 (function signature).
    vi.mocked(phase4bQueries.insertReviewSession).mockResolvedValue(SESSION_ID);

    // Fix 6: insertFeedback returns Promise<string> (the inserted row ID).
    // mockResolvedValue() requires one argument.
    // Schema ref: src/server/db/queries/phase4b.ts:486-500 (function signature).
    vi.mocked(phase4bQueries.insertFeedback).mockResolvedValue(uuidv4());
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

    expect(result.sessionId).toBe(SESSION_ID);

    // 2. Assert insertFeedback was called with the parsed data
    expect(phase4bQueries.insertFeedback).toHaveBeenCalledTimes(1);

    const insertCallArgs = vi.mocked(phase4bQueries.insertFeedback).mock.calls[0]![0];
    expect(insertCallArgs.documentId).toBe(DOC_ID);
    expect(insertCallArgs.reviewerRole).toBe('claude');

    // 3. Assert the suggestion was parsed and stamped with an ID
    expect(insertCallArgs.suggestions).toHaveLength(1);
    const suggestion = (insertCallArgs.suggestions as Array<{
      suggestionId: string;
      title: string;
      body: string;
      severity: string;
    }>)[0]!;
    expect(suggestion.title).toBe('Fix indemnity clause');
    expect(suggestion.body).toBe('The indemnity clause is too broad.');
    expect(suggestion.severity).toBe('major');
    expect(suggestion.suggestionId).toBeDefined(); // ID stamped by parser
    expect(typeof suggestion.suggestionId).toBe('string');

    // 4. Assert telemetry was emitted indicating completion
    assertTelemetryEmitted('generation_completed', { operation: 'reviewer_feedback' });
  });
});
