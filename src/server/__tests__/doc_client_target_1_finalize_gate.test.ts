/**
 * DOC-CLIENT-TARGET-1 — §6 finalize gate, PROCEDURE-LEVEL integration.
 *
 * Closes the residual from the 2026-06-09 Pattern-16 live-verify (UAT step 5): the live UI could not
 * be driven into a mismatched draft — the upstream identity-layer generation scoping robustly kept the
 * bound subject's name in every regeneration, and the shipped build exposes no draft-content editor or
 * re-target control — so the hard-stop's FIRING branch was only ever verified at the pure-unit and
 * source-audit level (inc2/inc5), never through the real `document.finalize` procedure.
 *
 * This drives `document.finalize` end-to-end with the DB/validation layers mocked but the REAL
 * `evaluateTargetConsistency` running, and asserts the deterministic §6 backstop:
 *   - a draft naming the WRONG client (the cross-wire) hard-stops with TARGET_CONSISTENCY_MISMATCH;
 *   - a structurally-invalid target hard-stops with TARGETING_INVALID, and does so BEFORE the
 *     text-consistency check (precedence);
 *   - a CORRECT (matching) draft is NOT stopped by the §6 consistency check.
 *
 * No test DB: the query layers + the structural validator + the subject-scope resolver are mocked;
 * targetConsistency.ts is intentionally NOT mocked so the real matcher runs through the procedure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response } from 'express';
import type { DocumentRow, MatterRow } from '../../shared/schemas/matters.js';

// ── Mock the layers document.finalize touches before the §6 check (no DB) ─────
import * as documentQueries from '../db/queries/documents.js';
import * as matterQueries from '../db/queries/matters.js';
import * as versionQueries from '../db/queries/versions.js';
import * as referenceQueries from '../db/queries/references.js';
import * as targetingValidation from '../documents/targetingValidation.js';
import * as draftingSubject from '../documents/draftingSubject.js';

vi.mock('../db/queries/documents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/documents.js')>();
  return { ...actual, getDocumentById: vi.fn() };
});
vi.mock('../db/queries/matters.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/matters.js')>();
  return { ...actual, getMatterById: vi.fn() };
});
vi.mock('../db/queries/versions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/versions.js')>();
  return { ...actual, getVersionById: vi.fn() };
});
vi.mock('../db/queries/references.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/references.js')>();
  return { ...actual, listReferencesForDocument: vi.fn(), detectStaleReferences: vi.fn() };
});
vi.mock('../documents/targetingValidation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../documents/targetingValidation.js')>();
  return { ...actual, validateTargetingForFinalize: vi.fn() };
});
vi.mock('../documents/draftingSubject.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../documents/draftingSubject.js')>();
  return { ...actual, resolveDraftingSubjectScope: vi.fn() };
});
// NOTE: '../documents/targetConsistency.js' is deliberately NOT mocked — the real matcher must run.

import { appRouter } from '../router.js';

const USER_ID = uuidv4();
const MATTER_ID = uuidv4();
const DOC_ID = uuidv4();
const VERSION_ID = uuidv4();

const SUBJECT = 'Sarah Testclient';
const OTHER = 'Gregory Testclient';

const createCaller = (userId: string) =>
  appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });

function makeMatterRow(): MatterRow {
  return {
    id: MATTER_ID,
    userId: USER_ID,
    title: 'ZZ Joint EP',
    clientName: SUBJECT,
    practiceArea: 'estate_planning',
    phase: 'drafting',
    analysisStatus: 'none',
    archivedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeDocRow(): DocumentRow {
  return {
    id: DOC_ID,
    userId: USER_ID,
    matterId: MATTER_ID,
    title: 'ZZ Durable POA',
    documentType: 'durable_poa',
    customTypeLabel: null,
    draftingMode: 'iterative',
    templateBindingStatus: 'detached',
    templateVersionId: null,
    templateSnapshot: null,
    variableMap: null,
    workflowState: 'substantively_accepted',
    currentVersionId: VERSION_ID,
    officialSubstantiveVersionNumber: 1,
    officialFinalVersionNumber: null,
    completedAt: null,
    archivedAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Stand up the path so finalize reaches the §6 check: a substantively-accepted individual_subject
// doc, no stale references, a real matter + current version, structurally-valid targeting.
function primeHappyPath(draftContent: string): void {
  vi.mocked(documentQueries.getDocumentById).mockResolvedValue(makeDocRow());
  vi.mocked(matterQueries.getMatterById).mockResolvedValue(makeMatterRow());
  vi.mocked(referenceQueries.listReferencesForDocument).mockResolvedValue([]);
  vi.mocked(referenceQueries.detectStaleReferences).mockResolvedValue([]);
  vi.mocked(versionQueries.getVersionById).mockResolvedValue({
    content: draftContent,
  } as Awaited<ReturnType<typeof versionQueries.getVersionById>>);
  vi.mocked(targetingValidation.validateTargetingForFinalize).mockResolvedValue({ ok: true });
  vi.mocked(draftingSubject.resolveDraftingSubjectScope).mockResolvedValue({
    kind: 'individual_subject',
    scoped: true,
    subjectName: SUBJECT,
    subjectRoleLabel: 'Principal',
    otherClientNames: [OTHER],
  } as Awaited<ReturnType<typeof draftingSubject.resolveDraftingSubjectScope>>);
}

describe('DOC-CLIENT-TARGET-1 §6: document.finalize hard-stop (procedure-level)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('WRONG principal — draft names the other client, not the bound subject → TARGET_CONSISTENCY_MISMATCH', async () => {
    // The cross-wire: bound subject is Sarah, but the draft names Gregory (and never Sarah).
    primeHappyPath(
      'DURABLE GENERAL POWER OF ATTORNEY OF GREGORY TESTCLIENT. ' +
        'KNOW ALL PERSONS, that I, Gregory Testclient, appoint my attorney-in-fact...',
    );
    const caller = createCaller(USER_ID);
    await expect(caller.document.finalize({ documentId: DOC_ID })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    try {
      await caller.document.finalize({ documentId: DOC_ID });
      throw new Error('expected finalize to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const msg = (err as TRPCError).message;
      expect(msg).toContain('TARGET_CONSISTENCY_MISMATCH');
      expect(msg).toContain('Do not finalize until resolved.');
      // the reason names the wrong client that DID appear, and the bound subject that did not
      expect(msg).toMatch(/Gregory Testclient/);
      expect(msg).toMatch(/Sarah Testclient/);
    }
  });

  it('subject simply absent (no client named) → TARGET_CONSISTENCY_MISMATCH', async () => {
    primeHappyPath('A GENERIC POWER OF ATTORNEY with [PRINCIPAL] placeholders and no real name.');
    const caller = createCaller(USER_ID);
    await expect(caller.document.finalize({ documentId: DOC_ID })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('TARGET_CONSISTENCY_MISMATCH'),
    });
  });

  it('structural target invalid → TARGETING_INVALID, and it fires BEFORE the text-consistency check', async () => {
    // Draft text would ALSO mismatch (names Gregory), but structural validation must trip first.
    primeHappyPath('I, Gregory Testclient, appoint my agent...');
    vi.mocked(targetingValidation.validateTargetingForFinalize).mockResolvedValue({
      ok: false,
      code: 'NO_SUBJECT',
      message: 'This individual document has no bound subject.',
    });
    const caller = createCaller(USER_ID);
    try {
      await caller.document.finalize({ documentId: DOC_ID });
      throw new Error('expected finalize to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const msg = (err as TRPCError).message;
      expect(msg).toContain('TARGETING_INVALID');
      expect(msg).not.toContain('TARGET_CONSISTENCY_MISMATCH');
    }
  });

  it('CORRECT draft — names the bound subject → NOT stopped by the §6 consistency check', async () => {
    // Negative control: a matching draft must pass the §6 gate. The procedure continues past the
    // check into the formatting/enqueue tail (not mocked here); whatever happens downstream, it must
    // NOT be the §6 mismatch stop.
    primeHappyPath(
      'DURABLE GENERAL POWER OF ATTORNEY OF SARAH TESTCLIENT. ' +
        'KNOW ALL PERSONS, that I, Sarah Testclient, appoint my agent...',
    );
    const caller = createCaller(USER_ID);
    let mismatchStopped = false;
    try {
      await caller.document.finalize({ documentId: DOC_ID });
    } catch (err) {
      if (err instanceof TRPCError && /TARGET_CONSISTENCY_MISMATCH|TARGETING_INVALID/.test(err.message)) {
        mismatchStopped = true;
      }
    }
    expect(mismatchStopped).toBe(false);
  });
});
