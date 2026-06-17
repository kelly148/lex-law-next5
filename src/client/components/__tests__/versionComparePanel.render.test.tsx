// @vitest-environment jsdom
/**
 * Render smoke test for VersionComparePanel — REVIEW-LOOP-UX-1 / R3.
 *
 * WHY THIS EXISTS: CI type-checks but never RENDERS components, so a React #310 (hooks-order) crash
 * in a panel can ship without CI noticing (the phase-3 prod incident). This renders the panel under
 * jsdom with the real tRPC + react-query providers and asserts it MOUNTS — and re-renders across the
 * collapsed->expanded toggle — without throwing. The selection state falls back to a derived default
 * at use-time (no useEffect+setState), so the hook order is stable across the open/load lifecycle.
 *
 * The query defaults to enabled:false (the panel starts collapsed), so no server/network is needed.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from '../../trpc.js';
import VersionComparePanel from '../VersionComparePanel.js';

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

const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';

describe('VersionComparePanel — render smoke (the missing CI guard)', () => {
  it('mounts collapsed without throwing', () => {
    const { getByText } = render(withProviders(<VersionComparePanel documentId={DOCUMENT_ID} />));
    expect(getByText('Version compare')).toBeTruthy();
  });

  it('expanding (collapsed -> open) keeps a stable hook order and does not throw', () => {
    const { getByText } = render(withProviders(<VersionComparePanel documentId={DOCUMENT_ID} />));
    // Clicking the header flips `open` true, enabling the query and rendering the body. With the
    // derived-default selection (no hook after an early return), the hook order is unchanged.
    fireEvent.click(getByText('Version compare'));
    expect(getByText('Version compare')).toBeTruthy();
  });
});
