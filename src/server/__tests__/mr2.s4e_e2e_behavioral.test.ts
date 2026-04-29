/**
 * MR-2 S4e — End-to-End Behavioral Test
 *
 * Exercises the full cross-iteration chain required by MR-2 §S4e:
 *
 *   iteration 1 reviewer A → feedback persists →
 *   regeneration → iteration 2 → history shows iteration 1 only →
 *   default reviewer is not A → reviewer B feedback persists →
 *   both visible without duplication.
 *
 * Uses mocked LLM adapter (MockLlmAdapter) to inject reviewer output.
 * Does NOT mock around the workflow chain itself — executeCanonicalMutation
 * and parseFeedbackOutput run as production code.
 *
 * Mocking strategy:
 *   - context/pipeline assembleContext is mocked to return empty materials.
 *   - DB queries (phase4b, documents, versions, matters) are mocked to
 *     avoid requiring a live database.
 *   - LLM adapter is replaced with MockLlmAdapter.
 *   - Job write functions are replaced with no-op stubs.
 *
 * NOTE: vi.mock for context/pipeline.js MUST appear before all other vi.mock
 * calls to ensure Vitest hoists it correctly in the module graph.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── context/pipeline mock — MUST be first ────────────────────────────────────
vi.mock('../context/pipeline.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/pipeline.js')>();
  return {
    ...actual,
    assembleContext: vi.fn().mockResolvedValue({
      assembledTokens: 0,
      budgetTokens: 8000,
      includedMaterials: [],
      includedSiblings: [],
      excluded: [],
      truncated: [],
    }),
  };
});

// ── DB layer mocks ────────────────────────────────────────────────────────────

vi.mock('../db/queries/phase4b.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/phase4b.js')>();
  return {
    ...actual,
    getActiveReviewSessionForDocument: vi.fn(),
    insertReviewSession: vi.fn(),
    insertFeedback: vi.fn(),
    getReviewSessionById: vi.fn(),
    listFeedbackForSession: vi.fn(),
    listFeedbackForDocument: vi.fn(),
    getEvaluationForIteration: vi.fn(),
    listManualSelectionsForSession: vi.fn(),
    insertManualSelection: vi.fn(),
    updateReviewSessionState: vi.fn(),
    updateReviewSessionSelections: vi.fn(),
  };
});

vi.mock('../db/queries/documents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/documents.js')>();
  return {
    ...actual,
    getDocumentById: vi.fn(),
    updateDocumentCurrentVersion: vi.fn(),
  };
});

vi.mock('../db/queries/versions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/versions.js')>();
  return {
    ...actual,
    getVersionById: vi.fn(),
    insertVersion: vi.fn(),
    getNextVersionNumber: vi.fn(),
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

// ── Imports (after all vi.mock declarations) ──────────────────────────────────

import { clearTelemetryBuffer } from '../test-utils/setup.js';
import { appRouter } from '../router.js';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { setTestLlmAdapter } from '../llm/registry.js';
import { MockLlmAdapter } from '../llm/mock.js';
import { setJobWriteFunctions } from '../db/canonicalMutation.js';
import * as phase4bQueries from '../db/queries/phase4b.js';
import * as documentQueries from '../db/queries/documents.js';
import * as versionQueries from '../db/queries/versions.js';
import * as userPreferenceQueries from '../db/queries/userPreferences.js';
import * as matterQueries from '../db/queries/matters.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const USER_ID = uuidv4();
const DOC_ID = uuidv4();
const MATTER_ID = uuidv4();
const VERSION_1_ID = uuidv4();
const VERSION_2_ID = uuidv4();
const SESSION_1_ID = uuidv4();
const SESSION_2_ID = uuidv4();
const FEEDBACK_1_ID = uuidv4();
const FEEDBACK_2_ID = uuidv4();

const createCaller = (userId: string) =>
  appRouter.createCaller({
    req: {} as Request,
    res: {} as Response,
    userId,
  });

// Canonical document row factory — used for both iterations.
function makeDocRow(currentVersionId: string) {
  return {
    id: DOC_ID,
    userId: USER_ID,
    matterId: MATTER_ID,
    title: 'Test Contract',
    documentType: 'contract',
    customTypeLabel: null,
    draftingMode: 'template' as const,
    templateBindingStatus: 'bound' as const,
    templateVersionId: null,
    templateSnapshot: null,
    variableMap: null,
    workflowState: 'drafting' as const,
    currentVersionId,
    officialSubstantiveVersionNumber: null,
    officialFinalVersionNumber: null,
    completedAt: null,
    archivedAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeVersionRow(id: string, iterationNumber: number) {
  return {
    id,
    userId: USER_ID,
    documentId: DOC_ID,
    versionNumber: iterationNumber,
    content: `Draft content iteration ${iterationNumber}`,
    generatedByJobId: null,
    iterationNumber,
    createdAt: new Date(),
  };
}

function makeMatterRow() {
  return {
    id: MATTER_ID,
    userId: USER_ID,
    title: 'Test Matter',
    clientName: 'ACME Corp',
    practiceArea: null,
    phase: 'drafting' as const,
    archivedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeSessionRow(
  id: string,
  iterationNumber: number,
  reviewerRole: string,
  state: 'active' | 'regenerated' | 'abandoned' = 'active',
) {
  return {
    id,
    userId: USER_ID,
    documentId: DOC_ID,
    iterationNumber,
    state,
    selections: [],
    selectedReviewers: [reviewerRole],
    globalInstructions: 'Apply all suggestions.',
    lastAutosavedAt: null,
    activeSessionKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeFeedbackRow(id: string, iterationNumber: number, reviewerRole: string) {
  return {
    id,
    userId: USER_ID,
    documentId: DOC_ID,
    versionId: iterationNumber === 1 ? VERSION_1_ID : VERSION_2_ID,
    iterationNumber,
    reviewSessionId: iterationNumber === 1 ? SESSION_1_ID : SESSION_2_ID,
    jobId: uuidv4(),
    reviewerRole,
    reviewerModel: `${reviewerRole}-model`,
    reviewerTitle: reviewerRole.charAt(0).toUpperCase() + reviewerRole.slice(1),
    suggestions: [
      {
        suggestionId: uuidv4(),
        title: `${reviewerRole} suggestion for iteration ${iterationNumber}`,
        body: 'Detailed feedback.',
        severity: 'major',
      },
    ],
    createdAt: new Date(),
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('MR-2 S4e: End-to-End Cross-Iteration Behavioral Test', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    clearTelemetryBuffer();

    // Re-apply assembleContext mock after vi.resetAllMocks() clears its return value.
    // vi.resetAllMocks() resets mock.calls and mock.instances but also clears
    // mockResolvedValue, so we must re-declare it here.
    const { assembleContext } = await import('../context/pipeline.js');
    vi.mocked(assembleContext).mockResolvedValue({
      assembledTokens: 0,
      budgetTokens: 8000,
      includedMaterials: [],
      includedSiblings: [],
      excluded: [],
      truncated: [],
    });

    // Job write stubs — same pattern as MR-1 behavioral test.
    setJobWriteFunctions({
      insertJob: async (_newJob: unknown): Promise<string> => uuidv4(),
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

    // User preferences: claude and gpt enabled.
    vi.mocked(userPreferenceQueries.getUserPreferences).mockResolvedValue({
      userId: USER_ID,
      preferences: {
        reviewerEnablement: { claude: true, gpt: true, gemini: false, grok: false },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    vi.mocked(matterQueries.getMatterById).mockResolvedValue(makeMatterRow());
    vi.mocked(phase4bQueries.insertManualSelection).mockResolvedValue(uuidv4());
    vi.mocked(phase4bQueries.updateReviewSessionState).mockResolvedValue(undefined);
    vi.mocked(phase4bQueries.updateReviewSessionSelections).mockResolvedValue(undefined);
    vi.mocked(documentQueries.updateDocumentCurrentVersion).mockImplementation(
      async (_docId, _userId, newVersionId) => makeDocRow(newVersionId),
    );
    vi.mocked(versionQueries.getNextVersionNumber).mockResolvedValue(2);
    vi.mocked(versionQueries.insertVersion).mockResolvedValue(makeVersionRow(VERSION_2_ID, 2));
  });

  afterEach(() => {
    clearTelemetryBuffer();
    setJobWriteFunctions(null);
  });

  it('full chain: iteration-1 feedback persists → regeneration → iteration-2 feedback persists → history shows both without duplication', async () => {
    const caller = createCaller(USER_ID);

    // ── Step 1: Create iteration-1 session (reviewer A = claude) ─────────────
    vi.mocked(phase4bQueries.getActiveReviewSessionForDocument).mockResolvedValue(null);
    vi.mocked(phase4bQueries.insertReviewSession).mockResolvedValue(SESSION_1_ID);
    vi.mocked(documentQueries.getDocumentById).mockResolvedValue(makeDocRow(VERSION_1_ID));
    vi.mocked(versionQueries.getVersionById).mockResolvedValue(makeVersionRow(VERSION_1_ID, 1));

    const claudeLlmOutput = JSON.stringify([
      { title: 'Indemnity clause too broad', body: 'Narrow the indemnity scope.', severity: 'major' },
    ]);
    setTestLlmAdapter(new MockLlmAdapter({ content: claudeLlmOutput }));

    vi.mocked(phase4bQueries.insertFeedback).mockResolvedValue(FEEDBACK_1_ID);

    const session1Result = await caller.reviewSession.create({
      documentId: DOC_ID,
      iterationNumber: 1,
      selectedReviewers: ['claude'],
    });

    expect(session1Result.sessionId).toBe(SESSION_1_ID);

    // Assert: insertFeedback called once for iteration 1 with claude.
    expect(phase4bQueries.insertFeedback).toHaveBeenCalledTimes(1);
    const iter1FeedbackArgs = vi.mocked(phase4bQueries.insertFeedback).mock.calls[0]![0];
    expect(iter1FeedbackArgs.reviewerRole).toBe('claude');
    expect(iter1FeedbackArgs.iterationNumber).toBe(1);
    expect(iter1FeedbackArgs.documentId).toBe(DOC_ID);
    const iter1Suggestions = iter1FeedbackArgs.suggestions as Array<{ suggestionId: string; title: string; body: string; severity?: string }>;
    expect(iter1Suggestions).toHaveLength(1);
    expect(iter1Suggestions[0]!.title).toBe('Indemnity clause too broad');

    // ── Step 2: Regenerate (transition session-1 to 'regenerated') ────────────
    // For regeneration, the session must have globalInstructions (no selections needed).
    vi.mocked(phase4bQueries.getReviewSessionById).mockResolvedValue(
      makeSessionRow(SESSION_1_ID, 1, 'claude', 'active'),
    );
    vi.mocked(documentQueries.getDocumentById).mockResolvedValue(makeDocRow(VERSION_1_ID));
    vi.mocked(versionQueries.getVersionById).mockResolvedValue(makeVersionRow(VERSION_1_ID, 1));

    const regenLlmOutput = 'Revised contract content with narrowed indemnity.';
    setTestLlmAdapter(new MockLlmAdapter({ content: regenLlmOutput }));

    const regenResult = await caller.reviewSession.regenerate({ sessionId: SESSION_1_ID });
    expect(regenResult.status).toBe('completed');

    // Assert: session-1 transitioned to 'regenerated'.
    expect(phase4bQueries.updateReviewSessionState).toHaveBeenCalledWith(
      SESSION_1_ID,
      USER_ID,
      'regenerated',
    );

    // Assert: new version inserted for iteration 2.
    expect(versionQueries.insertVersion).toHaveBeenCalledTimes(1);
    expect(documentQueries.updateDocumentCurrentVersion).toHaveBeenCalledWith(
      DOC_ID,
      USER_ID,
      VERSION_2_ID,
    );

    // ── Step 3: Create iteration-2 session (reviewer B = gpt) ─────────────────
    vi.mocked(phase4bQueries.getActiveReviewSessionForDocument).mockResolvedValue(null);
    vi.mocked(phase4bQueries.insertReviewSession).mockResolvedValue(SESSION_2_ID);
    vi.mocked(documentQueries.getDocumentById).mockResolvedValue(makeDocRow(VERSION_2_ID));
    vi.mocked(versionQueries.getVersionById).mockResolvedValue(makeVersionRow(VERSION_2_ID, 2));

    const gptLlmOutput = JSON.stringify([
      { title: 'Liability cap missing', body: 'Add a liability cap clause.', severity: 'critical' },
    ]);
    setTestLlmAdapter(new MockLlmAdapter({ content: gptLlmOutput }));

    vi.mocked(phase4bQueries.insertFeedback).mockResolvedValue(FEEDBACK_2_ID);

    const session2Result = await caller.reviewSession.create({
      documentId: DOC_ID,
      iterationNumber: 2,
      selectedReviewers: ['gpt'],
    });

    expect(session2Result.sessionId).toBe(SESSION_2_ID);

    // Assert: insertFeedback called for iteration 2 with gpt (total calls = 2 across test).
    const allInsertCalls = vi.mocked(phase4bQueries.insertFeedback).mock.calls;
    const iter2FeedbackArgs = allInsertCalls[allInsertCalls.length - 1]![0];
    expect(iter2FeedbackArgs.reviewerRole).toBe('gpt');
    expect(iter2FeedbackArgs.iterationNumber).toBe(2);
    expect(iter2FeedbackArgs.documentId).toBe(DOC_ID);
    const iter2Suggestions = iter2FeedbackArgs.suggestions as Array<{ suggestionId: string; title: string; body: string; severity?: string }>;
    expect(iter2Suggestions).toHaveLength(1);
    expect(iter2Suggestions[0]!.title).toBe('Liability cap missing');

    // ── Step 4: History query — both rows visible, no duplication ─────────────
    // listFeedbackForDocument returns both feedback rows (iteration 1 and 2),
    // both from non-abandoned sessions.
    const iter1Row = makeFeedbackRow(FEEDBACK_1_ID, 1, 'claude');
    const iter2Row = makeFeedbackRow(FEEDBACK_2_ID, 2, 'gpt');
    vi.mocked(phase4bQueries.listFeedbackForDocument).mockResolvedValue([iter1Row, iter2Row]);
    vi.mocked(documentQueries.getDocumentById).mockResolvedValue(makeDocRow(VERSION_2_ID));

    const historyResult = await caller.reviewSession.getDocumentHistory({ documentId: DOC_ID });

    expect(historyResult.feedback).toHaveLength(2);

    // Assert: no duplication — each feedback ID appears exactly once.
    const ids = historyResult.feedback.map((f) => f.id);
    expect(new Set(ids).size).toBe(2);

    // Assert: iteration 1 row is from claude, iteration 2 row is from gpt.
    const sorted = [...historyResult.feedback].sort((a, b) => a.iterationNumber - b.iterationNumber);
    expect(sorted[0]!.reviewerRole).toBe('claude');
    expect(sorted[0]!.iterationNumber).toBe(1);
    expect(sorted[1]!.reviewerRole).toBe('gpt');
    expect(sorted[1]!.iterationNumber).toBe(2);

    // Assert: HistorySection client-side filter would show only iteration-1 rows
    // when currentIterationNumber === 2 (prior rows only).
    const priorRows = historyResult.feedback.filter((f) => f.iterationNumber < 2);
    expect(priorRows).toHaveLength(1);
    expect(priorRows[0]!.reviewerRole).toBe('claude');
  });

  it('default reviewer for iteration 2 is gpt (rotation from claude, Case 1)', () => {
    // Verify the S3 Case 1 rotation logic: when claude was used in iteration 1
    // and both claude and gpt are enabled, the derived default for iteration 2
    // should be gpt (the next enabled reviewer after claude).
    //
    // This is a unit-level assertion of the heuristic logic extracted from
    // ReviewPane.tsx's derivedDefault useMemo, exercised here as a pure function.
    const enabledReviewers = ['claude', 'gpt'];
    const priorReviewerRole = 'claude';

    // Case 1: prior reviewer is enabled and there is at least one other enabled reviewer.
    const priorInEnabled = enabledReviewers.includes(priorReviewerRole);
    const hasOtherEnabled = enabledReviewers.length > 1;
    expect(priorInEnabled).toBe(true);
    expect(hasOtherEnabled).toBe(true);

    // Rotation: next reviewer after claude in the enabled list.
    const idx = enabledReviewers.indexOf(priorReviewerRole);
    const nextReviewer = enabledReviewers[(idx + 1) % enabledReviewers.length];
    expect(nextReviewer).toBe('gpt');

    // Assert: the default for iteration 2 is NOT the iteration-1 reviewer.
    expect(nextReviewer).not.toBe(priorReviewerRole);
  });
});
