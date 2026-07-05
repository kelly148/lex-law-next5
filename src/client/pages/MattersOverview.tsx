/**
 * MattersOverview — FOLD-PM-4 (ongoing matters + to-do list).
 *
 * A simple cross-matter overview: each of the attorney's (non-archived) matters
 * with its open deliverables, plus inline add/complete. Server-backed flag
 * (MATTER_DELIVERABLE_ENABLED, default OFF) — when OFF the page redirects to
 * /matters (the surface is unreachable). All mutations go through
 * useGuardedMutation and invalidate the portfolio query (Ch 35.13).
 */
import React, { useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { Circle, Plus } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

type PortfolioEntry = {
  matterId: string;
  title: string;
  clientName: string | null;
  practiceArea: string | null;
  phase: string;
  openCount: number;
  doneCount: number;
  deliverables: Array<{
    id: string;
    title: string;
    status: 'open' | 'done';
    dueDate: string | null;
    notes: string | null;
  }>;
};

export default function MattersOverview(): React.ReactElement {
  // Hooks run on every render BEFORE any early return (Rules of Hooks).
  const { data: flag, isLoading: flagLoading } = trpc.matterDeliverable.isEnabled.useQuery();
  const enabled = flag?.enabled === true;
  const portfolioQuery = trpc.matterDeliverable.portfolio.useQuery(undefined, { enabled });

  if (flagLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-ink-hint text-sm">Loading…</span>
      </div>
    );
  }
  // OFF (default) or unknown -> the surface is inert and unreachable.
  if (!enabled) return <Navigate to="/matters" replace />;

  const entries = (portfolioQuery.data ?? []) as PortfolioEntry[];
  const totalOpen = entries.reduce((sum, e) => sum + e.openCount, 0);
  // S15 (UI-ATTORNEY-SWEEP-1): matters with 0 open deliverables sort BELOW those with open items.
  // Display order only; JS sort is stable, so ordering within each group is otherwise preserved.
  const sortedEntries = [...entries].sort(
    (a, b) => (b.openCount > 0 ? 1 : 0) - (a.openCount > 0 ? 1 : 0),
  );

  return (
    <div data-testid="matters-overview" className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-serif font-medium text-ink">Overview</h1>
        <p className="text-sm text-ink-secondary mt-0.5">
          {entries.length} matter{entries.length !== 1 ? 's' : ''} · {totalOpen} open deliverable
          {totalOpen !== 1 ? 's' : ''}
        </p>
      </div>

      {portfolioQuery.isLoading ? (
        <div className="px-4 py-8 text-center text-ink-hint text-sm">Loading deliverables…</div>
      ) : entries.length === 0 ? (
        <div data-testid="overview-empty" className="px-4 py-12 text-center text-ink-hint text-sm">
          No matters yet.
        </div>
      ) : (
        <div className="space-y-4">
          {sortedEntries.map((entry) => (
            <MatterOverviewCard key={entry.matterId} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function MatterOverviewCard({ entry }: { entry: PortfolioEntry }): React.ReactElement {
  const utils = trpc.useUtils();
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');

  const invalidate = (): void => {
    void utils.matterDeliverable.portfolio.invalidate();
  };

  const addMutation = useGuardedMutation(
    (input: { matterId: string; title: string; dueDate?: string | null }) =>
      utils.client.matterDeliverable.create.mutate(input),
    {
      onSuccess: () => {
        setNewTitle('');
        setNewDue('');
        invalidate();
      },
    },
  );

  const completeMutation = useGuardedMutation(
    (input: { id: string }) => utils.client.matterDeliverable.complete.mutate(input),
    { onSuccess: invalidate },
  );

  const handleAdd = (): void => {
    const title = newTitle.trim();
    if (!title) return;
    addMutation.mutate({
      matterId: entry.matterId,
      title,
      ...(newDue ? { dueDate: newDue } : {}),
    });
  };

  const openDeliverables = entry.deliverables.filter((d) => d.status === 'open');

  return (
    <div data-testid="matter-card" className="bg-surface rounded-lg border border-line overflow-hidden">
      {/* G7 (UI-ATTORNEY-SWEEP-1): the stated fact links to its surface — the title + open-count
          badge open the matter. Display/navigation only. */}
      <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/matters/${entry.matterId}`} className="block group">
            <h2 className="text-base font-medium text-ink truncate group-hover:text-accent transition-colors">{entry.title}</h2>
          </Link>
          <p className="text-xs text-ink-hint truncate">
            {entry.clientName ?? 'No client'}
            {entry.practiceArea ? ` · ${entry.practiceArea}` : ''} · {entry.phase}
          </p>
        </div>
        <Link
          to={`/matters/${entry.matterId}`}
          data-testid="open-count"
          className="flex-shrink-0 text-xs font-medium text-ink-secondary bg-surface-2 rounded-full px-2.5 py-1 hover:bg-surface hover:text-ink transition-colors"
        >
          {entry.openCount} open
        </Link>
      </div>

      <div className="px-4 py-2">
        {openDeliverables.length === 0 ? (
          <p className="text-xs text-ink-hint py-2">No open deliverables.</p>
        ) : (
          <ul className="divide-y divide-line">
            {openDeliverables.map((d) => (
              <li
                key={d.id}
                data-testid="deliverable-row"
                className="flex items-center gap-3 py-2"
              >
                <button
                  type="button"
                  aria-label="Mark complete"
                  data-testid="complete-button"
                  disabled={completeMutation.isPending}
                  onClick={() => completeMutation.mutate({ id: d.id })}
                  className="flex-shrink-0 text-ink-hint hover:text-accent transition-colors"
                >
                  <Circle className="w-4 h-4" />
                </button>
                <span className="flex-1 text-sm text-ink truncate">{d.title}</span>
                {d.dueDate && (
                  <span className="flex-shrink-0 text-xs text-ink-hint">due {d.dueDate}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        data-testid="add-deliverable-form"
        className="px-4 py-3 border-t border-line flex items-center gap-2"
      >
        <Plus className="w-4 h-4 flex-shrink-0 text-ink-hint" />
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a deliverable…"
          aria-label="New deliverable title"
          className="flex-1 min-w-0 text-sm bg-transparent text-ink placeholder:text-ink-hint focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
        />
        <input
          type="date"
          value={newDue}
          onChange={(e) => setNewDue(e.target.value)}
          aria-label="Due date"
          className="flex-shrink-0 text-xs bg-transparent text-ink-secondary focus:outline-none"
        />
        <button
          type="button"
          data-testid="add-button"
          disabled={!newTitle.trim() || addMutation.isPending}
          onClick={handleAdd}
          className="flex-shrink-0 text-sm bg-accent text-on-accent rounded px-3 py-1 hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>

      {/* G9 (UI-ATTORNEY-SWEEP-1): no silent mutation failure — surface the add error instead of a
          swallowed 412. Display only; the mutation semantics are unchanged. */}
      {addMutation.error && (
        <p data-testid="add-deliverable-error" className="px-4 pb-3 -mt-1 text-xs text-warning">
          Couldn’t add that deliverable: {addMutation.error.message}
        </p>
      )}
    </div>
  );
}
