// @vitest-environment jsdom
/**
 * Render smoke tests for the review-pane side panels — FOLD-ORCH-1 / FOLD-DRAFT-1.
 *
 * WHY THIS EXISTS: the phase-3 prod incident was a React #310 (hooks-order) crash in a new
 * review-pane panel that blanked the whole review view — and CI never caught it because CI
 * type-checks but never RENDERS components. These tests render the panels under jsdom with the
 * real tRPC + react-query providers and assert they MOUNT (and re-render across a visibility
 * toggle) without throwing. This is the systemic guard the incident showed we were missing.
 *
 * Queries default to enabled:false (panels start collapsed), so no server/network is needed.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from '../../trpc.js';
import OrchestrationConsolidationPanel from '../OrchestrationConsolidationPanel.js';
import ProvisionProvenancePanel from '../ProvisionProvenancePanel.js';
import LddDiffPanel from '../LddDiffPanel.js';
import ClosurePackagePanel from '../ClosurePackagePanel.js';
import PanelErrorBoundary from '../PanelErrorBoundary.js';

afterEach(() => {
  cleanup();
});

function withProviders(ui: React.ReactElement): React.ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({ links: [httpBatchLink({ url: 'http://localhost/trpc' })] });
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </trpc.Provider>
  );
}

const SESSION_ID = '11111111-1111-1111-1111-111111111111';
const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';

describe('review-pane panels — render smoke (the missing CI guard)', () => {
  it('ProvisionProvenancePanel mounts without throwing', () => {
    const { getByText } = render(withProviders(<ProvisionProvenancePanel documentId={DOCUMENT_ID} />));
    expect(getByText('Provision provenance')).toBeTruthy();
  });

  it('LddDiffPanel mounts without throwing', () => {
    const { getByText } = render(withProviders(<LddDiffPanel documentId={DOCUMENT_ID} />));
    expect(getByText('LOI-vs-draft check')).toBeTruthy();
  });

  it('ClosurePackagePanel mounts without throwing', () => {
    const { getByText } = render(withProviders(<ClosurePackagePanel matterId={DOCUMENT_ID} />));
    expect(getByText('Closing package')).toBeTruthy();
  });

  it('OrchestrationConsolidationPanel mounts (visible) without throwing', () => {
    const { getByText } = render(
      withProviders(<OrchestrationConsolidationPanel reviewSessionId={SESSION_ID} visible={true} />),
    );
    expect(getByText('Multi-model orchestration')).toBeTruthy();
  });

  it('OrchestrationConsolidationPanel hidden (visible=false) mounts cleanly and renders nothing', () => {
    const { container } = render(
      withProviders(<OrchestrationConsolidationPanel reviewSessionId={SESSION_ID} visible={false} />),
    );
    // Hooks ran, then early-returned null — no throw, nothing rendered.
    expect(container.querySelector('h3')).toBeNull();
  });

  it('toggling visible false -> true keeps a stable hook order (the #310 guard)', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const trpcClient = trpc.createClient({ links: [httpBatchLink({ url: 'http://localhost/trpc' })] });
    const tree = (visible: boolean): React.ReactElement => (
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <OrchestrationConsolidationPanel reviewSessionId={SESSION_ID} visible={visible} />
        </QueryClientProvider>
      </trpc.Provider>
    );
    const { rerender, getByText } = render(tree(false));
    // This re-render is the scenario that crashed in prod (panel becomes visible as feedback
    // arrives). With the post-hooks visibility gate, the hook order is unchanged across renders.
    rerender(tree(true));
    expect(getByText('Multi-model orchestration')).toBeTruthy();
  });

  it('PanelErrorBoundary contains a throwing child instead of propagating', () => {
    const Boom = (): React.ReactElement => {
      throw new Error('boom');
    };
    const { getByText } = render(
      <PanelErrorBoundary label="Test panel">
        <Boom />
      </PanelErrorBoundary>,
    );
    expect(getByText(/hit an error and was hidden/)).toBeTruthy();
  });
});
