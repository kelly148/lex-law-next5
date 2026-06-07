// @vitest-environment jsdom
/**
 * REVIEW-SKIN-1 — reviewer-selection screen token conformance (RELAYOUT-3 secondary scope).
 *
 * Styling only: the reviewer-selection state gets the retheme it missed. These assertions pin the
 * deltas — the single oxblood primary "Start review (N reviewer/s)" with a live count, the ink
 * (not blue) checkbox accent, the surface-2 header, and no blue / one-oxblood in the view-state.
 * No logic is exercised (enablement/selection/creation are unchanged and covered elsewhere).
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  const q = (data: unknown) => () => { React.useRef(null); return { data, isLoading: false, error: null, refetch: () => {} }; };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      settings: { get: { useQuery: q({ reviewerEnablement: { gpt: true }, multiReviewerEnabled: true }) } },
      reviewSession: { getDocumentHistory: { useQuery: q({ feedback: [], sessions: [], selections: [] }) } },
      document: { get: { useQuery: q({ currentVersionId: 'v1', title: 'POA', matterId: 'm1' }) } },
      version: { list: { useQuery: q([{ id: 'v1', versionNumber: 1, content: 'x', createdAt: '2026-06-07' }]) } },
    },
  };
});
vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

beforeAll(() => {
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
  });
});

import ReviewPane from '../ReviewPane.js';
const DOC_ID = '44444444-4444-4444-4444-444444444444';

afterEach(() => cleanup());

describe('REVIEW-SKIN-1 — reviewer-selection token conformance', () => {
  it('Start review is the single oxblood primary, with a live reviewer count', () => {
    const { getByTestId } = render(<ReviewPane documentId={DOC_ID} iterationNumber={1} onClose={() => {}} />);
    const start = getByTestId('start-review');
    expect(start.className).toMatch(/bg-accent/);
    expect(start.className).toMatch(/text-on-accent/);
    expect(start.textContent ?? '').toMatch(/Start review \(\d+ reviewer/);
  });

  it('exactly one oxblood in the selection view; no blue; no black header', () => {
    const { getByTestId } = render(<ReviewPane documentId={DOC_ID} iterationNumber={1} onClose={() => {}} />);
    const panel = getByTestId('reviewer-selection');
    // match the exact `bg-accent` fill utility, NOT `bg-accent-hover` (the hover variant).
    const oxbloodCount = (panel.innerHTML.match(/bg-accent(?![-\w])/g) ?? []).length;
    expect(oxbloodCount).toBe(1); // only "Start review"
    const ws = getByTestId('review-workspace');
    expect(ws.innerHTML).not.toMatch(/blue/);
    expect(ws.innerHTML).not.toMatch(/firm-navy/); // header reskinned off the black bar
  });

  it('reviewer checkboxes use the ink accent (not the browser-default blue)', () => {
    const { getByTestId } = render(<ReviewPane documentId={DOC_ID} iterationNumber={1} onClose={() => {}} />);
    const inputs = getByTestId('reviewer-selection').querySelectorAll('input');
    expect(inputs.length).toBeGreaterThan(0);
    inputs.forEach((i) => expect(i.className).toMatch(/accent-ink/));
  });

  it('the workspace header is surface-2 with a hairline (not the old black bar)', () => {
    const { getByTestId } = render(<ReviewPane documentId={DOC_ID} iterationNumber={1} onClose={() => {}} />);
    // the header is the first border-b child of the review slot
    const slot = getByTestId('review-slot');
    const header = slot.querySelector('.bg-surface-2');
    expect(header).toBeTruthy();
  });
});
