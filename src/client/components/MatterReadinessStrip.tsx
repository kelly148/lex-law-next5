/**
 * MatterReadinessStrip — Whereas R2 #3 (matter-state header / readiness strip).
 *
 * The first thing you see opening a matter: a single-glance row of state chips pulled from the
 * existing matter-state engine (matterState.dashboard) — ONE coherent read. Display-only; it reads
 * state, it does not change it (the only mutation is setting the matter's jurisdiction, an explicit
 * attorney metadata edit). Chip order is fixed: jurisdiction LEADS, then conflicts, source currency,
 * open items, review status, sendability.
 *
 * Rules of Hooks (the phase-3 #310 lesson): ALL hooks run every render, before any early return.
 * No blue anywhere (R1-CLEANUP-1) — semantic --wa- tints only.
 *
 * Conflicts chip framing: while CONFLICT_GATE_ENABLED is OFF the chip is ADVISORY status (truthful
 * state, e.g. "no client party"), not "blocked/enforced". The same chip flips to enforcing framing
 * when the flag activates (a later, one-line copy change).
 */
import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, MapPin, FileCheck2, ListChecks, Send, BookMarked } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

interface MatterReadinessStripProps {
  matterId: string;
}

type Tone = 'good' | 'attention' | 'alert' | 'neutral';

const TONE_CLS: Record<Tone, string> = {
  good: 'bg-success-tint text-success',
  attention: 'bg-warning-tint text-warning',
  alert: 'bg-danger-tint text-danger',
  neutral: 'bg-surface text-ink-secondary border border-line',
};

function Chip({ tone, icon, children }: { tone: Tone; icon?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium', TONE_CLS[tone])}>
      {icon}
      {children}
    </span>
  );
}

const JURISDICTIONS = ['VA', 'MD'] as const;

const WORKFLOW_LABEL: Record<string, string> = {
  drafting: 'Drafting',
  substantively_accepted: 'Substantively accepted',
  finalizing: 'Finalizing',
  complete: 'Complete',
  archived: 'Archived',
};

/** Map the affirmative conflict-clearance state to an ADVISORY chip (flag-OFF framing). */
function conflictChip(state: string, reasons: string[]): { label: string; tone: Tone } {
  if (state === 'CLEARED') return { label: 'Conflicts cleared', tone: 'good' };
  if (state === 'BLOCKED') return { label: 'Conflicts: blocker to disposition', tone: 'alert' };
  // NOT_ESTABLISHED — name exactly what is missing (advisory, not "blocked")
  switch (reasons[0]) {
    case 'no_conflict_check': return { label: 'Conflicts: not yet checked', tone: 'attention' };
    case 'no_client_party': return { label: 'Conflicts: no client party', tone: 'attention' };
    case 'unconfirmed_client_party': return { label: 'Conflicts: client unconfirmed', tone: 'attention' };
    case 'check_stale_parties_changed': return { label: 'Conflicts: re-check needed', tone: 'attention' };
    default: return { label: 'Conflicts: not established', tone: 'attention' };
  }
}

export default function MatterReadinessStrip({ matterId }: MatterReadinessStripProps): React.ReactElement {
  const utils = trpc.useUtils();
  const dash = trpc.matterState.dashboard.useQuery({ matterId });
  const [editingJur, setEditingJur] = useState(false);

  const setJurisdiction = useGuardedMutation(
    (input: { matterId: string; jurisdiction: string | null }) => utils.client.matter.updateMetadata.mutate(input),
    {
      onSuccess: () => {
        setEditingJur(false);
        void utils.matterState.dashboard.invalidate({ matterId });
        void utils.matter.get.invalidate({ matterId });
      },
    },
  );

  // After all hooks: a minimal, boundary-safe skeleton until the single read resolves. The mode
  // narrow is for the type system (the dashboard read is always 'full'); it never renders in practice.
  if (dash.isLoading || !dash.data || dash.data.full.mode !== 'full') {
    return <div className="mb-5 h-7 rounded bg-surface animate-pulse" data-testid="readiness-strip-loading" />;
  }

  const { full, conflictClearance } = dash.data;
  const jurisdiction = dash.data.jurisdiction ?? null;
  const counts = full.counts;
  const conflict = conflictChip(conflictClearance.state, conflictClearance.reasons);
  const workflow = full.operativeDocument?.workflowState ?? null;
  const reviewLabel = workflow ? (WORKFLOW_LABEL[workflow] ?? workflow) : 'No document';

  return (
    <div className="flex flex-wrap items-center gap-2 mb-5" data-testid="readiness-strip">
      {/* 1) Jurisdiction — LEADS; inline-editable (VA/MD) */}
      {editingJur ? (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-accent-tint">
          <MapPin className="w-3 h-3 text-accent" />
          {JURISDICTIONS.map((j) => (
            <button
              key={j}
              disabled={setJurisdiction.isPending}
              onClick={() => setJurisdiction.mutate({ matterId, jurisdiction: j })}
              className={clsx(
                'px-1.5 py-0.5 rounded border text-[11px]',
                jurisdiction === j ? 'bg-surface text-ink border-line shadow-sm' : 'bg-transparent text-ink-secondary border-line hover:text-ink hover:bg-surface',
              )}
            >
              {j}
            </button>
          ))}
          <button
            disabled={setJurisdiction.isPending}
            onClick={() => setEditingJur(false)}
            className="px-1 text-[11px] text-ink-secondary hover:text-ink"
          >
            cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => setEditingJur(true)}
          title="Set the matter's governing jurisdiction"
          className={clsx(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium',
            jurisdiction ? 'bg-accent-tint text-accent' : 'bg-surface text-ink-secondary border border-dashed border-line',
          )}
          data-testid="readiness-jurisdiction"
        >
          <MapPin className="w-3 h-3" />
          {jurisdiction ?? 'Set jurisdiction'}
        </button>
      )}

      {/* 2) Conflicts — advisory status (flag-OFF framing) */}
      <Chip tone={conflict.tone} icon={conflict.tone === 'good' ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}>
        {conflict.label}
      </Chip>

      {/* 3) Source-authority currency */}
      <Chip tone="neutral" icon={<BookMarked className="w-3 h-3" />}>
        {counts.sourceAuthorities > 0 ? `${counts.sourceAuthorities} source${counts.sourceAuthorities === 1 ? '' : 's'}` : 'No sources'}
      </Chip>

      {/* 4) Open items (blockers emphasized) */}
      {counts.openBlockers > 0 ? (
        <Chip tone="alert" icon={<ListChecks className="w-3 h-3" />}>{counts.openBlockers} blocker{counts.openBlockers === 1 ? '' : 's'}</Chip>
      ) : (
        <Chip tone="neutral" icon={<ListChecks className="w-3 h-3" />}>
          {counts.openItemsOpen > 0 ? `${counts.openItemsOpen} open item${counts.openItemsOpen === 1 ? '' : 's'}` : 'No open items'}
        </Chip>
      )}

      {/* 5) Rolled-up review/workflow status (NOT the review-pane denominator) */}
      <Chip tone="neutral" icon={<FileCheck2 className="w-3 h-3" />}>{reviewLabel}</Chip>

      {/* 6) Sendability */}
      <Chip tone={full.safeToSend ? 'good' : 'attention'} icon={<Send className="w-3 h-3" />}>
        {full.safeToSend ? 'Safe to send' : 'Not ready to send'}
      </Chip>
    </div>
  );
}
