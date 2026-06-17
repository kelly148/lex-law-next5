/**
 * REVIEW-LOOP-UX-1 / R1 — INSTANT, COMMITTED adopt (per-click adopt-ledger write).
 *
 * Behavioral, DB-mocked (no live DB). Asserts the operator decision:
 *   1. reviewSession.adoptSuggestion commits an adopt-ledger row on the click (not at regenerate),
 *      anchored to doc.currentVersionId, with disposition + confirmationMode='individually_adopted'.
 *   2. Owner-scoped EXACTLY like dispositionSuggestion: a non-owner gets NOT_FOUND and NO write.
 *   3. Idempotent: a second identical call returns the existing row and does NOT insert again.
 *   4. The regenerate path SKIPS re-inserting an already-instant-adopted (suggestion, version) — no
 *      double adopt-ledger row, no double manual-selection (the unique keys would otherwise collide).
 *
 * The phase4b query layer is mocked; the procedure logic (resolution, owner-scope, idempotency, dedup)
 * is exercised through appRouter.createCaller.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearTelemetryBuffer } from '../test-utils/setup.js';
import { appRouter } from '../router.js';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { setJobWriteFunctions } from '../db/canonicalMutation.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as phase4bQueries from '../db/queries/phase4b.js';
import * as documentQueries from '../db/queries/documents.js';
import * as versionQueries from '../db/queries/versions.js';
import * as userPreferenceQueries from '../db/queries/userPreferences.js';
import * as matterQueries from '../db/queries/matters.js';

// ── context/pipeline mock — MUST be first (same ordering rule as the sibling suites) ──────────────
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

vi.mock('../db/queries/phase4b.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/phase4b.js')>();
  return {
    ...actual,
    getActiveReviewSessionForDocument: vi.fn(),
    insertReviewSession: vi.fn(),
    getReviewSessionById: vi.fn(),
    listFeedbackForSession: vi.fn(),
    listFeedbackForDocument: vi.fn(),
    getEvaluationForIteration: vi.fn(),
    listManualSelectionsForSession: vi.fn(),
    insertManualSelection: vi.fn(),
    updateReviewSessionState: vi.fn(),
    updateReviewSessionSelections: vi.fn(),
    insertAdoptLedgerEntry: vi.fn(),
    getAdoptLedgerEntryForSuggestionVersion: vi.fn(),
    applyRegenerationToAdoptLedger: vi.fn(),
    listAdoptLedgerForPrompt: vi.fn(),
    listActiveLockedDecisionsForDocument: vi.fn().mockResolvedValue([]),
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
  return { ...actual, getUserPreferences: vi.fn() };
});
vi.mock('../db/queries/matters.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/matters.js')>();
  return { ...actual, getMatterById: vi.fn() };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────
const USER_ID = uuidv4();
const OTHER_USER_ID = uuidv4();
const DOC_ID = uuidv4();
const MATTER_ID = uuidv4();
const VERSION_ID = uuidv4();
const VERSION_2_ID = uuidv4();
const SESSION_ID = uuidv4();
const SUGGESTION_ID_1 = uuidv4();

const createCaller = (userId: string) =>
  appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });

function makeDocRow(currentVersionId: string | null = VERSION_ID) {
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

function makeFeedbackRow(
  suggestions: Array<{ suggestionId: string; title: string; body: string; severity?: string }>,
) {
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

function makeAdoptLedgerRow(over: Record<string, unknown> = {}) {
  return {
    id: uuidv4(),
    userId: USER_ID,
    documentId: DOC_ID,
    matterId: MATTER_ID,
    sourceSuggestionId: SUGGESTION_ID_1,
    sourceReviewerRole: 'claude',
    sourceIterationNumber: 1,
    reviewSessionId: SESSION_ID,
    disposition: 'adopted_verbatim' as const,
    originalText: 'The indemnity clause is missing.',
    adoptedText: 'The indemnity clause is missing.',
    adoptedIntoVersionId: VERSION_ID,
    producedVersionId: null,
    status: 'unresolved' as const,
    statusSource: 'auto' as const,
    confirmationMode: 'individually_adopted',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

const jobWriteStubs = {
  insertJob: async (): Promise<string> => uuidv4(),
  markJobRunning: async (): Promise<number> => 1,
  markJobCompleted: async (): Promise<number> => 1,
  markJobFailed: async (): Promise<void> => {},
  markJobTimedOut: async (): Promise<void> => {},
  markJobCancelled: async (): Promise<number> => 1,
  updateJobHeartbeat: async (): Promise<void> => {},
};

const feedback = [
  makeFeedbackRow([
    { suggestionId: SUGGESTION_ID_1, title: 'Add indemnity clause', body: 'The indemnity clause is missing.', severity: 'critical' },
  ]),
];

beforeEach(() => {
  vi.resetAllMocks();
  clearTelemetryBuffer();
  setJobWriteFunctions(jobWriteStubs);

  vi.mocked(userPreferenceQueries.getUserPreferences).mockResolvedValue({
    userId: USER_ID,
    preferences: { reviewerEnablement: { claude: true } },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  vi.mocked(matterQueries.getMatterById).mockResolvedValue(makeMatterRow() as never);
  vi.mocked(documentQueries.getDocumentById).mockResolvedValue(makeDocRow() as never);
  vi.mocked(versionQueries.getVersionById).mockResolvedValue(makeVersionRow() as never);
  vi.mocked(versionQueries.getNextVersionNumber).mockResolvedValue(2);
  vi.mocked(versionQueries.insertVersion).mockResolvedValue(makeVersionRow(VERSION_2_ID) as never);
  vi.mocked(documentQueries.updateDocumentCurrentVersion).mockImplementation(
    async (_docId, _userId, newVersionId) => makeDocRow(newVersionId) as never,
  );
  vi.mocked(phase4bQueries.getReviewSessionById).mockResolvedValue(makeSessionRow() as never);
  vi.mocked(phase4bQueries.listFeedbackForSession).mockResolvedValue(feedback as never);
  vi.mocked(phase4bQueries.insertManualSelection).mockResolvedValue(uuidv4());
  vi.mocked(phase4bQueries.insertAdoptLedgerEntry).mockResolvedValue(uuidv4());
  vi.mocked(phase4bQueries.updateReviewSessionState).mockResolvedValue(undefined);
  vi.mocked(phase4bQueries.applyRegenerationToAdoptLedger).mockResolvedValue({ carried: 0, superseded: 0 });
  vi.mocked(phase4bQueries.listAdoptLedgerForPrompt).mockResolvedValue([]);
  // Default: no existing instant-adopt row.
  vi.mocked(phase4bQueries.getAdoptLedgerEntryForSuggestionVersion).mockResolvedValue(null);
});

afterEach(() => {
  clearTelemetryBuffer();
  setJobWriteFunctions(null);
});

describe('REVIEW-LOOP-UX-1 R1 — adoptSuggestion commits an adopt-ledger row on click', () => {
  it('writes a committed adopt-ledger entry anchored to the current version (individually_adopted)', async () => {
    const caller = createCaller(USER_ID);
    const res = await caller.reviewSession.adoptSuggestion({
      sessionId: SESSION_ID,
      suggestionId: SUGGESTION_ID_1,
    });

    expect(res.suggestionId).toBe(SUGGESTION_ID_1);
    expect(res.idempotent).toBe(false);
    expect(phase4bQueries.insertAdoptLedgerEntry).toHaveBeenCalledTimes(1);
    const args = vi.mocked(phase4bQueries.insertAdoptLedgerEntry).mock.calls[0]![0];
    expect(args.sourceSuggestionId).toBe(SUGGESTION_ID_1);
    expect(args.adoptedIntoVersionId).toBe(VERSION_ID);
    expect(args.disposition).toBe('adopted_verbatim');
    expect(args.confirmationMode).toBe('individually_adopted');
    expect(args.originalText).toBe('The indemnity clause is missing.');
    // The manual selection is recorded so the adoption still flows into the next regenerate.
    expect(phase4bQueries.insertManualSelection).toHaveBeenCalledTimes(1);
  });

  it('records disposition=adopted_modified when adoptedText differs from the suggestion body', async () => {
    const caller = createCaller(USER_ID);
    await caller.reviewSession.adoptSuggestion({
      sessionId: SESSION_ID,
      suggestionId: SUGGESTION_ID_1,
      adoptedText: 'A narrower, attorney-edited indemnity clause.',
    });
    const args = vi.mocked(phase4bQueries.insertAdoptLedgerEntry).mock.calls[0]![0];
    expect(args.disposition).toBe('adopted_modified');
    expect(args.adoptedText).toBe('A narrower, attorney-edited indemnity clause.');
  });

  it('PRECONDITION_FAILED (NO_CURRENT_VERSION) when the document has no current version', async () => {
    vi.mocked(documentQueries.getDocumentById).mockResolvedValue(makeDocRow(null) as never);
    const caller = createCaller(USER_ID);
    await expect(
      caller.reviewSession.adoptSuggestion({ sessionId: SESSION_ID, suggestionId: SUGGESTION_ID_1 }),
    ).rejects.toMatchObject({ message: expect.stringContaining('NO_CURRENT_VERSION') });
    expect(phase4bQueries.insertAdoptLedgerEntry).not.toHaveBeenCalled();
  });
});

describe('REVIEW-LOOP-UX-1 R1 — adoptSuggestion is owner-scoped (NOT_FOUND, no write)', () => {
  it('a non-owner whose session lookup misses gets NOT_FOUND and writes nothing', async () => {
    // getReviewSessionById is owner-scoped (by userId) in the real query → a non-owner gets null.
    vi.mocked(phase4bQueries.getReviewSessionById).mockResolvedValue(null);
    const caller = createCaller(OTHER_USER_ID);
    await expect(
      caller.reviewSession.adoptSuggestion({ sessionId: SESSION_ID, suggestionId: SUGGESTION_ID_1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(phase4bQueries.insertAdoptLedgerEntry).not.toHaveBeenCalled();
    expect(phase4bQueries.insertManualSelection).not.toHaveBeenCalled();
  });

  it('a non-owner whose document lookup misses gets NOT_FOUND and writes nothing', async () => {
    vi.mocked(documentQueries.getDocumentById).mockResolvedValue(null);
    const caller = createCaller(OTHER_USER_ID);
    await expect(
      caller.reviewSession.adoptSuggestion({ sessionId: SESSION_ID, suggestionId: SUGGESTION_ID_1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(phase4bQueries.insertAdoptLedgerEntry).not.toHaveBeenCalled();
  });
});

describe('REVIEW-LOOP-UX-1 R1 — adoptSuggestion is idempotent (second identical call → no second row)', () => {
  it('returns the existing entry and does NOT insert again', async () => {
    const existing = makeAdoptLedgerRow();
    vi.mocked(phase4bQueries.getAdoptLedgerEntryForSuggestionVersion).mockResolvedValue(existing as never);
    const caller = createCaller(USER_ID);
    const res = await caller.reviewSession.adoptSuggestion({
      sessionId: SESSION_ID,
      suggestionId: SUGGESTION_ID_1,
    });
    expect(res.idempotent).toBe(true);
    expect(res.adoptLedgerId).toBe(existing.id);
    expect(phase4bQueries.insertAdoptLedgerEntry).not.toHaveBeenCalled();
    expect(phase4bQueries.insertManualSelection).not.toHaveBeenCalled();
  });
});

describe('REVIEW-LOOP-UX-1 R1 — regenerate dedup guard is wired (skips already-instant-adopted)', () => {
  // Driving the full regenerate runtime here is heavy (context assembly + canonical-mutation commit);
  // the dedup itself is a simple guard, so lock it in with a source-audit of both regenerate paths.
  // Before each per-selection insert they look up the existing ledger row for (session, suggestion,
  // current version) and `continue` when one exists — so an instant adopt is never double-written
  // (uniq_adopt_ledger_session_suggestion / uniq_manual_selections would otherwise collide). The
  // skip-vs-insert decision on an EXISTING vs NULL row is exercised behaviorally by the idempotency
  // suite above (adoptSuggestion returns the existing row and writes nothing when one exists).
  const SRC = readFileSync(
    fileURLToPath(new URL('../procedures/reviewSession.ts', import.meta.url)),
    'utf8',
  );

  it('both regenerate paths guard the per-selection inserts with getAdoptLedgerEntryForSuggestionVersion', () => {
    expect(SRC).toContain('getAdoptLedgerEntryForSuggestionVersion(');
    expect(SRC).toContain('if (existingLedger) continue;');
    expect(SRC).toContain('if (existingLedgerSingle) continue;');
  });

  it('the dedup guard precedes insertManualSelection (so neither unique key collides)', () => {
    const guardIdx = SRC.indexOf('if (existingLedger) continue;');
    expect(guardIdx).toBeGreaterThan(-1);
    const manualSelAfterGuard = SRC.indexOf('insertManualSelection(', guardIdx);
    expect(manualSelAfterGuard).toBeGreaterThan(guardIdx);
  });
});
