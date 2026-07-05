// @vitest-environment jsdom
/**
 * DocumentDetail deed page-first layout — DEED-DOC-PAGE-LAYOUT-1 (sweep S1) (ci-gotchas #10: render, don't
 * trust tsc).
 *
 * The operator friction: the three-gate recordability panel + D3 sign-off (~20 line-items) sat ABOVE the
 * document, so the attorney scrolled past all of it to read the deed. This proves the fix:
 *   1. a single neutral status strip (counts only) renders near the top for a deed doc;
 *   2. the heavy recording machinery (DeedGatePanel) is NOT mounted by default — it lives in a collapsed
 *      drawer BELOW the document, so the document is above the fold;
 *   3. the document sheet (DocumentCanvas) IS rendered;
 *   4. "Open checklist" reveals the drawer (DeedGatePanel mounts) on demand.
 *
 * The panels' own behavior is covered by deedGatePanel.render.test.tsx / deedSignoffPanel.render.test.tsx —
 * here they are stubbed to markers so this test asserts LAYOUT/POSITION only (semantics untouched).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const DOC = {
  id: 'd-1', matterId: 'm-1', title: 'Test Deed', documentType: 'deed', customTypeLabel: null,
  draftingMode: 'iterative', workflowState: 'drafting', currentVersionId: 'v1',
  templateBindingStatus: 'bound', officialSubstantiveVersionNumber: 0, officialFinalVersionNumber: null,
  notes: null, createdAt: '2026-06-26T00:00:00.000Z', completedAt: null, archivedAt: null,
  variableMap: {}, drewOnUnverifiedKb: false,
};
const VERSION = {
  id: 'v1', documentId: 'd-1', versionNumber: 1, content: 'Draft clause text.',
  createdAt: '2026-06-26T00:00:00.000Z', iterationNumber: 1, generatedByJobId: null,
};
const GATE_GET = {
  state: {},
  evaluation: {
    assembly: { passed: false, blockingReasons: ['no_grantor_bound', 'no_grantee_bound'] },
    legalReview: { passed: false, blockingReasons: ['description_not_locked'] },
    recordability: { passed: false, blockingReasons: ['locality_kb_unverified'] },
    recordable: false,
  },
  parties: { grantorCount: 0, granteeCount: 0 },
  kbSeeded: false,
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
      outline: { get: q(() => ({ outline: null })) },
      job: { listForDocument: q(() => ({ jobs: [] })) },
      expressReviewLoop: { isEnabled: q(() => ({ enabled: false })) },
      deedGate: {
        isEnabled: q(() => ({ enabled: true })),
        get: q(() => GATE_GET),
      },
      deedSignoff: {
        isEnabled: q(() => ({ mode: 'off' })),
        getComparison: q(() => undefined),
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));
vi.mock('../../hooks/useDraftStream.js', () => ({
  useDraftStream: () => ({ streamingText: '', isStreaming: false }),
}));

// Heavy children → markers. The recording machinery in particular must NOT render until the drawer opens.
vi.mock('../../components/DocumentCanvas.js', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', { 'data-testid': 'doc-canvas-marker' }),
    VersionSwitcher: () => null,
  };
});
vi.mock('../../components/ReviewPane.js', () => ({ default: () => null, SendabilitySection: () => null }));
vi.mock('../../components/ExpressReviewPane.js', () => ({ default: () => null }));
vi.mock('../../components/ExportSafetyPanel.js', () => ({ default: () => null }));
vi.mock('../../components/ContextPreviewPanel.js', () => ({ default: () => null }));
vi.mock('../../components/DeedGatePanel.js', async () => {
  const React = await import('react');
  return {
    DeedGatePanel: () => React.createElement('div', { 'data-testid': 'deed-gate-marker' }),
  };
});
vi.mock('../../components/DeedSignoffPanel.js', () => ({ DeedSignoffPanel: () => null }));
vi.mock('../../components/DeliberateActButton.js', () => ({ default: () => null }));
vi.mock('../../components/ProvenanceBadge.js', () => ({ default: () => null }));
vi.mock('../../components/DraftingTargetHeader.js', () => ({ DraftingTargetHeader: () => null }));

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

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* noop */ }
});
afterEach(() => cleanup());

describe('DEED-DOC-PAGE-LAYOUT-1: document-first deed page', () => {
  it('shows the neutral recording status strip with an open-item count (no verdict banner)', () => {
    const c = renderPage();
    const strip = c.getByTestId('deed-status-strip');
    expect(strip).toBeTruthy();
    // union of the three gates' distinct blocking reasons = 4
    expect(strip.textContent).toContain('Recording checklist:');
    expect(strip.textContent).toContain('4 open');
    // neutral tone — no "Recordable: NO" verdict headline in the strip
    expect(strip.textContent).not.toContain('Recordable: NO');
  });

  it('renders the document sheet and does NOT mount the recording checklist above it by default', () => {
    const c = renderPage();
    expect(c.queryByTestId('doc-canvas-marker')).toBeTruthy();
    // The heavy gate form is collapsed by default → not in the DOM (document is above the fold).
    expect(c.queryByTestId('deed-gate-marker')).toBeNull();
  });

  it('"Open checklist" expands the relocated drawer (the gate panel mounts on demand)', () => {
    const c = renderPage();
    expect(c.queryByTestId('deed-gate-marker')).toBeNull();
    fireEvent.click(c.getByTestId('deed-status-open-checklist'));
    expect(c.queryByTestId('deed-gate-marker')).toBeTruthy();
  });
});
