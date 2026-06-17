// @vitest-environment jsdom
/**
 * ASYNC-LANE-LIVE-REFRESH-1 — the open async reviewer pane keeps refreshing WHILE THE TAB IS UNFOCUSED.
 *
 * THE BUG: @tanstack/query-core v5 gates interval refetches behind
 *   `if (this.options.refetchIntervalInBackground || focusManager.isFocused())`.
 * So WITHOUT `refetchIntervalInBackground: true` the 3s `reviewSession.get` poll PAUSES whenever the tab is
 * blurred/backgrounded (visibilityState !== 'visible'). Combined with the global `staleTime: 30_000`
 * (main.tsx), a later refocus issues no catch-up either — the open async pane FROZE on the first "all Queued"
 * snapshot until a manual reload, even though the server kept publishing running/terminal lane states.
 *
 * THE FIX (already applied in ReviewPane.tsx): both polling queries (reviewSession.get and the sibling
 * job.poll) set `refetchIntervalInBackground: true` so the poll keeps firing while unfocused.
 *
 * THIS TEST — the regression guard. It renders the REAL ActiveSessionView over a REAL QueryClient (with the
 * production global staleTime: 30_000) and a custom mock tRPC LINK that returns a SEQUENCE of
 * reviewSession.get payloads. The window is set UNFOCUSED before render. With fake timers we advance the 3s
 * poll and assert the lanes transition queued -> running -> completed_with_feedback IN PLACE and the arrived
 * suggestion renders, WITHOUT any manual refetch()/reload — all while unfocused. That live progression is
 * EXACTLY what fails without refetchIntervalInBackground:true (the poll would never fire while blurred), so
 * this test goes RED if the option is removed from the reviewSession.get query and GREEN when it is present.
 * It also asserts polling self-terminates once allTerminal (no further reviewSession.get calls).
 *
 * NOTE: this uses the REAL trpc useQuery over a REAL react-query observer (NOT the vi.mock('../../trpc.js')
 * approach the sibling #310/parity render tests use) — that is the whole point: only the real observer
 * actually consults refetchIntervalInBackground + focusManager, so only this harness can catch the regression.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager, notifyManager, defaultScheduler } from '@tanstack/react-query';
import { observable } from '@trpc/server/observable';
import type { TRPCLink } from '@trpc/client';
import { trpc } from '../../trpc.js';
import type { AppRouter } from '../../../server/router.js';
import {
  buildReviewerLanesContract,
  isTerminalLaneStatus,
  type ReviewerLaneView,
  type ReviewerLaneStatus,
} from '../../../shared/schemas/reviewerLaneState.js';
import { ActiveSessionView } from '../ReviewPane.js';

const SESSION_ID = '11111111-1111-1111-1111-111111111111';
const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';
const MATTER_ID = '33333333-3333-3333-3333-333333333333';
const VERSION_ID = '44444444-4444-4444-4444-444444444444';

function lane(role: string, status: ReviewerLaneStatus, count: number | null = null): ReviewerLaneView {
  return {
    reviewerRole: role,
    reviewerTitle: role.toUpperCase(),
    status,
    terminal: isTerminalLaneStatus(status),
    suggestionCount: count,
    feedbackRowId: null,
    jobStatus: null,
    failureReason: null,
    dispatchedAt: null,
    terminalizedAt: null,
    updatedAt: '2026-06-11T00:00:00.000Z',
  };
}

const session = {
  id: SESSION_ID,
  iterationNumber: 1,
  selectedReviewers: ['claude', 'gpt'],
  selections: [],
  globalInstructions: '',
  state: 'active',
  documentId: DOCUMENT_ID,
  createdAt: '2026-06-15T16:00:00.000Z',
};

// The arrived suggestion that must render live in the terminal payload (without any manual refetch/reload).
const ARRIVED_TITLE = 'Governing law clause is blank';
const ARRIVED_BODY = 'The governing-law clause is blank and must be set before send.';
const terminalFeedback = [
  {
    id: 'fb-claude-1',
    reviewerRole: 'claude',
    reviewerTitle: 'Claude',
    reviewerModel: 'anthropic:claude-opus-4-5',
    iterationNumber: 1,
    suggestions: [
      {
        suggestionId: 'sg-1',
        title: ARRIVED_TITLE,
        body: ARRIVED_BODY,
        severity: 'major',
        nativeCards: [],
      },
    ],
  },
];

// The reviewSession.get payload SEQUENCE the server "publishes" as the run progresses. The component renders
// off `data.lanes` (the async path), so the lane statuses are what drives the visible transition.
const PAYLOADS = [
  // call 1: all Queued / non-terminal, no feedback (the snapshot the pane froze on).
  {
    session,
    feedback: [],
    evaluation: null,
    lanes: buildReviewerLanesContract([lane('claude', 'pending'), lane('gpt', 'pending')]),
  },
  // call 2: one lane RUNNING, still non-terminal — proves the in-place transition mid-run.
  {
    session,
    feedback: [],
    evaluation: null,
    lanes: buildReviewerLanesContract([lane('claude', 'running'), lane('gpt', 'pending')]),
  },
  // call 3: allTerminal — claude returned WITH feedback, gpt returned without. The suggestion now renders.
  {
    session,
    feedback: terminalFeedback,
    evaluation: null,
    lanes: buildReviewerLanesContract([
      lane('claude', 'completed_with_feedback', 1),
      lane('gpt', 'completed_without_feedback', 0),
    ]),
  },
];

// Per-path call counters so the test can assert the reviewSession.get poll FIRES while unfocused and STOPS
// once allTerminal.
const calls: Record<string, number> = {};

// A minimal VALID default payload for every OTHER query ActiveSessionView fans out, so the component renders
// without crashing. Read off the component: job.poll -> { jobs: [] }; listLockedDecisions -> { lockedDecisions };
// getConsolidation -> undefined; document.get -> { matterId, currentVersionId, title }; matterState.dashboard
// (gated on matterId) -> undefined; the rest are defensive defaults.
function defaultFor(path: string): unknown {
  switch (path) {
    case 'job.poll':
      return { jobs: [] };
    case 'reviewSession.listLockedDecisions':
      return { lockedDecisions: [] };
    case 'reviewSession.listAdoptLedger':
      return { adoptLedger: [] };
    case 'reviewSession.listSuggestionDispositions':
      return { dispositions: [] };
    case 'reviewSession.checkSendability':
      return null;
    case 'reviewSession.getDocumentHistory':
      return { feedback: [], sessions: [], selections: [] };
    case 'orchestration.getConsolidation':
      // react-query rejects `undefined` from a query fn; null is the honest "no consolidation yet".
      return null;
    case 'document.get':
      return { currentVersionId: VERSION_ID, title: 'Promissory Note', matterId: MATTER_ID };
    case 'version.list':
      return [{ id: VERSION_ID, versionNumber: 1, content: 'Body', createdAt: '2026-06-07' }];
    case 'matterState.dashboard':
      return null;
    case 'settings.get':
      return { reviewerEnablement: { claude: true, gpt: true }, multiReviewerEnabled: true };
    default:
      // Any unexpected query: a benign empty object so the observer resolves rather than hangs/crashes.
      return {};
  }
}

// Custom terminating tRPC link: branch on op.path. For reviewSession.get walk the PAYLOADS sequence by a
// call counter (clamped at the terminal payload); for everything else return its default. Each op resolves
// synchronously and completes (a single-shot observable per fetch).
const sequenceLink: TRPCLink<AppRouter> = () => {
  return ({ op }) =>
    observable((observer) => {
      const path = op.path;
      calls[path] = (calls[path] ?? 0) + 1;
      let data: unknown;
      if (path === 'reviewSession.get') {
        const idx = Math.min(calls[path]! - 1, PAYLOADS.length - 1);
        data = PAYLOADS[idx]!;
      } else {
        data = defaultFor(path);
      }
      observer.next({ result: { type: 'data', data } });
      observer.complete();
      return () => undefined;
    });
};

function renderActiveSession(): { queryClient: QueryClient } {
  // Match the PRODUCTION global QueryClient (main.tsx): staleTime 30s is load-bearing — it is part of why a
  // refocus issues no catch-up, so the unfocused poll is the ONLY thing that advances the pane.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  const trpcClient = trpc.createClient({ links: [sequenceLink] });
  render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ActiveSessionView sessionId={SESSION_ID} documentId={DOCUMENT_ID} onClose={() => {}} />
      </QueryClientProvider>
    </trpc.Provider>,
  );
  return { queryClient };
}

// Flush pending microtasks (observable resolution → react-query cache write → React re-render) under fake
// timers. advanceTimersByTimeAsync(0) yields to the microtask queue between timer callbacks, which plain
// advanceTimersByTime does not — it is the reliable way to settle a react-query fetch with fake timers.
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  });
}

// Advance the 3s poll once and settle the resulting fetch + render. The interval timer firing kicks off the
// refetch; its async resolution + cache write + the react-query observer notification → React re-render then
// need several microtask turns to land. We pump the queue inside act() until it is quiet.
async function tickPoll(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // Restore react-query's default focus detection + batch scheduler for any later test in the file/run.
  focusManager.setFocused(undefined);
  notifyManager.setScheduler(defaultScheduler);
  for (const k of Object.keys(calls)) delete calls[k];
});

describe('ASYNC-LANE-LIVE-REFRESH-1 — async pane refreshes live while the tab is UNFOCUSED', () => {
  it('transitions lanes queued -> running -> completed_with_feedback IN PLACE (no manual reload) and self-terminates', async () => {
    vi.useFakeTimers();
    // react-query batches observer notifications through notifyManager's scheduler (defaultScheduler ~=
    // queueMicrotask/setTimeout); under fake timers that batch does not auto-flush, so a cache update would
    // not reach the component. A SYNCHRONOUS scheduler makes each notification fire immediately, so the
    // observer's setState → re-render happens deterministically when the poll's data lands. (This only
    // changes notification TIMING — it does NOT bypass the refetchIntervalInBackground/focus gate under test.)
    notifyManager.setScheduler((cb) => cb());
    // THE REGRESSION CONDITION: the tab is blurred/backgrounded. Without refetchIntervalInBackground:true the
    // 3s reviewSession.get poll would never fire here, freezing the pane on the first "all Queued" snapshot.
    focusManager.setFocused(false);

    renderActiveSession();
    // settle the initial fetch (call 1) → the pane leaves the "Loading…" branch.
    await flush();

    // ── Snapshot 1: both lanes Queued (pending). One reviewSession.get fetch so far. ──
    expect(screen.getByTestId('lane-claude').getAttribute('data-status')).toBe('pending');
    expect(screen.getByTestId('lane-gpt').getAttribute('data-status')).toBe('pending');
    expect(screen.queryByText(ARRIVED_TITLE)).toBeNull();
    expect(calls['reviewSession.get']).toBe(1);

    // ── Tick the poll WHILE UNFOCUSED → snapshot 2: claude RUNNING, in place (same mount). ──
    await tickPoll();
    expect(calls['reviewSession.get']).toBe(2); // the poll FIRED while unfocused — the crux of the fix.
    expect(screen.getByTestId('lane-claude').getAttribute('data-status')).toBe('running');
    expect(screen.getByTestId('lane-gpt').getAttribute('data-status')).toBe('pending');
    expect(screen.queryByText(ARRIVED_TITLE)).toBeNull();

    // ── Tick again WHILE UNFOCUSED → snapshot 3: allTerminal; the arrived suggestion renders live. ──
    await tickPoll();
    expect(calls['reviewSession.get']).toBe(3);
    expect(screen.getByTestId('lane-claude').getAttribute('data-status')).toBe('completed_with_feedback');
    expect(screen.getByTestId('lane-gpt').getAttribute('data-status')).toBe('completed_without_feedback');
    // The suggestion text arrived WITHOUT any manual refetch()/reload — the live-refresh proof.
    expect(screen.getByText(ARRIVED_TITLE)).toBeTruthy();
    expect(screen.getByText(ARRIVED_BODY)).toBeTruthy();

    // ── Polling self-terminates once allTerminal: advancing more time fires NO further reviewSession.get. ──
    const afterTerminal = calls['reviewSession.get']!;
    await tickPoll();
    await tickPoll();
    expect(calls['reviewSession.get']).toBe(afterTerminal);
  });
});
