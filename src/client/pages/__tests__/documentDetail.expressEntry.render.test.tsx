// @vitest-environment jsdom
/**
 * DocumentDetail Express-entry flag-gating — EXPRESS-AUTO-REVIEW-LOOP-1 Part B (ci-gotchas #10).
 *
 * The "Auto-review (Express)" mode entry is flag-dark: it renders ONLY when expressReviewLoop.isEnabled returns
 * enabled:true (AUTO_REVIEW_LOOP_ENABLED, default OFF). Asserts flag ON -> entry renders; flag OFF / undefined ->
 * entry absent (so the whole surface is dormant on prod). The heavy canvas/review children are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const flags = vi.hoisted(() => ({ express: undefined as { enabled: boolean } | undefined }));

const DOC = {
  id: 'd-1', matterId: 'm-1', title: 'Test Deed', documentType: 'deed', customTypeLabel: null,
  draftingMode: 'iterative', workflowState: 'drafting', currentVersionId: 'v1',
  templateBindingStatus: 'bound', officialSubstantiveVersionNumber: 0, officialFinalVersionNumber: null,
  notes: null, createdAt: '2026-06-26T00:00:00.000Z', completedAt: null, archivedAt: null,
};
const VERSION = {
  id: 'v1', documentId: 'd-1', versionNumber: 1, content: 'Draft clause text.',
  createdAt: '2026-06-26T00:00:00.000Z', iterationNumber: 1, generatedByJobId: null,
};

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const q = (getData: () => unknown) => ({
    useQuery: () => { React.useRef(null); return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} }; },
  });
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  return {
    trpc: {
      useUtils: () => utilsProxy,
      document: { get: q(() => DOC) },
      version: { list: q(() => [VERSION]), get: q(() => VERSION) },
      materials: { list: q(() => []) },
      reference: { list: q(() => []) },
      outline: { get: q(() => ({ headings: [] })) },
      job: { listForDocument: q(() => []) },
      expressReviewLoop: { isEnabled: q(() => flags.express) },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));
vi.mock('../../hooks/useDraftStream.js', () => ({
  useDraftStream: () => ({ streamingText: '', isStreaming: false }),
}));

// Stub the heavy children so the page mounts to its action bar without their internals.
vi.mock('../../components/DocumentCanvas.js', () => ({ default: () => null, VersionSwitcher: () => null }));
vi.mock('../../components/ReviewPane.js', () => ({ default: () => null, SendabilitySection: () => null }));
vi.mock('../../components/ExpressReviewPane.js', () => ({ default: () => null }));
vi.mock('../../components/ExportSafetyPanel.js', () => ({ default: () => null }));
vi.mock('../../components/ContextPreviewPanel.js', () => ({ default: () => null }));
vi.mock('../../components/DeedGatePanel.js', () => ({ DeedGatePanel: () => null }));
vi.mock('../../components/DeliberateActButton.js', () => ({ default: () => null }));
vi.mock('../../components/ProvenanceBadge.js', () => ({ default: () => null }));
vi.mock('../../components/DraftingTargetHeader.js', () => ({ DraftingTargetHeader: () => null }));
// D3-SIGNOFF A.1 Inc 4 added DeedSignoffPanel as an (internally self-gated) child of DocumentDetail; stub it so
// this render test mounts to the action bar without the panel's real trpc (deedSignoff) hooks (ci-gotchas #10).
vi.mock('../../components/DeedSignoffPanel.js', () => ({ DeedSignoffPanel: () => null }));

import DocumentDetail from '../DocumentDetail.js';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/matters/m-1/documents/d-1']}>
      <Routes>
        <Route path="/matters/:matterId/documents/:documentId" element={<DocumentDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { flags.express = undefined; });
afterEach(() => cleanup());

describe('DocumentDetail — Express auto-review entry flag-gating', () => {
  it('flag ON: the "Auto-review (Express)" entry renders', () => {
    flags.express = { enabled: true };
    const c = renderPage();
    expect(c.queryByTestId('express-entry')).toBeTruthy();
  });

  it('flag OFF: the entry is absent (dormant on prod)', () => {
    flags.express = { enabled: false };
    const c = renderPage();
    expect(c.queryByTestId('express-entry')).toBeNull();
  });

  it('flag undefined (loading): the entry is absent (no render before enabled === true)', () => {
    flags.express = undefined;
    const c = renderPage();
    expect(c.queryByTestId('express-entry')).toBeNull();
  });
});
