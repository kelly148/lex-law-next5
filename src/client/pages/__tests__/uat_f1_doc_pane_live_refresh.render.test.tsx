// @vitest-environment jsdom
/**
 * DOC-PANE-LIVE-REFRESH-1 (F1) — the document Content pane live-refreshes when a draft job completes
 * WHILE THE TAB IS UNFOCUSED, with no manual reload.
 *
 * THE BUG (Monster UAT U1): after "Generating draft…" ends the action bar updated (document.get refetched)
 * but the Content pane stayed "No draft yet" / "Version History (0)" until a manual reload. Root cause is the
 * #328 class: @tanstack/query-core v5 gates interval refetches behind
 *   `if (this.options.refetchIntervalInBackground || focusManager.isFocused())`.
 * The attorney waits 60-70s for the draft and almost always switches tabs, so the JobBanner
 * `job.listForDocument` poll PAUSED while blurred — job completion was never detected, the terminal
 * useEffect that invalidates version.list never ran, and (with the global staleTime:30s) a refocus issued no
 * catch-up. The pane froze on the empty state until reload.
 *
 * THE FIX (DocumentDetail.tsx): JobBanner's job.listForDocument poll sets `refetchIntervalInBackground: true`
 * so it keeps firing while unfocused; when the job goes terminal the useEffect invalidates version.list +
 * document.get, so the content observer refetches and the new draft renders in place.
 *
 * THIS TEST — the regression guard. It renders the REAL exported JobBanner next to a real version.list
 * observer (the content-pane stand-in) over a REAL QueryClient at the production staleTime:30s, with the
 * window UNFOCUSED. A custom mock tRPC link returns a job sequence (active -> completed) and serves the new
 * version ONLY after the draft job has completed (mirroring the server). With fake timers we advance the
 * background poll and assert the version surfaces in place — which is EXACTLY what fails without
 * refetchIntervalInBackground:true (the poll would never fire while blurred). Goes RED if the option is
 * removed.
 *
 * NOTE: like asyncLaneLiveRefresh.render.test.tsx, this uses the REAL trpc useQuery over a REAL react-query
 * observer (not vi.mock) — only the real observer consults refetchIntervalInBackground + focusManager.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager, notifyManager, defaultScheduler } from '@tanstack/react-query';
import { observable } from '@trpc/server/observable';
import type { TRPCLink } from '@trpc/client';
import type { ReactElement } from 'react';
import { trpc } from '../../trpc.js';
import type { AppRouter } from '../../../server/router.js';
import { JobBanner } from '../DocumentDetail.js';

const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';
const MATTER_ID = '33333333-3333-3333-3333-333333333333';
const VERSION_ID = '44444444-4444-4444-4444-444444444444';
const DRAFT_BODY = 'ARTICLE I. This durable power of attorney is granted under the Code of Virginia.';

const activeJob = {
  id: 'job-1',
  jobType: 'draft_generation',
  status: 'running',
  documentId: DOCUMENT_ID,
  queuedAt: '2026-06-19T16:00:00.000Z',
};
const completedJob = { ...activeJob, status: 'completed' };

// Per-path call counters so the test can assert the job poll FIRES while unfocused.
const calls: Record<string, number> = {};

// Custom terminating tRPC link. job.listForDocument walks active -> completed by call count; version.list
// returns the new version ONLY after the draft job has completed (>= 2 job polls), mirroring the server
// (the version row exists only once the job finished). Everything else returns a benign default.
const sequenceLink: TRPCLink<AppRouter> = () => {
  return ({ op }) =>
    observable((observer) => {
      const path = op.path;
      calls[path] = (calls[path] ?? 0) + 1;
      let data: unknown;
      if (path === 'job.listForDocument') {
        data = { jobs: [calls[path]! <= 1 ? activeJob : completedJob] };
      } else if (path === 'version.list') {
        const jobPolls = calls['job.listForDocument'] ?? 0;
        data = jobPolls >= 2
          ? [{ id: VERSION_ID, versionNumber: 1, content: DRAFT_BODY, createdAt: '2026-06-19T16:01:10.000Z' }]
          : [];
      } else if (path === 'document.get') {
        data = { currentVersionId: null, title: 'Durable POA', matterId: MATTER_ID };
      } else {
        data = {};
      }
      observer.next({ result: { type: 'data', data } });
      observer.complete();
      return () => undefined;
    });
};

// The content-pane stand-in: a real version.list observer. It is what must refresh in place when the
// background poll detects completion and the JobBanner useEffect invalidates version.list.
function VersionProbe({ documentId }: { documentId: string }): ReactElement {
  const { data } = trpc.version.list.useQuery({ documentId });
  const versions = data ?? [];
  return (
    <div data-testid="version-probe" data-count={String(versions.length)}>
      {versions.length === 0 ? 'No draft yet' : versions[0]!.content}
    </div>
  );
}

function renderPane(): void {
  // Match the PRODUCTION global QueryClient (main.tsx): staleTime 30s is load-bearing — it is part of why a
  // refocus issues no catch-up, so the unfocused background poll is the ONLY thing that advances the pane.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  const trpcClient = trpc.createClient({ links: [sequenceLink] });
  render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <JobBanner documentId={DOCUMENT_ID} />
        <VersionProbe documentId={DOCUMENT_ID} />
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  });
}

// Advance past the JobBanner poll interval (5000 + up to 1000ms jitter) and settle the resulting fetch +
// invalidation + dependent version.list refetch + re-render.
async function tickPoll(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
  notifyManager.setScheduler(defaultScheduler);
  for (const k of Object.keys(calls)) delete calls[k];
});

describe('DOC-PANE-LIVE-REFRESH-1 (F1) — content pane refreshes live while the tab is UNFOCUSED', () => {
  it('surfaces the completed draft in place (no reload) after the background poll detects completion', async () => {
    vi.useFakeTimers();
    // Synchronous notification scheduler so cache updates reach the components deterministically under fake
    // timers (timing only — does NOT bypass the refetchIntervalInBackground/focus gate under test).
    notifyManager.setScheduler((cb) => cb());
    // THE REGRESSION CONDITION: the tab is blurred/backgrounded. Without refetchIntervalInBackground:true the
    // job.listForDocument poll would never fire here, so completion is never detected and the pane stays
    // "No draft yet".
    focusManager.setFocused(false);

    renderPane();
    await flush();

    // ── Snapshot 1: draft job running; pane shows the empty state. ──
    expect(screen.getByText(/in progress/i)).toBeTruthy();
    expect(screen.getByTestId('version-probe').getAttribute('data-count')).toBe('0');
    expect(screen.getByTestId('version-probe').textContent).toContain('No draft yet');
    expect(calls['job.listForDocument']).toBe(1);

    // ── Tick the background poll WHILE UNFOCUSED → the job completes, version.list is invalidated, and the
    //    new draft renders in place. ──
    await tickPoll();

    expect(calls['job.listForDocument']!).toBeGreaterThanOrEqual(2); // the poll FIRED while unfocused — the crux.
    // The in-progress banner cleared (activeJob became null) ...
    expect(screen.queryByText(/in progress/i)).toBeNull();
    // ... and the Content pane shows the arrived draft WITHOUT any manual reload — the live-refresh proof.
    expect(screen.getByTestId('version-probe').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('version-probe').textContent).toContain('durable power of attorney');
  });
});
