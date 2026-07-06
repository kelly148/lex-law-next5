// @vitest-environment jsdom
/**
 * FL-5 (FL-MEDIUM-1) — SendabilitySection tier-label gloss (ci-gotchas #10: render).
 *
 * Proves the DISPLAY gloss: a BLOCKER tier renders "BLOCKER (would block sending)" (naming the QA-5
 * consequence), while a non-BLOCKER tier is unglossed. The parsed severity value + classifier semantics are
 * untouched — only the rendered label text changes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const state = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      reviewSession: {
        checkSendability: {
          useQuery: () => { React.useRef(null); return { data: state.data, isFetching: false, refetch: () => {} }; },
        },
      },
    },
  };
});

import { SendabilitySection } from '../ReviewPane.js';

afterEach(() => cleanup());

describe('FL-5 — sendability tier gloss', () => {
  it('a BLOCKER tier reads "BLOCKER (would block sending)"', () => {
    state.data = { available: true, verdict: { sendable: false, blockers: [{ severity: 'BLOCKER', category: 'unresolved_blanks', summary: 'Unresolved blank remains.' }] } };
    const { container } = render(<SendabilitySection documentId="d1" />);
    expect(container.textContent).toContain('BLOCKER (would block sending)');
  });

  it('a non-BLOCKER tier is unglossed', () => {
    state.data = { available: true, verdict: { sendable: true, blockers: [{ severity: 'PRECISION', category: 'other', summary: 'x' }] } };
    const { container } = render(<SendabilitySection documentId="d1" />);
    expect(container.textContent).toContain('PRECISION');
    expect(container.textContent).not.toContain('would block sending');
  });
});
