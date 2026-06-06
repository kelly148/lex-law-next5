// @vitest-environment jsdom
/**
 * R2 #4 — ExportSafetyPanel grouped reasons + the unverified_kb warning at the override moment.
 *
 * Asserts (real render, ci-gotchas #10): findings are grouped under "Blocking" / "Review" headers,
 * and the unverified-KB WARN finding shows in the Review group (so it's in front of the attorney
 * whenever the panel is open — by construction, the same surface where a block is overridden).
 * The mocked useQuery calls a real React hook (useRef) for #310-faithful hook counts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  const q = (data: unknown) => () => {
    React.useRef(null);
    return { data, isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      sendabilityGate: {
        getGate: {
          useQuery: q({
            verdict: 'warn',
            blocks: [{ category: 'wrong_matter_id', summary: 'The document/matter linkage is inconsistent.' }],
            warnings: [{ category: 'unverified_kb', summary: 'This draft drew on an unverified knowledge-base memo — re-verify it against current law before sending.' }],
            degraded: 'none',
            inScope: true,
            enforced: false,
          }),
        },
      },
      document: { get: { useQuery: q({ currentVersionId: 'v1' }) } },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import ExportSafetyPanel from '../ExportSafetyPanel.js';

afterEach(() => cleanup());

describe('ExportSafetyPanel — R2 #4 grouped reasons + unverified_kb', () => {
  it('groups findings under Blocking / Review headers and surfaces the unverified-KB warning', () => {
    const { container, getByText } = render(<ExportSafetyPanel documentId={DOCUMENT_ID} />);
    // open the panel (getGate is enabled: open)
    fireEvent.click(getByText('Export safety'));
    const t = container.textContent ?? '';
    expect(t).toContain('Blocking'); // block group header
    expect(t).toContain('Review');   // warn group header
    expect(t).toContain('unverified_kb'); // the finding category label
    expect(t).toContain('re-verify it against current law'); // the diligence summary, at the override surface
  });
});
