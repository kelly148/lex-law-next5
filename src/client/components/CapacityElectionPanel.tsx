/**
 * CapacityElectionPanel — CAPACITY-ELECTION-UX (R5)
 *
 * The post-intake capacity elect/correct control on MatterDetail. It is the ONLY surface that can
 * elect a pre-existing / synthetic matter whose election marker is NULL (no backfill — R6), and the
 * way an attorney corrects a prior election. Calls matter.setEngagementCapacity, which stamps the
 * affirmative-election marker (engagementCapacityElectedAt) and records an audited 'disposition'
 * event (R2). Until a matter is elected, the firm master prompts stay OFF for it by data (R3), so
 * this panel surfaces whether an election exists and lets the attorney make/correct one.
 *
 * Ch 35.3 — no business logic here (the marker + audit are server-side); Ch 35.13 — useGuardedMutation.
 */
import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

// Kept in lockstep with the New-Matter form's CAPACITY_OPTIONS (MatterDashboard.tsx) and the
// MatterEngagementCapacitySchema enum. Self-contained so the panel has no cross-page import.
const CAPACITY_OPTIONS = [
  { value: 'law_firm', label: 'Law-firm representation' },
  { value: 'title_settlement_agent', label: 'Title & settlement (settlement agent)' },
] as const;

type EngagementCapacity = (typeof CAPACITY_OPTIONS)[number]['value'];

interface CapacityElectionPanelProps {
  matterId: string;
  engagementCapacity?: string | null | undefined;
  /** The affirmative-election marker (Date or serialized string); null/absent = never elected. */
  electedAt?: Date | string | null | undefined;
}

export default function CapacityElectionPanel({
  matterId,
  engagementCapacity,
  electedAt,
}: CapacityElectionPanelProps): React.ReactElement {
  const isElected = electedAt != null;
  const [selected, setSelected] = useState<EngagementCapacity | ''>(
    engagementCapacity === 'law_firm' || engagementCapacity === 'title_settlement_agent'
      ? engagementCapacity
      : '',
  );
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const electMutation = useGuardedMutation(
    (input: { matterId: string; engagementCapacity: EngagementCapacity }) =>
      utils.client.matter.setEngagementCapacity.mutate(input),
    {
      onSuccess: () => {
        void utils.matter.get.invalidate({ matterId });
        setError(null);
      },
      onError: (err) => setError(err.message),
    },
  );

  const handleSave = (): void => {
    if (!selected) {
      setError('Choose a capacity to elect.');
      return;
    }
    setError(null);
    electMutation.mutate({ matterId, engagementCapacity: selected });
  };

  const currentLabel = CAPACITY_OPTIONS.find((o) => o.value === engagementCapacity)?.label ?? null;

  return (
    <div
      data-testid="capacity-election-panel"
      className="mt-6 rounded-lg border border-gray-200 bg-white p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-firm-navy">Engagement Capacity</h2>
        {isElected ? (
          <span
            data-testid="capacity-status-elected"
            className="flex items-center gap-1 text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Elected{currentLabel ? `: ${currentLabel}` : ''}
          </span>
        ) : (
          <span
            data-testid="capacity-status-unelected"
            className="flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Not yet elected
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-3">
        {isElected
          ? 'How the firm is acting on this matter. Correcting it re-stamps the election and is recorded in the matter record.'
          : 'This matter was never given an affirmative capacity election, so firm master prompts stay off for it. Elect a capacity to set the posture (recorded in the matter record).'}
      </p>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value as EngagementCapacity | '')}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
          >
            <option value="">— Select capacity —</option>
            {CAPACITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={electMutation.isPending || !selected}
          className="px-4 py-2 text-sm bg-accent text-on-accent rounded hover:bg-accent-hover disabled:opacity-50"
        >
          {electMutation.isPending ? 'Saving…' : isElected ? 'Correct election' : 'Elect capacity'}
        </button>
      </div>
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  );
}
