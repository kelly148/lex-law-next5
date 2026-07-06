// @vitest-environment jsdom
/**
 * DocumentDetail deed RECORDABILITY flag-gating — DEED-RECORDABILITY-FLAG-1 (Part A) (ci-gotchas #10: render,
 * don't trust tsc).
 *
 * Operator directive (2026-07-06): for Stage-1 solo use, one runtime switch (DEED_RECORDABILITY_ENABLED, default
 * OFF) hides the WHOLE deed recordability surface — the status strip, the recording-checklist drawer, and its
 * panels — as a unit, so the deed page is document-first. This proves the client half of that switch:
 *   OFF (Stage-1 default) — none of the recording status strip / drawer header / gate panel mounts, and the
 *     Download DOCX action still renders (the attorney gets the drafted instrument + the action row, nothing else);
 *   ON — the machinery mounts exactly as before (strip renders; "Open checklist" reveals the gate panel).
 *
 * The flag reaches the client via the ungated deedRecordability.isEnabled probe. DeedGatePanel is stubbed to a
 * marker; DeedStatusStrip is the REAL component (self-gates on deedGate.isEnabled, ON here) so its mount is
 * observable. The export-route half (skip the D3 sign-off block under the same flag) is covered server-side by
 * deed_recordability_flag_1.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const flags = vi.hoisted(() => ({ recordability: undefined as { enabled: boolean } | undefined }));

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
      // The switch under test.
      deedRecordability: { isEnabled: q(() => flags.recordability) },
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

// Heavy children → markers / null. DeedGatePanel is a marker so the drawer-body mount is observable; the real
// DeedStatusStrip is kept so the strip mount is observable.
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

const DRAWER_HEADER = /Recording checklist & source-extracted facts sign-off/;

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
  flags.recordability = undefined;
  try { window.localStorage.clear(); } catch { /* noop */ }
});
afterEach(() => cleanup());

describe('DEED-RECORDABILITY-FLAG-1: deed page recordability surface is one flag-gated switch', () => {
  it('flag OFF (Stage-1 default): no status strip, no drawer, no gate panel — but Download DOCX still renders', () => {
    flags.recordability = { enabled: false };
    const c = renderPage();
    expect(c.queryByTestId('deed-status-strip')).toBeNull();
    expect(c.queryByText(DRAWER_HEADER)).toBeNull();
    expect(c.queryByTestId('deed-gate-marker')).toBeNull();
    // the document-first action row is intact
    expect(c.queryByTestId('doc-canvas-marker')).toBeTruthy();
    expect(c.queryByTestId('export-docx-button')).toBeTruthy();
  });

  it('flag undefined (loading): the surface is absent (OFF is the safe default before enabled === true)', () => {
    flags.recordability = undefined;
    const c = renderPage();
    expect(c.queryByTestId('deed-status-strip')).toBeNull();
    expect(c.queryByText(DRAWER_HEADER)).toBeNull();
    expect(c.queryByTestId('deed-gate-marker')).toBeNull();
  });

  it('flag ON: the status strip + drawer mount, and "Open checklist" reveals the gate panel', () => {
    flags.recordability = { enabled: true };
    const c = renderPage();
    expect(c.queryByTestId('deed-status-strip')).toBeTruthy();
    expect(c.queryByText(DRAWER_HEADER)).toBeTruthy();
    // heavy gate form still collapsed by default
    expect(c.queryByTestId('deed-gate-marker')).toBeNull();
    fireEvent.click(c.getByTestId('deed-status-open-checklist'));
    expect(c.queryByTestId('deed-gate-marker')).toBeTruthy();
    // Download DOCX unaffected by the flag being ON
    expect(c.queryByTestId('export-docx-button')).toBeTruthy();
  });
});
