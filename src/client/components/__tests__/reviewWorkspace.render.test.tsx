// @vitest-environment jsdom
/**
 * RELAYOUT-3 — review workspace render tests (the G6 proof + the no-blank state coverage).
 *
 * G6 (hard gate): the review subtree REFLOWS, never REMOUNTS, across the layout breakpoint. Both
 * historical blank-screens on this surface were mount/render-path crashes. These tests render the
 * real ReviewPane workspace and assert that crossing the breakpoint keeps the SAME review-slot DOM
 * node mounted (only the document-reference pane mounts/unmounts), that the review slot is never
 * blank in either mode, and that focusing a feedback item (anchoring) does not remount the review
 * subtree. The mocked useQuery calls a real React hook so hook counts behave like production.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  const q = (data: unknown) => () => {
    React.useRef(null);
    return { data, isLoading: false, error: null, refetch: () => {} };
  };
  const VERSION = { id: 'ver-1', versionNumber: 1, content: 'Article I. The Principal hereby grants…', createdAt: '2026-06-07' };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      settings: { get: { useQuery: q({ reviewerEnablement: { gpt: true }, multiReviewerEnabled: true }) } },
      reviewSession: {
        get: { useQuery: q({ status: 'active' }) },
        listLockedDecisions: { useQuery: q({ lockedDecisions: [] }) },
        listAdoptLedger: { useQuery: q({ adoptLedger: [] }) },
        checkSendability: { useQuery: q(null) },
        getDocumentHistory: { useQuery: q({ feedback: [], sessions: [], selections: [] }) },
      },
      orchestration: { getConsolidation: { useQuery: q(undefined) } },
      provisionProvenance: { listForDocument: { useQuery: q([]) } },
      document: { get: { useQuery: q({ currentVersionId: 'ver-1', title: 'POA', matterId: 'm-1' }) } },
      version: { list: { useQuery: q([VERSION]) } },
      matterState: { dashboard: { useQuery: q(undefined) } },
      job: { poll: { useQuery: q({ jobs: [] }) } },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import ReviewPane from '../ReviewPane.js';

const DOC_ID = '33333333-3333-3333-3333-333333333333';

// Controllable matchMedia: one shared MediaQueryList whose `matches` the test can flip + dispatch.
function installMatchMedia(initialMatches: boolean) {
  let listeners: Array<(e: { matches: boolean }) => void> = [];
  const mql = {
    matches: initialMatches,
    media: '',
    onchange: null,
    addEventListener: (_e: string, cb: (e: { matches: boolean }) => void) => { listeners.push(cb); },
    removeEventListener: (_e: string, cb: (e: { matches: boolean }) => void) => { listeners = listeners.filter((l) => l !== cb); },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  };
  (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn(() => mql);
  return {
    flip(matches: boolean) {
      mql.matches = matches;
      act(() => { listeners.forEach((cb) => cb({ matches })); });
    },
  };
}

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.reviewLayout;
});
beforeEach(() => { delete document.documentElement.dataset.reviewLayout; });

describe('ReviewWorkspace — RELAYOUT-3 layout', () => {
  it('WIDE: split mode — read-only doc pane + review slot; rail data-attribute set', () => {
    installMatchMedia(true);
    const { getByTestId, queryByTestId } = render(<ReviewPane documentId={DOC_ID} iterationNumber={1} onClose={() => {}} />);
    expect(getByTestId('review-workspace').getAttribute('data-mode')).toBe('split');
    expect(queryByTestId('review-doc-pane-wrap')).toBeTruthy(); // the doc reference pane mounts
    expect(getByTestId('review-slot')).toBeTruthy();
    expect(document.documentElement.dataset.reviewLayout).toBe('wide');
  });

  it('FULL-PAGE: no doc pane; review slot present; "view in document" jump; rail attribute fullpage', () => {
    installMatchMedia(false);
    const { getByTestId, queryByTestId } = render(<ReviewPane documentId={DOC_ID} iterationNumber={2} onClose={() => {}} />);
    expect(getByTestId('review-workspace').getAttribute('data-mode')).toBe('fullpage');
    expect(queryByTestId('review-doc-pane-wrap')).toBeNull(); // doc pane unmounted below the breakpoint
    expect(getByTestId('review-slot')).toBeTruthy();
    expect(queryByTestId('view-in-document')).toBeTruthy(); // session-preserving doc jump
    expect(document.documentElement.dataset.reviewLayout).toBe('fullpage');
  });

  it('G6: crossing the breakpoint keeps the SAME review-slot node mounted — only the doc pane unmounts', () => {
    const mm = installMatchMedia(true);
    const { getByTestId, queryByTestId } = render(<ReviewPane documentId={DOC_ID} iterationNumber={1} onClose={() => {}} />);
    const slotWide = getByTestId('review-slot');
    const firstChildWide = slotWide.firstElementChild;
    expect(queryByTestId('review-doc-pane-wrap')).toBeTruthy();

    mm.flip(false); // cross to full-page

    const slotNarrow = getByTestId('review-slot');
    // The review subtree did NOT remount: same DOM node + same first child instance (reflow, not remount).
    expect(slotNarrow).toBe(slotWide);
    expect(slotNarrow.firstElementChild).toBe(firstChildWide);
    // Only the document pane unmounted.
    expect(queryByTestId('review-doc-pane-wrap')).toBeNull();
    expect(getByTestId('review-workspace').getAttribute('data-mode')).toBe('fullpage');

    mm.flip(true); // and back — still the same node
    expect(getByTestId('review-slot')).toBe(slotWide);
    expect(queryByTestId('review-doc-pane-wrap')).toBeTruthy();
  });

  it('no-blank: the review slot is always rendered and non-empty in both modes', () => {
    const mm = installMatchMedia(true);
    const { getByTestId } = render(<ReviewPane documentId={DOC_ID} iterationNumber={1} onClose={() => {}} />);
    expect(getByTestId('review-slot').textContent?.trim().length).toBeGreaterThan(0);
    mm.flip(false);
    expect(getByTestId('review-slot').textContent?.trim().length).toBeGreaterThan(0);
  });

  it('anchoring: focusing inside the review slot does NOT remount/replace the review subtree', () => {
    installMatchMedia(true);
    const { getByTestId } = render(<ReviewPane documentId={DOC_ID} iterationNumber={1} onClose={() => {}} />);
    const slot = getByTestId('review-slot');
    const childBefore = slot.firstElementChild;
    const focusable = slot.querySelector('button, input, [tabindex]') as HTMLElement | null;
    if (focusable) {
      act(() => { fireEvent.focus(focusable, { bubbles: true }); });
    }
    // The review subtree is unchanged (anchoring is a doc-pane-only side effect on local state).
    expect(getByTestId('review-slot')).toBe(slot);
    expect(slot.firstElementChild).toBe(childBefore);
  });
});
