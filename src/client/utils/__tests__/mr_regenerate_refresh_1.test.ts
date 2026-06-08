/**
 * mr_regenerate_refresh_1.test.ts — MR-REGENERATE-REFRESH-1
 *
 * Tests for the regenerated-version visibility fix.
 *
 * Failure mechanism classified: C (Client invalidation/refetch issue).
 * executeCanonicalMutation is synchronous — the new version is in the DB
 * by the time reviewSession.regenerate returns. The pre-fix
 * regenerateMutation.onSuccess in ReviewPane.tsx only invalidated
 * reviewSession.get; it did not invalidate document.get or version.list.
 * JobBanner polling cannot be relied upon because the regeneration job
 * is already terminal when the mutation returns.
 *
 * Fix: add utils.document.get.invalidate({ documentId }) and
 * utils.version.list.invalidate({ documentId }) to the regenerateMutation
 * onSuccess handler in ActiveSessionView (ReviewPane.tsx).
 *
 * Test strategy: source-analysis tests (node environment, no DOM rendering),
 * consistent with the project's vitest node-environment configuration and
 * the pattern established by mr3.behavioral.test.ts.
 *
 * T-REGEN-1: regenerate onSuccess invalidates version.list
 * T-REGEN-2: regenerate onSuccess invalidates document.get
 * T-REGEN-3: regenerated version is linked to correct document (server path)
 * T-REGEN-4: accept-feedback state is preserved through regenerate
 * T-REGEN-5: regeneration failure surfaces visibly
 * T-REGEN-6: no duplicate or stale version selection
 * T-REGEN-7: existing version history behavior does not regress
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, 'src', relPath), 'utf-8');
}

// ============================================================
// T-REGEN-1 — regenerate onSuccess invalidates version.list
// ============================================================
describe('T-REGEN-1: regenerate onSuccess invalidates version.list', () => {
  const reviewPane = readSrc('client/components/ReviewPane.tsx');

  it('regenerateMutation onSuccess calls utils.version.list.invalidate', () => {
    expect(reviewPane).toContain('utils.version.list.invalidate({ documentId })');
  });

  it('version.list invalidation is inside the regenerateMutation onSuccess block', () => {
    // Verify the invalidation appears in the correct context — after the
    // reviewSession.regenerate mutation definition and before onClose().
    const regenMutationBlock = reviewPane.slice(
      reviewPane.indexOf('const regenerateMutation = useGuardedMutation'),
      reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
    );
    expect(regenMutationBlock).toContain('utils.version.list.invalidate({ documentId })');
  });

  it('version.list invalidation uses the documentId prop (not a hardcoded string)', () => {
    // Confirm the invalidation references the documentId variable, not a literal.
    const regenMutationBlock = reviewPane.slice(
      reviewPane.indexOf('const regenerateMutation = useGuardedMutation'),
      reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
    );
    expect(regenMutationBlock).toMatch(/utils\.version\.list\.invalidate\(\s*\{\s*documentId\s*\}\s*\)/);
  });

  it('MR-REGENERATE-REFRESH-1 comment is present in the onSuccess block', () => {
    expect(reviewPane).toContain('MR-REGENERATE-REFRESH-1');
  });
});

// ============================================================
// T-REGEN-2 — regenerate onSuccess invalidates document.get
// ============================================================
describe('T-REGEN-2: regenerate onSuccess invalidates document.get', () => {
  const reviewPane = readSrc('client/components/ReviewPane.tsx');

  it('regenerateMutation onSuccess calls utils.document.get.invalidate', () => {
    expect(reviewPane).toContain('utils.document.get.invalidate({ documentId })');
  });

  it('document.get invalidation is inside the regenerateMutation onSuccess block', () => {
    const regenMutationBlock = reviewPane.slice(
      reviewPane.indexOf('const regenerateMutation = useGuardedMutation'),
      reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
    );
    expect(regenMutationBlock).toContain('utils.document.get.invalidate({ documentId })');
  });

  it('onSuccess still calls onClose() after invalidations', () => {
    const regenMutationBlock = reviewPane.slice(
      reviewPane.indexOf('const regenerateMutation = useGuardedMutation'),
      reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
    );
    // onClose() must appear after the invalidations
    const versionInvalidatePos = regenMutationBlock.indexOf('utils.version.list.invalidate');
    const onClosePos = regenMutationBlock.indexOf('onClose()');
    expect(versionInvalidatePos).toBeGreaterThan(-1);
    expect(onClosePos).toBeGreaterThan(versionInvalidatePos);
  });

  it('reviewSession.get invalidation is preserved', () => {
    const regenMutationBlock = reviewPane.slice(
      reviewPane.indexOf('const regenerateMutation = useGuardedMutation'),
      reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
    );
    expect(regenMutationBlock).toContain('utils.reviewSession.get.invalidate({ sessionId })');
  });
});

// ============================================================
// T-REGEN-3 — regenerated version is linked to correct document
// Server-side: _invokeDocumentRegenerate inserts version with
// correct documentId and updates document.currentVersionId.
// ============================================================
describe('T-REGEN-3: regenerated version is linked to correct document', () => {
  const reviewSessionTs = readSrc('server/procedures/reviewSession.ts');

  it('_invokeDocumentRegenerate calls insertVersion with the documentId', () => {
    expect(reviewSessionTs).toContain('insertVersion(');
    // The insertVersion call is inside _invokeDocumentRegenerate which receives documentId
    const invokeBlock = reviewSessionTs.slice(
      reviewSessionTs.indexOf('async function _invokeDocumentRegenerate('),
    );
    expect(invokeBlock).toContain('documentId,');
    expect(invokeBlock).toContain('insertVersion(');
  });

  it('_invokeDocumentRegenerate calls updateDocumentCurrentVersion after insertVersion', () => {
    const invokeBlock = reviewSessionTs.slice(
      reviewSessionTs.indexOf('async function _invokeDocumentRegenerate('),
    );
    const insertVersionPos = invokeBlock.indexOf('insertVersion(');
    const updateCurrentPos = invokeBlock.indexOf('updateDocumentCurrentVersion(');
    expect(insertVersionPos).toBeGreaterThan(-1);
    expect(updateCurrentPos).toBeGreaterThan(insertVersionPos);
  });

  it('regenerate procedure returns jobId and status from _invokeDocumentRegenerate', () => {
    expect(reviewSessionTs).toContain('return { jobId: result.jobId, status: result.status }');
  });

  it('version is inserted with iterationNumber derived from currentVersion', () => {
    const invokeBlock = reviewSessionTs.slice(
      reviewSessionTs.indexOf('async function _invokeDocumentRegenerate('),
    );
    expect(invokeBlock).toContain('nextIterationNumber');
    expect(invokeBlock).toContain('currentVersion.iterationNumber + 1');
  });
});

// ============================================================
// T-REGEN-4 — accept-feedback state is preserved through regenerate
// The regenerate mutation in ReviewPane builds instructions from
// session.selections — accepted feedback is not dropped.
// ============================================================
describe('T-REGEN-4: accept-feedback state is preserved through regenerate', () => {
  const reviewSessionTs = readSrc('server/procedures/reviewSession.ts');
  const reviewPane = readSrc('client/components/ReviewPane.tsx');

  it('regenerate procedure reads session.selections before invoking document regenerate', () => {
    const regenBlock = reviewSessionTs.slice(
      reviewSessionTs.indexOf('regenerate: protectedProcedure'),
      reviewSessionTs.indexOf('regenerateSingleReviewer: protectedProcedure'),
    );
    expect(regenBlock).toContain('session.selections');
    expect(regenBlock).toContain('insertManualSelection(');
  });

  it('regenerate procedure validates at least one selection or global instructions', () => {
    const regenBlock = reviewSessionTs.slice(
      reviewSessionTs.indexOf('regenerate: protectedProcedure'),
      reviewSessionTs.indexOf('regenerateSingleReviewer: protectedProcedure'),
    );
    expect(regenBlock).toContain('REVIEW_SESSION_EMPTY');
  });

  it('apply button stays enabled at 0 accepted with a dynamic label (REVIEW-UX-REDESIGN-1)', () => {
    // The apply button is no longer dead-ended at zero selections; it reads
    // "Generate revised draft (new iteration)" and is gated only on the in-flight mutation.
    expect(reviewPane).toContain('Generate revised draft (new iteration)');
    expect(reviewPane).not.toContain('totalSelected === 0');
  });

  it('fix does not change the regenerateMutation input shape', () => {
    // The mutation still takes { sessionId } — no new fields added.
    const regenMutationBlock = reviewPane.slice(
      reviewPane.indexOf('const regenerateMutation = useGuardedMutation'),
      reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
    );
    expect(regenMutationBlock).toContain('reviewSession.regenerate.mutate(input)');
    expect(regenMutationBlock).toContain('sessionId: string');
  });
});

// ============================================================
// T-REGEN-5 — regeneration failure surfaces visibly
// ============================================================
describe('T-REGEN-5: regeneration failure surfaces visibly', () => {
  const reviewPane = readSrc('client/components/ReviewPane.tsx');

  it('regenerateMutation has an onError handler', () => {
    const regenMutationBlock = reviewPane.slice(
      reviewPane.indexOf('const regenerateMutation = useGuardedMutation'),
      reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
    );
    expect(regenMutationBlock).toContain('onError:');
    expect(regenMutationBlock).toContain('setRegenError(');
  });

  it('regenError is rendered in the footer actions', () => {
    // REVIEW-UX-REDESIGN-1 re-roled the off-palette text-red-600 to the wa token text-danger.
    expect(reviewPane).toContain('{regenError && <p className="text-danger text-sm">{regenError}</p>}');
  });

  it('SUGGESTION_NOT_RESOLVED sentinel is handled with a user-safe message', () => {
    expect(reviewPane).toContain("startsWith('SUGGESTION_NOT_RESOLVED')");
    expect(reviewPane).toContain('One or more selected suggestions could not be found');
  });

  it('onError handler does not suppress non-sentinel errors', () => {
    const regenMutationBlock = reviewPane.slice(
      reviewPane.indexOf('const regenerateMutation = useGuardedMutation'),
      reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
    );
    // The else branch sets regenError to err.message (not a generic message).
    expect(regenMutationBlock).toContain('setRegenError(err.message)');
  });
});

// ============================================================
// T-REGEN-6 — no duplicate or stale version selection
// The fix invalidates version.list so the query refetches from
// the server — no local state duplication.
// ============================================================
describe('T-REGEN-6: no duplicate or stale version selection', () => {
  const reviewPane = readSrc('client/components/ReviewPane.tsx');
  const documentDetail = readSrc('client/pages/DocumentDetail.tsx');

  it('VersionHistory uses trpc.version.list.useQuery (server-authoritative)', () => {
    expect(documentDetail).toContain('trpc.version.list.useQuery({ documentId })');
  });

  it('VersionHistory does not maintain a local copy of the version list', () => {
    // The component derives versionList directly from the query result.
    expect(documentDetail).toContain('const versionList = versions ?? []');
  });

  it('fix does not add any local version state to ReviewPane', () => {
    // No new useState for versions in ReviewPane after the fix.
    const fixComment = reviewPane.indexOf('MR-REGENERATE-REFRESH-1');
    const nextUseState = reviewPane.indexOf('useState', fixComment);
    const nextMutation = reviewPane.indexOf('useGuardedMutation', fixComment);
    // The next useState after the fix comment should not be for versions.
    if (nextUseState !== -1 && nextMutation !== -1) {
      // The fix only adds invalidate calls — no new state.
      const fixBlock = reviewPane.slice(fixComment, nextMutation);
      expect(fixBlock).not.toContain('useState');
    }
  });

  it('version.list invalidation causes a server refetch (not a local merge)', () => {
    // Confirm the fix uses invalidate (triggers refetch) not setQueryData (local merge).
    const regenMutationBlock = reviewPane.slice(
      reviewPane.indexOf('const regenerateMutation = useGuardedMutation'),
      reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
    );
    expect(regenMutationBlock).toContain('utils.version.list.invalidate');
    expect(regenMutationBlock).not.toContain('setQueryData');
  });
});

// ============================================================
// T-REGEN-7 — existing version history behavior does not regress
// ============================================================
describe('T-REGEN-7: existing version history behavior does not regress', () => {
  const documentDetail = readSrc('client/pages/DocumentDetail.tsx');
  const reviewPane = readSrc('client/components/ReviewPane.tsx');

  it('JobBanner still invalidates document.get and version.list on job completion', () => {
    // JobBanner useEffect: when activeJob disappears, invalidate both queries.
    expect(documentDetail).toContain('utils.document.get.invalidate({ documentId })');
    expect(documentDetail).toContain('utils.version.list.invalidate({ documentId })');
  });

  it('VersionHistory still renders version list from trpc.version.list query', () => {
    expect(documentDetail).toContain('trpc.version.list.useQuery({ documentId })');
    expect(documentDetail).toContain('Version History');
  });

  it('ReviewPane still closes after successful regeneration (onClose is called)', () => {
    const regenMutationBlock = reviewPane.slice(
      reviewPane.indexOf('const regenerateMutation = useGuardedMutation'),
      reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
    );
    expect(regenMutationBlock).toContain('onClose()');
  });

  it('abandon mutation behavior is unchanged', () => {
    const abandonBlock = reviewPane.slice(
      reviewPane.indexOf('const abandonMutation = useGuardedMutation'),
      reviewPane.indexOf('const updateInstructionsMutation = useGuardedMutation'),
    );
    expect(abandonBlock).toContain('utils.reviewSession.get.invalidate({ sessionId })');
    expect(abandonBlock).toContain('onClose()');
    // Abandon does NOT invalidate version.list (correct — no new version on abandon).
    expect(abandonBlock).not.toContain('utils.version.list.invalidate');
  });

  it('document.regenerate mutation in DocumentDetail still invalidates job.listForDocument', () => {
    // The direct regenerate path (not via ReviewPane) must still work.
    const regenBlock = documentDetail.slice(
      documentDetail.indexOf('const regenerateMutation = useGuardedMutation'),
      documentDetail.indexOf('const acceptSubstantiveMutation = useGuardedMutation'),
    );
    expect(regenBlock).toContain('utils.job.listForDocument.invalidate');
  });

  it('fix is limited to ReviewPane.tsx — DocumentDetail.tsx is not modified', () => {
    // DocumentDetail.tsx regenerateMutation does NOT have the new version.list invalidation
    // (it uses a different code path: document.regenerate, not reviewSession.regenerate).
    // This test confirms the two paths remain distinct.
    const docDetailRegenBlock = documentDetail.slice(
      documentDetail.indexOf('const regenerateMutation = useGuardedMutation'),
      documentDetail.indexOf('const acceptSubstantiveMutation = useGuardedMutation'),
    );
    // The DocumentDetail regenerateMutation is for document.regenerate (direct path),
    // not the review-session path. It should not have been modified by this engagement.
    expect(docDetailRegenBlock).toContain('document.regenerate.mutate');
    expect(docDetailRegenBlock).not.toContain('MR-REGENERATE-REFRESH-1');
  });
});
