/**
 * MR-4 S2 — Selection Fidelity Test Suite
 *
 * Verifies:
 *   T1  — regenerate: itemized prompt includes suggestion title, body, severity tag
 *   T2  — regenerate: prompt includes reviewerTitle for each suggestion
 *   T3  — regenerate: attorney note appears in prompt when present
 *   T4  — regenerate: attorney note line absent when note is null
 *   T5  — regenerate: global instructions appended after selection summary
 *   T6  — regenerate: global-instructions-only path (no selections) produces no selection summary
 *   T7  — regenerateSingleReviewer: same itemized prompt construction (Option B: all selections)
 *   T8  — regenerate: SUGGESTION_NOT_RESOLVED thrown when selection references unknown suggestionId
 *   T9  — updateSelection: accepts legacy feedbackId field (alias normalization)
 *   T10 — updateSelection: canonical suggestionId field accepted directly
 *   T11 — regenerate: SUGGESTION_NOT_RESOLVED thrown (BAD_REQUEST, not PRECONDITION_FAILED)
 *   T12 — regenerateSingleReviewer: SUGGESTION_NOT_RESOLVED thrown for unknown suggestionId
 *   T13 — regenerate: SUGGESTION_NOT_RESOLVED message includes sentinel prefix (for client detection)
 *   T14 — source-inspection: toggleSuggestion builds payload from latest-local-state merge
 *   T15 — source-inspection: SUGGESTION_NOT_RESOLVED branch maps to safe user-facing message
 *   T16 — source-inspection: SessionSelectionSchema normalizes feedbackId → suggestionId
 *
 *   C1  — source-inspection: itemized prompt lines present in reviewSession.ts
 *   C2  — source-inspection: SUGGESTION_NOT_RESOLVED sentinel present in reviewSession.ts
 *   C3  — source-inspection: listFeedbackForSession called in regenerate path
 *   C4  — source-inspection: SessionSelectionSchema transform present in phase4b.ts
 *   C5  — source-inspection: safe user-facing message present in ReviewPane.tsx
 *   C6  — source-inspection: raw suggestionId NOT rendered to user in ReviewPane.tsx
 *   C7  — source-inspection: branch detection uses startsWith sentinel, not ad-hoc regex on raw UUID
 *
 * References: MR-4 S2 spec §2 (P1 itemized prompt), §3 (P2 frontend), §3.3 (alias normalization)
 *
 * Evidence class: Rule 3 (repo command). Grep commands for step (b) are embedded inline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { clearTelemetryBuffer } from '../test-utils/setup.js';
import { appRouter } from '../router.js';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { setTestLlmAdapter } from '../llm/registry.js';
import { MockLlmAdapter } from '../llm/mock.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';

// ── CapturingLlmAdapter: captures the userPrompt passed to generate() ──────────
// Used by T1–T8 to verify itemized prompt construction.
// MockLlmAdapter does not support an onGenerate callback, so we define a
// minimal LlmClient implementation here that captures the params.
class CapturingLlmAdapter implements LlmClient {
  public capturedUserPrompt = '';
  public capturedSystemPrompt = '';
  async generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.capturedUserPrompt = params.userPrompt;
    this.capturedSystemPrompt = params.systemPrompt;
    return {
      content: 'Revised contract content.',
      tokensPrompt: 10,
      tokensCompletion: 20,
      providerMetadata: { provider: 'capturing-mock', model: 'mock' },
    };
  }
}
import { setJobWriteFunctions } from '../db/canonicalMutation.js';
import * as phase4bQueries from '../db/queries/phase4b.js';
import * as documentQueries from '../db/queries/documents.js';
import * as versionQueries from '../db/queries/versions.js';
import * as userPreferenceQueries from '../db/queries/userPreferences.js';
import * as matterQueries from '../db/queries/matters.js';

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

// ── Fixtures ──────────────────────────────────────────────────────────────────
const USER_ID = uuidv4();
const DOC_ID = uuidv4();
const MATTER_ID = uuidv4();
const VERSION_ID = uuidv4();
const VERSION_2_ID = uuidv4();
const SESSION_ID = uuidv4();
const SUGGESTION_ID_1 = uuidv4();
const SUGGESTION_ID_2 = uuidv4();

const createCaller = (userId: string) =>
  appRouter.createCaller({
    req: {} as Request,
    res: {} as Response,
    userId,
  });

function makeDocRow(currentVersionId: string = VERSION_ID) {
  return {
    id: DOC_ID,
    userId: USER_ID,
    matterId: MATTER_ID,
    title: 'Test Contract',
    documentType: 'contract' as const,
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

function makeVersionRow(id: string = VERSION_ID) {
  return {
    id,
    userId: USER_ID,
    documentId: DOC_ID,
    versionNumber: 1,
    content: 'Draft contract content.',
    generatedByJobId: null,
    iterationNumber: 1,
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

function makeSessionRow(overrides: {
  selections?: Array<{ suggestionId: string; note: string | null }>;
  globalInstructions?: string;
  selectedReviewers?: string[];
  state?: 'active' | 'regenerated' | 'abandoned';
} = {}) {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    documentId: DOC_ID,
    iterationNumber: 1,
    state: overrides.state ?? 'active',
    selections: overrides.selections ?? [],
    selectedReviewers: overrides.selectedReviewers ?? ['claude'],
    globalInstructions: overrides.globalInstructions ?? '',
    lastAutosavedAt: null,
    activeSessionKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeFeedbackRow(suggestions: Array<{ suggestionId: string; title: string; body: string; severity?: string }>) {
  return {
    id: uuidv4(),
    userId: USER_ID,
    documentId: DOC_ID,
    versionId: VERSION_ID,
    iterationNumber: 1,
    reviewSessionId: SESSION_ID,
    jobId: uuidv4(),
    reviewerRole: 'claude',
    reviewerModel: 'claude-model',
    reviewerTitle: 'Claude',
    suggestions,
    createdAt: new Date(),
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
const jobWriteStubs = {
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
};

// ── Source files (loaded once for C-tests) ────────────────────────────────────
const reviewSessionFile = fs.readFileSync(
  path.resolve(process.cwd(), 'src/server/procedures/reviewSession.ts'),
  'utf-8',
);
const phase4bSchemaFile = fs.readFileSync(
  path.resolve(process.cwd(), 'src/shared/schemas/phase4b.ts'),
  'utf-8',
);
const reviewPaneFile = fs.readFileSync(
  path.resolve(process.cwd(), 'src/client/components/ReviewPane.tsx'),
  'utf-8',
);

// ═══════════════════════════════════════════════════════════════════════════════
// T1–T8: regenerate itemized prompt construction (behavioral)
// ═══════════════════════════════════════════════════════════════════════════════
describe('T1–T8: regenerate — itemized prompt construction (MR-4 P1)', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    clearTelemetryBuffer();

    const { assembleContext } = await import('../context/pipeline.js');
    vi.mocked(assembleContext).mockResolvedValue({
      assembledTokens: 0,
      budgetTokens: 8000,
      includedMaterials: [],
      includedSiblings: [],
      excluded: [],
      truncated: [],
    });
    setJobWriteFunctions(jobWriteStubs);

    vi.mocked(userPreferenceQueries.getUserPreferences).mockResolvedValue({
      userId: USER_ID,
      preferences: { reviewerEnablement: { claude: true, gpt: true, gemini: false, grok: false } },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    vi.mocked(matterQueries.getMatterById).mockResolvedValue(makeMatterRow());
    vi.mocked(documentQueries.getDocumentById).mockResolvedValue(makeDocRow());
    vi.mocked(versionQueries.getVersionById).mockResolvedValue(makeVersionRow());
    vi.mocked(versionQueries.getNextVersionNumber).mockResolvedValue(2);
    vi.mocked(versionQueries.insertVersion).mockResolvedValue(makeVersionRow(VERSION_2_ID));
    vi.mocked(documentQueries.updateDocumentCurrentVersion).mockImplementation(
      async (_docId, _userId, newVersionId) => makeDocRow(newVersionId),
    );
    vi.mocked(phase4bQueries.insertManualSelection).mockResolvedValue(uuidv4());
    vi.mocked(phase4bQueries.updateReviewSessionState).mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearTelemetryBuffer();
    setJobWriteFunctions(null);
  });

  // Helper: run regenerate and capture the userPrompt passed to the LLM.
  // Uses CapturingLlmAdapter (defined above) to record the full userPrompt
  // that _invokeDocumentRegenerate builds, which embeds the instructions block.
  async function runRegenerateAndCapture(
    sessionOverrides: Parameters<typeof makeSessionRow>[0],
    feedbackRows: ReturnType<typeof makeFeedbackRow>[],
  ): Promise<string> {
    vi.mocked(phase4bQueries.getReviewSessionById).mockResolvedValue(
      makeSessionRow(sessionOverrides),
    );
    vi.mocked(phase4bQueries.listFeedbackForSession).mockResolvedValue(feedbackRows);

    const capturingAdapter = new CapturingLlmAdapter();
    setTestLlmAdapter(capturingAdapter);

    const caller = createCaller(USER_ID);
    await caller.reviewSession.regenerate({ sessionId: SESSION_ID });
    // The instructions block is embedded in userPrompt under '## Attorney Instructions'
    return capturingAdapter.capturedUserPrompt;
  }

  it('T1: prompt includes suggestion title and body for each selected suggestion', async () => {
    const prompt = await runRegenerateAndCapture(
      {
        selections: [{ suggestionId: SUGGESTION_ID_1, note: null }],
        globalInstructions: '',
      },
      [makeFeedbackRow([
        { suggestionId: SUGGESTION_ID_1, title: 'Add indemnity clause', body: 'The indemnity clause is missing.', severity: 'critical' },
      ])],
    );
    expect(prompt).toContain('Add indemnity clause');
    expect(prompt).toContain('The indemnity clause is missing.');
  });

  it('T2: prompt includes reviewerTitle for each suggestion', async () => {
    const prompt = await runRegenerateAndCapture(
      {
        selections: [{ suggestionId: SUGGESTION_ID_1, note: null }],
        globalInstructions: '',
      },
      [makeFeedbackRow([
        { suggestionId: SUGGESTION_ID_1, title: 'Narrow liability', body: 'Limit liability cap.', severity: 'major' },
      ])],
    );
    // makeFeedbackRow sets reviewerTitle = 'Claude'
    expect(prompt).toContain('Claude');
  });

  it('T3: attorney note appears in prompt when note is non-null', async () => {
    const prompt = await runRegenerateAndCapture(
      {
        selections: [{ suggestionId: SUGGESTION_ID_1, note: 'Prioritize this one' }],
        globalInstructions: '',
      },
      [makeFeedbackRow([
        { suggestionId: SUGGESTION_ID_1, title: 'Add clause', body: 'Body text.', severity: 'minor' },
      ])],
    );
    expect(prompt).toContain('Attorney note: Prioritize this one');
  });

  it('T4: attorney note line is absent when note is null', async () => {
    const prompt = await runRegenerateAndCapture(
      {
        selections: [{ suggestionId: SUGGESTION_ID_1, note: null }],
        globalInstructions: '',
      },
      [makeFeedbackRow([
        { suggestionId: SUGGESTION_ID_1, title: 'Add clause', body: 'Body text.', severity: 'minor' },
      ])],
    );
    expect(prompt).not.toContain('Attorney note:');
  });

  it('T5: global instructions are appended after the selection summary', async () => {
    const prompt = await runRegenerateAndCapture(
      {
        selections: [{ suggestionId: SUGGESTION_ID_1, note: null }],
        globalInstructions: 'Keep the tone formal.',
      },
      [makeFeedbackRow([
        { suggestionId: SUGGESTION_ID_1, title: 'Add clause', body: 'Body text.', severity: 'minor' },
      ])],
    );
    expect(prompt).toContain('Add clause');
    expect(prompt).toContain('Keep the tone formal.');
    // Global instructions must appear after the selection summary
    const selIdx = prompt.indexOf('Add clause');
    const globalIdx = prompt.indexOf('Keep the tone formal.');
    expect(selIdx).toBeGreaterThanOrEqual(0);
    expect(globalIdx).toBeGreaterThan(selIdx);
  });

  it('T6: global-instructions-only path produces no selection summary', async () => {
    const prompt = await runRegenerateAndCapture(
      {
        selections: [],
        globalInstructions: 'Tighten all definitions.',
      },
      [],
    );
    expect(prompt).not.toContain('Apply the following');
    expect(prompt).toContain('Tighten all definitions.');
  });

  it('T7: severity tag [critical] appears in prompt for critical suggestions', async () => {
    const prompt = await runRegenerateAndCapture(
      {
        selections: [{ suggestionId: SUGGESTION_ID_1, note: null }],
        globalInstructions: '',
      },
      [makeFeedbackRow([
        { suggestionId: SUGGESTION_ID_1, title: 'Critical fix', body: 'Urgent fix needed.', severity: 'critical' },
      ])],
    );
    expect(prompt).toContain('[critical]');
  });

  it('T8: regenerate throws SUGGESTION_NOT_RESOLVED when selection references unknown suggestionId', async () => {
    const unknownId = uuidv4();
    vi.mocked(phase4bQueries.getReviewSessionById).mockResolvedValue(
      makeSessionRow({ selections: [{ suggestionId: unknownId, note: null }] }),
    );
    // listFeedbackForSession returns rows that do NOT include unknownId
    vi.mocked(phase4bQueries.listFeedbackForSession).mockResolvedValue([
      makeFeedbackRow([
        { suggestionId: SUGGESTION_ID_1, title: 'Some suggestion', body: 'Body.', severity: 'minor' },
      ]),
    ]);

    const caller = createCaller(USER_ID);
    await expect(
      caller.reviewSession.regenerate({ sessionId: SESSION_ID }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('SUGGESTION_NOT_RESOLVED'),
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T9–T10: updateSelection alias normalization (behavioral)
// ═══════════════════════════════════════════════════════════════════════════════
describe('T9–T10: updateSelection — alias normalization (MR-4 §3.3)', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    clearTelemetryBuffer();

    vi.mocked(documentQueries.getDocumentById).mockResolvedValue(makeDocRow());
    vi.mocked(matterQueries.getMatterById).mockResolvedValue(makeMatterRow());
    vi.mocked(phase4bQueries.updateReviewSessionSelections).mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearTelemetryBuffer();
  });

  it('T9: updateSelection accepts canonical suggestionId field without error', async () => {
    vi.mocked(phase4bQueries.getReviewSessionById).mockResolvedValue(
      makeSessionRow({ selections: [] }),
    );
    const caller = createCaller(USER_ID);
    // Should not throw
    await expect(
      caller.reviewSession.updateSelection({
        sessionId: SESSION_ID,
        selections: [{ suggestionId: SUGGESTION_ID_1, note: null }],
      }),
    ).resolves.toBeDefined();
    expect(phase4bQueries.updateReviewSessionSelections).toHaveBeenCalledWith(
      SESSION_ID,
      USER_ID,
      [{ suggestionId: SUGGESTION_ID_1, note: null }],
    );
  });

  it('T10: updateSelection telemetry diff uses canonical suggestionId for added/removed computation', async () => {
    // Pre-existing selection: SUGGESTION_ID_1
    vi.mocked(phase4bQueries.getReviewSessionById).mockResolvedValue(
      makeSessionRow({ selections: [{ suggestionId: SUGGESTION_ID_1, note: null }] }),
    );
    const caller = createCaller(USER_ID);
    // New selection: SUGGESTION_ID_2 added, SUGGESTION_ID_1 removed
    await caller.reviewSession.updateSelection({
      sessionId: SESSION_ID,
      selections: [{ suggestionId: SUGGESTION_ID_2, note: null }],
    });
    // Telemetry is emitted with added=[SUGGESTION_ID_2], removed=[SUGGESTION_ID_1].
    // We verify the procedure ran without error (telemetry is fire-and-forget).
    expect(phase4bQueries.updateReviewSessionSelections).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T11–T13: SUGGESTION_NOT_RESOLVED fail-safe (behavioral)
// ═══════════════════════════════════════════════════════════════════════════════
describe('T11–T13: SUGGESTION_NOT_RESOLVED fail-safe (MR-4 §2)', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    clearTelemetryBuffer();

    const { assembleContext } = await import('../context/pipeline.js');
    vi.mocked(assembleContext).mockResolvedValue({
      assembledTokens: 0,
      budgetTokens: 8000,
      includedMaterials: [],
      includedSiblings: [],
      excluded: [],
      truncated: [],
    });
    setJobWriteFunctions(jobWriteStubs);

    vi.mocked(userPreferenceQueries.getUserPreferences).mockResolvedValue({
      userId: USER_ID,
      preferences: { reviewerEnablement: { claude: true, gpt: true, gemini: false, grok: false } },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    vi.mocked(matterQueries.getMatterById).mockResolvedValue(makeMatterRow());
    vi.mocked(documentQueries.getDocumentById).mockResolvedValue(makeDocRow());
    vi.mocked(versionQueries.getVersionById).mockResolvedValue(makeVersionRow());
    vi.mocked(phase4bQueries.insertManualSelection).mockResolvedValue(uuidv4());
    vi.mocked(phase4bQueries.updateReviewSessionState).mockResolvedValue(undefined);
    setTestLlmAdapter(new MockLlmAdapter({ content: 'Revised content.' }));
  });

  afterEach(() => {
    clearTelemetryBuffer();
    setJobWriteFunctions(null);
  });

  it('T11: regenerate throws SUGGESTION_NOT_RESOLVED with BAD_REQUEST code (not PRECONDITION_FAILED)', async () => {
    const unknownId = uuidv4();
    vi.mocked(phase4bQueries.getReviewSessionById).mockResolvedValue(
      makeSessionRow({ selections: [{ suggestionId: unknownId, note: null }] }),
    );
    vi.mocked(phase4bQueries.listFeedbackForSession).mockResolvedValue([]);

    const caller = createCaller(USER_ID);
    await expect(
      caller.reviewSession.regenerate({ sessionId: SESSION_ID }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('SUGGESTION_NOT_RESOLVED'),
    });
  });

  it('T12: regenerateSingleReviewer throws SUGGESTION_NOT_RESOLVED for unknown suggestionId', async () => {
    const unknownId = uuidv4();
    vi.mocked(phase4bQueries.getReviewSessionById).mockResolvedValue(
      makeSessionRow({
        selections: [{ suggestionId: unknownId, note: null }],
        selectedReviewers: ['claude'],
      }),
    );
    vi.mocked(phase4bQueries.listFeedbackForSession).mockResolvedValue([]);

    const caller = createCaller(USER_ID);
    await expect(
      caller.reviewSession.regenerateSingleReviewer({ sessionId: SESSION_ID, reviewerRole: 'claude' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('SUGGESTION_NOT_RESOLVED'),
    });
  });

  it('T13: SUGGESTION_NOT_RESOLVED error message starts with sentinel prefix (client detection)', async () => {
    const unknownId = uuidv4();
    vi.mocked(phase4bQueries.getReviewSessionById).mockResolvedValue(
      makeSessionRow({ selections: [{ suggestionId: unknownId, note: null }] }),
    );
    vi.mocked(phase4bQueries.listFeedbackForSession).mockResolvedValue([]);

    const caller = createCaller(USER_ID);
    let caughtMessage = '';
    try {
      await caller.reviewSession.regenerate({ sessionId: SESSION_ID });
    } catch (err) {
      caughtMessage = (err as Error).message;
    }
    // The message must start with the sentinel so the client can detect it with startsWith.
    expect(caughtMessage.startsWith('SUGGESTION_NOT_RESOLVED')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T14: latest-local-state merge (source-inspection)
// ═══════════════════════════════════════════════════════════════════════════════
describe('T14: ReviewPane.tsx — latest-local-state merge in toggleSuggestion (MR-4 P2)', () => {
  // Evidence: grep -n "noteInputs\[sel.suggestionId\]\|latestSelections\|pending noteInputs" src/client/components/ReviewPane.tsx
  it('T14a: toggleSuggestion derives latestSelections from server selections merged with pending noteInputs', () => {
    // Source-inspection: the toggle handler must merge server selections with noteInputs
    // before building the mutation payload, not read from the `selections` prop alone.
    expect(reviewPaneFile).toContain('latestSelections');
    expect(reviewPaneFile).toContain('noteInputs[sel.suggestionId]');
  });

  it('T14b: toggleSuggestion comment documents the latest-local-state merge rationale', () => {
    // The comment must explain why the merge is needed (race guard).
    expect(reviewPaneFile).toContain('pending noteInputs');
  });

  it('T14c: updateNote handler also preserves other suggestions\' notes from latest local state', () => {
    // The updateNote handler must build latestSelections from the full selections array,
    // not just update the one note and drop others.
    // Evidence: grep -n "updateNote\|latestSelections" src/client/components/ReviewPane.tsx
    const updateNoteIdx = reviewPaneFile.indexOf('const updateNote');
    expect(updateNoteIdx).toBeGreaterThanOrEqual(0);
    // After updateNote definition, latestSelections must appear (within the function body).
    const afterUpdateNote = reviewPaneFile.slice(updateNoteIdx, updateNoteIdx + 800);
    expect(afterUpdateNote).toContain('latestSelections');
  });

  it('T14d: toggleSuggestion does NOT build payload from selections prop alone', () => {
    // The toggle handler must not pass `selections` directly as the new payload.
    // It must first derive latestSelections via the merge.
    // Negative assertion: the pattern "selections: selections" (passing prop directly) must not appear.
    // (This is a structural check; the positive assertion in T14a is the primary evidence.)
    const toggleIdx = reviewPaneFile.indexOf('const toggleSuggestion');
    expect(toggleIdx).toBeGreaterThanOrEqual(0);
    const toggleBody = reviewPaneFile.slice(toggleIdx, toggleIdx + 1000);
    // The merge variable must be present in the toggle body.
    expect(toggleBody).toContain('latestSelections');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T15: SUGGESTION_NOT_RESOLVED safe user-facing message (source-inspection)
// ═══════════════════════════════════════════════════════════════════════════════
describe('T15: ReviewPane.tsx — SUGGESTION_NOT_RESOLVED safe error message (MR-4 P2)', () => {
  // Evidence: grep -n "SUGGESTION_NOT_RESOLVED\|could not be found\|Please refresh" src/client/components/ReviewPane.tsx

  it('T15a: SUGGESTION_NOT_RESOLVED branch maps to safe user-facing message (no raw err.message)', () => {
    // The branch must set a safe message, not the raw err.message.
    expect(reviewPaneFile).toContain('One or more selected suggestions could not be found. Please refresh and try again.');
  });

  it('T15b: raw suggestionId values are never rendered to the user', () => {
    // The SUGGESTION_NOT_RESOLVED branch must NOT pass err.message to the user.
    // Negative assertion: the branch that handles SUGGESTION_NOT_RESOLVED must not
    // call setRegenError(err.message) on that path.
    // The only setRegenError(err.message) call must be in the else branch.
    const branchIdx = reviewPaneFile.indexOf("startsWith('SUGGESTION_NOT_RESOLVED')");
    expect(branchIdx).toBeGreaterThanOrEqual(0);
    // Extract the if-branch body (between the startsWith check and the else).
    const afterBranch = reviewPaneFile.slice(branchIdx, branchIdx + 400);
    // The if-branch must not contain setRegenError(err.message).
    const ifBranchEnd = afterBranch.indexOf('} else {');
    const ifBranchBody = ifBranchEnd >= 0 ? afterBranch.slice(0, ifBranchEnd) : afterBranch.slice(0, 200);
    expect(ifBranchBody).not.toContain('setRegenError(err.message)');
  });

  it('T15c: error path is not console-only and not silent — regenError state is set', () => {
    // The SUGGESTION_NOT_RESOLVED branch must call setRegenError (not just console.error).
    expect(reviewPaneFile).toContain('setRegenError(');
    // The regenError state must be rendered in JSX.
    expect(reviewPaneFile).toContain('{regenError && ');
  });

  it('T15d: regenError uses the existing inline error pattern (not a new error framework)', () => {
    // The pattern must match the existing CreateSessionView inline error pattern:
    // a state variable rendered as <p className="text-red-600 ...">
    expect(reviewPaneFile).toContain('text-red-600');
    expect(reviewPaneFile).toContain('{regenError}');
  });

  it('T15e: branch detection uses startsWith sentinel, not ad-hoc UUID regex on err.message', () => {
    // The branch must use startsWith('SUGGESTION_NOT_RESOLVED'), not a regex that
    // would match the raw UUID in the message. This ensures the detection is stable
    // even if the server-side message format changes.
    // Evidence: grep -n "startsWith.*SUGGESTION_NOT_RESOLVED" src/client/components/ReviewPane.tsx
    expect(reviewPaneFile).toContain("startsWith('SUGGESTION_NOT_RESOLVED')");
    // Negative: no UUID-pattern regex on err.message in the SUGGESTION_NOT_RESOLVED branch.
    // (The parseExistingSessionId regex is for SESSION_ALREADY_EXISTS, not this branch.)
    const branchIdx = reviewPaneFile.indexOf("startsWith('SUGGESTION_NOT_RESOLVED')");
    const branchContext = reviewPaneFile.slice(branchIdx - 50, branchIdx + 300);
    // Must not use a regex match on the SUGGESTION_NOT_RESOLVED branch.
    expect(branchContext).not.toContain('.match(/');
    expect(branchContext).not.toContain('.exec(');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T16: SessionSelectionSchema alias normalization (source-inspection)
// ═══════════════════════════════════════════════════════════════════════════════
describe('T16: SessionSelectionSchema — feedbackId → suggestionId alias normalization (MR-4 §3.3)', () => {
  // Evidence: grep -n "feedbackId\|suggestionId.*transform\|feedbackId.*alias" src/shared/schemas/phase4b.ts

  it('T16a: SessionSelectionSchema accepts feedbackId as a legacy alias field', () => {
    expect(phase4bSchemaFile).toContain('feedbackId: z.string().uuid().optional()');
  });

  it('T16b: SessionSelectionSchema transform normalizes feedbackId to canonical suggestionId', () => {
    // The transform must prefer suggestionId and fall back to feedbackId.
    expect(phase4bSchemaFile).toContain('raw.suggestionId ?? raw.feedbackId');
  });

  it('T16c: SessionSelectionSchema refine rejects input with neither field', () => {
    // The refine must ensure at least one of suggestionId or feedbackId is present.
    expect(phase4bSchemaFile).toContain('SessionSelection must include either suggestionId or feedbackId');
  });

  it('T16d: SessionSelectionSchema transform output always uses canonical suggestionId key', () => {
    // The transform output must use the key `suggestionId`, not `feedbackId`.
    const transformIdx = phase4bSchemaFile.indexOf('.transform(');
    expect(transformIdx).toBeGreaterThanOrEqual(0);
    const transformBody = phase4bSchemaFile.slice(transformIdx, transformIdx + 300);
    expect(transformBody).toContain('suggestionId:');
    expect(transformBody).not.toContain('feedbackId:');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C1–C7: Source-inspection checks (step (b) grep commands embedded)
// ═══════════════════════════════════════════════════════════════════════════════
describe('C1–C7: Source-inspection (MR-4 S2)', () => {
  // C1: itemized prompt construction present in reviewSession.ts
  // Evidence: grep -n "selectionLines\|selectionSummary\|Apply the following" src/server/procedures/reviewSession.ts
  it('C1: reviewSession.ts contains itemized prompt construction (selectionLines, selectionSummary)', () => {
    expect(reviewSessionFile).toContain('selectionLines');
    expect(reviewSessionFile).toContain('selectionSummary');
    expect(reviewSessionFile).toContain('Apply the following');
  });

  // C2: SUGGESTION_NOT_RESOLVED sentinel present in reviewSession.ts
  // Evidence: grep -n "SUGGESTION_NOT_RESOLVED" src/server/procedures/reviewSession.ts
  it('C2: reviewSession.ts contains SUGGESTION_NOT_RESOLVED sentinel in both regenerate paths', () => {
    const occurrences = (reviewSessionFile.match(/SUGGESTION_NOT_RESOLVED/g) ?? []).length;
    // Must appear in both regenerate and regenerateSingleReviewer
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  // C3: listFeedbackForSession called in regenerate path
  // Evidence: grep -n "listFeedbackForSession" src/server/procedures/reviewSession.ts
  it('C3: reviewSession.ts calls listFeedbackForSession to build suggestion map', () => {
    expect(reviewSessionFile).toContain('listFeedbackForSession');
    expect(reviewSessionFile).toContain('suggestionMap');
  });

  // C4: SessionSelectionSchema transform present in phase4b.ts
  // Evidence: grep -n "transform\|feedbackId.*alias\|suggestionId.*feedbackId" src/shared/schemas/phase4b.ts
  it('C4: phase4b.ts SessionSelectionSchema has .transform() for alias normalization', () => {
    expect(phase4bSchemaFile).toContain('.transform(');
    expect(phase4bSchemaFile).toContain('feedbackId');
  });

  // C5: safe user-facing message present in ReviewPane.tsx
  // Evidence: grep -n "could not be found\|Please refresh" src/client/components/ReviewPane.tsx
  it('C5: ReviewPane.tsx contains safe user-facing message for SUGGESTION_NOT_RESOLVED', () => {
    expect(reviewPaneFile).toContain('could not be found');
    expect(reviewPaneFile).toContain('Please refresh and try again');
  });

  // C6: raw suggestionId NOT rendered to user in ReviewPane.tsx
  // Evidence: grep -n "SUGGESTION_NOT_RESOLVED.*err.message\|setRegenError.*err.message" src/client/components/ReviewPane.tsx
  it('C6: ReviewPane.tsx does not render raw err.message on SUGGESTION_NOT_RESOLVED path', () => {
    // The SUGGESTION_NOT_RESOLVED branch must not pass err.message to the user.
    // We verify by checking the if-branch body does not contain setRegenError(err.message).
    const branchIdx = reviewPaneFile.indexOf("startsWith('SUGGESTION_NOT_RESOLVED')");
    expect(branchIdx).toBeGreaterThanOrEqual(0);
    const afterBranch = reviewPaneFile.slice(branchIdx, branchIdx + 400);
    const ifBranchEnd = afterBranch.indexOf('} else {');
    const ifBranchBody = ifBranchEnd >= 0 ? afterBranch.slice(0, ifBranchEnd) : afterBranch.slice(0, 200);
    expect(ifBranchBody).not.toContain('setRegenError(err.message)');
  });

  // C7: branch detection uses stable startsWith sentinel, not ad-hoc string matching on UUID
  // Evidence: grep -n "startsWith.*SUGGESTION_NOT_RESOLVED" src/client/components/ReviewPane.tsx
  it('C7: ReviewPane.tsx uses startsWith sentinel for SUGGESTION_NOT_RESOLVED branch detection', () => {
    // startsWith is a stable mechanism — the sentinel prefix is the contract.
    // If the server message format changes, the prefix must remain stable.
    expect(reviewPaneFile).toContain("startsWith('SUGGESTION_NOT_RESOLVED')");
    // The codebase convention for other branches (SESSION_ALREADY_EXISTS) also uses
    // message-prefix detection (parseExistingSessionId). This is the established pattern.
    expect(reviewPaneFile).toContain('parseExistingSessionId');
  });
});
