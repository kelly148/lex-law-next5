// @vitest-environment jsdom
/**
 * Whereas R2-2 Inc B — persistent reviewer-disagreement render tests (the load-bearing safety property).
 *
 * The review pane must show DURABLE divergent open-items (origin='orchestration', status='open')
 * read from the persistent store (matterState.dashboard), so a recorded disagreement NEVER vanishes
 * on regenerate / session-close / locked-decision overlap. These tests assert:
 *   - present:               a durable orchestration open-item renders in the "Unresolved reviewer
 *                            disagreements" section, with its per-reviewer positions + resolve pointer;
 *   - empty (filter):        a non-orchestration open item does NOT appear (origin filter holds);
 *   - survives session change: the durable item still renders when the SESSION is regenerated with
 *                            empty feedback — proving it reads the durable store, not the ephemeral
 *                            per-session consolidation.
 *
 * Mocked useQuery calls a real React hook (useRef) so hook counts behave like production.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const SESSION_ID = '11111111-1111-1111-1111-111111111111';
const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';
const MATTER_ID = '33333333-3333-3333-3333-333333333333';

const divergentOpenItem = (over: Record<string, unknown> = {}) => ({
  id: 'oi1',
  matterId: MATTER_ID,
  documentId: DOCUMENT_ID,
  category: 'reviewer_disagreement',
  severity: 'substantive',
  summary: 'Reviewers disagree on the indemnity scope',
  status: 'open',
  statusSource: 'auto',
  origin: 'orchestration',
  reviewSessionId: SESSION_ID,
  detail: {
    positions: [
      { reviewerRole: 'claude', severity: 'major', position: 'Narrow the indemnity', suggestionId: 's1' },
      { reviewerRole: 'gpt', severity: 'minor', position: 'Keep it broad', suggestionId: 's2' },
    ],
  },
  ...over,
});

const mockState = vi.hoisted(() => ({
  dashboard: { data: undefined as unknown },
  reviewSessionGet: {
    data: {
      session: {
        id: '11111111-1111-1111-1111-111111111111',
        iterationNumber: 3,
        selectedReviewers: ['claude', 'gpt'],
        selections: [],
        globalInstructions: '',
        state: 'active',
        createdAt: '2026-06-05T16:00:00.000Z',
      },
      feedback: [],
      evaluation: null,
    } as unknown,
    isLoading: false,
    isError: false,
  },
}));

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
      Provider: ({ children }: { children: React.ReactNode }) => children,
      createClient: () => ({}),
      job: { poll: { useQuery: q({ jobs: [] }) } },
      settings: { get: { useQuery: q({ reviewerEnablement: {}, multiReviewerEnabled: true }) } },
      reviewSession: {
        get: {
          useQuery: () => {
            React.useRef(null);
            return { ...mockState.reviewSessionGet, error: null, refetch: () => {} };
          },
        },
        listLockedDecisions: { useQuery: q({ lockedDecisions: [] }) },
        listAdoptLedger: { useQuery: q({ adoptLedger: [] }) },
        checkSendability: { useQuery: q(null) },
        getDocumentHistory: { useQuery: q({ feedback: [], sessions: [], selections: [] }) },
      },
      orchestration: { getConsolidation: { useQuery: q(undefined) } },
      provisionProvenance: { listForDocument: { useQuery: q([]) } },
      document: { get: { useQuery: q({ currentVersionId: null, matterId: '33333333-3333-3333-3333-333333333333' }) } },
      matterState: {
        dashboard: {
          useQuery: () => {
            React.useRef(null);
            return { data: mockState.dashboard.data, isLoading: false, isError: false, error: null };
          },
        },
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import { ActiveSessionView } from '../ReviewPane.js';

const PROPS = { sessionId: SESSION_ID, documentId: DOCUMENT_ID, onClose: () => {} };

afterEach(() => cleanup());
beforeEach(() => {
  mockState.dashboard = { data: undefined };
  mockState.reviewSessionGet = {
    data: {
      session: {
        id: SESSION_ID,
        iterationNumber: 3,
        selectedReviewers: ['claude', 'gpt'],
        selections: [],
        globalInstructions: '',
        state: 'active',
        createdAt: '2026-06-05T16:00:00.000Z',
      },
      feedback: [],
      evaluation: null,
    },
    isLoading: false,
    isError: false,
  };
});

describe('ActiveSessionView — R2-2 Inc B persistent divergent items', () => {
  it('present: a durable orchestration open-item renders with positions and a resolve pointer', () => {
    mockState.dashboard = { data: { full: { openItems: [divergentOpenItem()] } } };
    const { container, getByText } = render(<ActiveSessionView {...PROPS} />);
    expect(container.textContent).toContain('Unresolved reviewer disagreements');
    expect(container.textContent).toContain('indemnity scope');
    expect(container.textContent).toContain('Narrow the indemnity');
    expect(container.textContent).toContain('persist until you resolve them');
    const link = getByText(/Resolve on the matter page/).closest('a');
    expect(link?.getAttribute('href')).toBe(`/matters/${MATTER_ID}`);
  });

  it('empty / filter: a non-orchestration open item does not appear in the disagreements section', () => {
    mockState.dashboard = {
      data: { full: { openItems: [divergentOpenItem({ origin: 'sendability', summary: 'Jurisdiction blocker' })] } },
    };
    const { container } = render(<ActiveSessionView {...PROPS} />);
    expect(container.textContent).not.toContain('Unresolved reviewer disagreements');
    expect(container.textContent).not.toContain('Jurisdiction blocker');
  });

  it('survives session change: durable item still shows when the session is regenerated with empty feedback', () => {
    mockState.dashboard = { data: { full: { openItems: [divergentOpenItem()] } } };
    mockState.reviewSessionGet = {
      data: {
        session: {
          id: SESSION_ID,
          iterationNumber: 4,
          selectedReviewers: ['claude', 'gpt'],
          selections: [],
          globalInstructions: '',
          state: 'regenerated',
          createdAt: '2026-06-05T16:00:00.000Z',
        },
        feedback: [],
        evaluation: null,
      },
      isLoading: false,
      isError: false,
    };
    const { container } = render(<ActiveSessionView {...PROPS} />);
    // The disagreement persists even though this session carries no feedback (it reads the durable store).
    expect(container.textContent).toContain('Unresolved reviewer disagreements');
    expect(container.textContent).toContain('indemnity scope');
  });
});
