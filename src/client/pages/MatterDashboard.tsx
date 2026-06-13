/**
 * MatterDashboard — Lex Law Next v1
 *
 * Ch 26 — Matter Dashboard
 *
 * Displays all matters for the authenticated user.
 * Supports creating, archiving, unarchiving, and deleting matters.
 *
 * Procedures used:
 *   - matter.list (query)
 *   - matter.create (mutation)
 *   - matter.archive (mutation)
 *   - matter.unarchive (mutation)
 *   - matter.delete (mutation)
 *
 * Ch 35.3 — No business logic in React: all logic is server-side.
 * Ch 35.13 — Every mutation uses useGuardedMutation.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Archive, ArchiveRestore, Trash2, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import UpcomingDeadlines from '../components/UpcomingDeadlines.js';

const PRACTICE_AREAS = [
  'Corporate',
  'Litigation',
  'Real Estate',
  'Family Law',
  'Estate Planning',
  'Employment',
  'Intellectual Property',
  'Immigration',
  'Criminal Defense',
  'Other',
];

// INSTR-2B-title: the firm CAPACITY for this matter. Default 'law_firm' (representation, the safe
// default); 'title_settlement_agent' is the affirmative non-representational settlement-agent
// election that routes drafting to the Title master. Non-blocking; the attorney can change it.
const CAPACITY_OPTIONS = [
  { value: 'law_firm', label: 'Law-firm representation' },
  { value: 'title_settlement_agent', label: 'Title & settlement (settlement agent)' },
] as const;

type EngagementCapacity = (typeof CAPACITY_OPTIONS)[number]['value'];

interface CreateMatterFormProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateMatterForm({ onClose, onCreated }: CreateMatterFormProps): React.ReactElement {
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [practiceArea, setPracticeArea] = useState('');
  // CAPACITY-ELECTION-UX (R4): start UNSELECTED and REQUIRE an affirmative election (mirrors the
  // Title-required pattern). A new matter cannot be created without the attorney choosing a capacity,
  // so its election marker is always set at creation (R2). This is the Option-B funnel on top of the
  // Option-A data-layer floor.
  const [capacity, setCapacity] = useState<EngagementCapacity | ''>('');
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const createMutation = useGuardedMutation(
    (input: {
      title: string;
      clientName?: string;
      practiceArea?: string;
      engagementCapacity?: EngagementCapacity;
    }) => utils.client.matter.create.mutate(input),
    {
      onSuccess: () => {
        void utils.matter.list.invalidate();
        onCreated();
      },
      onError: (err) => {
        setError(err.message);
      },
    }
  );

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    // CAPACITY-ELECTION-UX (R4): block submit until an affirmative capacity is chosen (intake-blocking).
    if (!capacity) {
      setError('Capacity is required — choose how you are handling this matter.');
      return;
    }
    setError(null);
    createMutation.mutate({
      title: title.trim(),
      ...(clientName.trim() ? { clientName: clientName.trim() } : {}),
      ...(practiceArea ? { practiceArea } : {}),
      // CAPACITY-ELECTION-UX (R2/R4): an explicit, attorney-chosen capacity (the marker is set server-side).
      engagementCapacity: capacity,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-firm-navy mb-4">New Matter</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="e.g., Smith Estate Planning"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Name</label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="e.g., John Smith"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Practice Area</label>
            <select
              value={practiceArea}
              onChange={(e) => setPracticeArea(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            >
              <option value="">— Select —</option>
              {PRACTICE_AREAS.map((area) => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          </div>
          <div data-testid="capacity-selector">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Capacity — how am I handling this matter? <span className="text-red-500">*</span>
            </label>
            <select
              value={capacity}
              onChange={(e) => setCapacity(e.target.value as EngagementCapacity | '')}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            >
              {/* CAPACITY-ELECTION-UX (R4): starts unselected; an affirmative pick is required to submit. */}
              <option value="">— Select capacity —</option>
              {CAPACITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 text-sm bg-accent text-on-accent rounded hover:bg-accent-hover disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating…' : 'Create Matter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface MatterRowProps {
  matter: {
    id: string;
    title: string;
    clientName: string | null;
    practiceArea: string | null;
    phase: string;
    archivedAt: string | null;
    createdAt: string;
  };
  onRefresh: () => void;
}

function MatterRow({ matter, onRefresh }: MatterRowProps): React.ReactElement {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const archiveMutation = useGuardedMutation(
    (input: { matterId: string }) => utils.client.matter.archive.mutate(input),
    { onSuccess: () => { void utils.matter.list.invalidate(); onRefresh(); } }
  );

  const unarchiveMutation = useGuardedMutation(
    (input: { matterId: string }) => utils.client.matter.unarchive.mutate(input),
    { onSuccess: () => { void utils.matter.list.invalidate(); onRefresh(); } }
  );

  const deleteMutation = useGuardedMutation(
    (input: { matterId: string }) => utils.client.matter.delete.mutate(input),
    { onSuccess: () => { void utils.matter.list.invalidate(); onRefresh(); } }
  );

  const isArchived = matter.archivedAt !== null;

  const handleDelete = (): void => {
    if (window.confirm(`Delete matter "${matter.title}"? This cannot be undone.`)) {
      deleteMutation.mutate({ matterId: matter.id });
    }
  };

  return (
    <div
      className={clsx(
        'flex items-center gap-4 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors',
        isArchived && 'opacity-60'
      )}
    >
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => navigate(`/matters/${matter.id}`)}
      >
        <div className="flex items-center gap-2">
          <span className="font-serif font-medium text-firm-navy text-sm truncate">{matter.title}</span>
          {isArchived && (
            <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">Archived</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {matter.clientName && (
            <span className="text-xs text-gray-500">{matter.clientName}</span>
          )}
          {matter.practiceArea && (
            <span className="text-xs text-gray-400">{matter.practiceArea}</span>
          )}
          <span className={clsx(
            'text-xs px-1.5 py-0.5 rounded capitalize',
            matter.phase === 'intake' && 'bg-blue-100 text-blue-700',
            matter.phase === 'drafting' && 'bg-amber-100 text-amber-700',
            matter.phase === 'complete' && 'bg-green-100 text-green-700',
          )}>
            {matter.phase}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {isArchived ? (
          <button
            onClick={() => unarchiveMutation.mutate({ matterId: matter.id })}
            disabled={unarchiveMutation.isPending}
            title="Unarchive"
            className="p-1.5 text-gray-400 hover:text-firm-navy rounded disabled:opacity-50"
          >
            <ArchiveRestore className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => archiveMutation.mutate({ matterId: matter.id })}
            disabled={archiveMutation.isPending}
            title="Archive"
            className="p-1.5 text-gray-400 hover:text-firm-navy rounded disabled:opacity-50"
          >
            <Archive className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          title="Delete"
          className="p-1.5 text-gray-400 hover:text-danger rounded disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => navigate(`/matters/${matter.id}`)}
          className="p-1.5 text-gray-400 hover:text-firm-navy rounded"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function MatterDashboard(): React.ReactElement {
  const [showCreate, setShowCreate] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const { data, isLoading, refetch } = trpc.matter.list.useQuery(
    includeArchived ? { includeArchived: true } : undefined
  );

  const matters = data ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-garamond font-medium text-firm-navy">Matters</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {matters.length} matter{matters.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="rounded"
            />
            Show archived
          </label>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-on-accent text-sm rounded hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Matter
          </button>
        </div>
      </div>

      {/* FOLD-PM-1 — minimal cross-matter next-30-days + integrity (NOT PM-4); flag-gated, surfaces only */}
      <UpcomingDeadlines />

      {/* Matter list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">Loading matters…</div>
        ) : matters.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm mb-3">No matters yet.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="text-firm-navy text-sm underline"
            >
              Create your first matter
            </button>
          </div>
        ) : (
          matters.map((matter) => (
            <MatterRow
              key={matter.id}
              matter={matter}
              onRefresh={() => void refetch()}
            />
          ))
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateMatterForm
          onClose={() => setShowCreate(false)}
          onCreated={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
