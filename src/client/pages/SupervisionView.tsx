/**
 * SupervisionView — SUPERVISION-VIEW-1 (read-only egress supervision).
 *
 * A READ-ONLY owner-scoped dashboard over the chat_egress_events audit log (GLBA
 * vendor-oversight): the attorney reviews THEIR OWN copilot vendor sends, filterable
 * by provider / matter / date-range / kind / decision, with aggregate cards. Flag-gated
 * (SUPERVISION_VIEW_ENABLED, default OFF) — redirects to /matters when OFF. There are
 * NO mutations on this page; it never writes to the append-only log.
 */
import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { trpc } from '../trpc.js';
import {
  CHAT_EGRESS_KIND_VALUES,
  CHAT_EGRESS_DECISION_VALUES,
} from '../../shared/schemas/chatCopilot.js';

const PAGE_SIZE = 25;

export default function SupervisionView(): React.ReactElement {
  // All hooks run before any early return (Rules of Hooks).
  const { data: flag, isLoading: flagLoading } = trpc.supervision.isEnabled.useQuery();
  const enabled = flag?.enabled === true;

  const [provider, setProvider] = useState('');
  const [matterId, setMatterId] = useState('');
  const [kind, setKind] = useState('');
  const [decision, setDecision] = useState('');
  const [sinceDate, setSinceDate] = useState('');
  const [untilDate, setUntilDate] = useState('');
  const [offset, setOffset] = useState(0);

  const mattersQuery = trpc.matter.list.useQuery(undefined, { enabled });

  const queryInput: {
    limit: number;
    offset: number;
    provider?: string;
    matterId?: string;
    kind?: (typeof CHAT_EGRESS_KIND_VALUES)[number];
    decision?: (typeof CHAT_EGRESS_DECISION_VALUES)[number];
    sinceDate?: string;
    untilDate?: string;
  } = { limit: PAGE_SIZE, offset };
  if (provider) queryInput.provider = provider;
  if (matterId) queryInput.matterId = matterId;
  if (kind) queryInput.kind = kind as (typeof CHAT_EGRESS_KIND_VALUES)[number];
  if (decision) queryInput.decision = decision as (typeof CHAT_EGRESS_DECISION_VALUES)[number];
  if (sinceDate) queryInput.sinceDate = sinceDate;
  if (untilDate) queryInput.untilDate = untilDate;

  const supervisionQuery = trpc.supervision.query.useQuery(queryInput, { enabled });

  if (flagLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-ink-hint text-sm">Loading…</span>
      </div>
    );
  }
  if (!enabled) return <Navigate to="/matters" replace />;

  const result = supervisionQuery.data;
  const events = result?.events ?? [];
  const agg = result?.aggregates;
  const total = result?.total ?? 0;
  const matters = mattersQuery.data ?? [];

  // Reset to the first page whenever a filter changes.
  const onFilterChange = (set: (v: string) => void) => (v: string): void => {
    set(v);
    setOffset(0);
  };

  return (
    <div data-testid="supervision-view" className="p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-serif font-medium text-ink">Supervision</h1>
        <p className="text-sm text-ink-secondary mt-0.5">
          Read-only review of your AI vendor sends (egress audit log).
        </p>
      </div>

      {/* Filters */}
      <div data-testid="supervision-filters" className="flex flex-wrap items-end gap-3 mb-5">
        <label className="flex flex-col text-xs text-ink-secondary">
          Matter
          <select
            value={matterId}
            onChange={(e) => onFilterChange(setMatterId)(e.target.value)}
            className="mt-1 text-sm bg-surface border border-line rounded px-2 py-1 text-ink"
          >
            <option value="">All matters</option>
            {matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-ink-secondary">
          Provider
          <input
            type="text"
            value={provider}
            onChange={(e) => onFilterChange(setProvider)(e.target.value)}
            placeholder="e.g. anthropic"
            className="mt-1 text-sm bg-surface border border-line rounded px-2 py-1 text-ink"
          />
        </label>
        <label className="flex flex-col text-xs text-ink-secondary">
          Kind
          <select
            value={kind}
            onChange={(e) => onFilterChange(setKind)(e.target.value)}
            className="mt-1 text-sm bg-surface border border-line rounded px-2 py-1 text-ink"
          >
            <option value="">All</option>
            {CHAT_EGRESS_KIND_VALUES.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-ink-secondary">
          Decision
          <select
            value={decision}
            onChange={(e) => onFilterChange(setDecision)(e.target.value)}
            className="mt-1 text-sm bg-surface border border-line rounded px-2 py-1 text-ink"
          >
            <option value="">All</option>
            {CHAT_EGRESS_DECISION_VALUES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-ink-secondary">
          From
          <input
            type="date"
            value={sinceDate}
            onChange={(e) => onFilterChange(setSinceDate)(e.target.value)}
            className="mt-1 text-sm bg-surface border border-line rounded px-2 py-1 text-ink"
          />
        </label>
        <label className="flex flex-col text-xs text-ink-secondary">
          To
          <input
            type="date"
            value={untilDate}
            onChange={(e) => onFilterChange(setUntilDate)(e.target.value)}
            className="mt-1 text-sm bg-surface border border-line rounded px-2 py-1 text-ink"
          />
        </label>
      </div>

      {/* Aggregates */}
      {agg && (
        <div data-testid="supervision-aggregates" className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          {/* total = all egress DECISIONS (allowed + blocked); blocked were refused at the gate, never sent. */}
          <AggCard label="Total events" value={agg.total} />
          <AggCard label="Allowed (sent)" value={agg.allowedCount} />
          <AggCard label="Blocked" value={agg.blockedCount} accent={agg.blockedCount > 0} />
          <AggCard label="Attachments sent" value={agg.includedAttachmentTotal} />
          <AggCard label="NPI withheld" value={agg.npiWithheldTotal} />
        </div>
      )}

      {/* Events table */}
      <div className="bg-surface rounded-lg border border-line overflow-hidden">
        {supervisionQuery.isLoading ? (
          <div className="px-4 py-8 text-center text-ink-hint text-sm">Loading…</div>
        ) : events.length === 0 ? (
          <div data-testid="supervision-empty" className="px-4 py-12 text-center text-ink-hint text-sm">
            No egress events for this filter.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} data-testid="supervision-row" className="px-4 py-2 flex items-center gap-3 text-sm">
                <span className="text-ink-hint text-xs w-36 flex-shrink-0">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
                <span className="text-ink w-40 flex-shrink-0 truncate">
                  {e.provider}
                  <span className="text-ink-hint"> / {e.model}</span>
                </span>
                <span className="text-ink-secondary text-xs w-28 flex-shrink-0">{e.kind}</span>
                <span
                  className={
                    'text-xs rounded px-1.5 py-0.5 flex-shrink-0 ' +
                    (e.decision === 'blocked'
                      ? 'bg-accent/10 text-accent'
                      : 'bg-surface-2 text-ink-secondary')
                  }
                >
                  {e.decision}
                </span>
                <span className="text-ink-hint text-xs flex-1 truncate">
                  {e.blockReason ? `blocked: ${e.blockReason}` : `status: ${e.status}`}
                </span>
                <span className="text-ink-hint text-xs flex-shrink-0">
                  att {e.includedAttachmentCount} · npi− {e.npiWithheldCount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-sm">
        <span className="text-ink-hint text-xs">
          {total === 0 ? '0' : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}`} of {total}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="px-3 py-1 rounded border border-line text-ink-secondary hover:text-ink disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="px-3 py-1 rounded border border-line text-ink-secondary hover:text-ink disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function AggCard({ label, value, accent }: { label: string; value: number; accent?: boolean }): React.ReactElement {
  return (
    <div className="bg-surface rounded-lg border border-line px-3 py-2">
      <div className={'text-xl font-medium ' + (accent ? 'text-accent' : 'text-ink')}>{value}</div>
      <div className="text-xs text-ink-hint">{label}</div>
    </div>
  );
}
