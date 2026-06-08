/**
 * DeadlinePanel — FOLD-PM-1 Increment 4: the matter-scoped deadline/tickler surface.
 *
 * Reads the deadline engine for one matter and surfaces it so a deadline can NEVER silently slip (G-C):
 *   - a per-matter COVERAGE CHIP whose absence never reads as all-clear (engine off / none / N unconfirmed
 *     / active / OVERDUE-UNRESOLVED);
 *   - an UNCONFIRMED treatment (pending_confirm still shows + fires, with a Confirm affordance — confirming
 *     governs reliance, not visibility);
 *   - an UNMISSABLE OVERDUE treatment (expired_unresolved is loud + permanent until satisfy/waive);
 *   - a no-blank path across every state (engine-off / loading / empty / pending / active / overdue);
 *   - the permanent in-app-only limitation banner (no email/push/calendar — you monitor these panels).
 *
 * DEFAULT-SAFE / ADVISORY: it surfaces + records attorney acts (confirm/override/satisfy/waive/ack); it
 * never sends, files, or notifies (no egress exists). No business logic in React (Ch 35.3) — the server
 * owns the engine, lifecycle, audit, and the coverage/integrity computation.
 *
 * Rules of Hooks (the phase-3 #310 lesson): ALL hooks run every render, before any early return.
 */
import React, { useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

interface DeadlinePanelProps {
  matterId: string;
}

const LIMITATION =
  'In-app ticklers only — no email, push, or external calendar. You are responsible for monitoring these panels.';

export default function DeadlinePanel({ matterId }: DeadlinePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState<{ id: string; mode: 'satisfy' | 'waive' } | null>(null);
  const [basis, setBasis] = useState('');

  const enabledQ = trpc.deadline.isEnabled.useQuery();
  const enabled = enabledQ.data?.enabled === true;

  const utils = trpc.useUtils();
  const list = trpc.deadline.listForMatter.useQuery({ matterId }, { enabled: open && enabled });

  const invalidate = (): void => void utils.deadline.listForMatter.invalidate({ matterId });
  const confirm = useGuardedMutation(
    (input: { id: string }) => utils.client.deadline.confirm.mutate(input),
    { onSuccess: invalidate },
  );
  const satisfy = useGuardedMutation(
    (input: { id: string; basis: string }) => utils.client.deadline.satisfy.mutate(input),
    { onSuccess: () => { setResolving(null); setBasis(''); invalidate(); } },
  );
  const waive = useGuardedMutation(
    (input: { id: string; reason: string }) => utils.client.deadline.waive.mutate(input),
    { onSuccess: () => { setResolving(null); setBasis(''); invalidate(); } },
  );
  const submitResolve = (): void => {
    if (!resolving || basis.trim() === '') return;
    if (resolving.mode === 'satisfy') satisfy.mutate({ id: resolving.id, basis: basis.trim() });
    else waive.mutate({ id: resolving.id, reason: basis.trim() });
  };

  // All hooks above run every render. Derivations below.
  const coverage = list.data?.coverage;
  const deadlines = list.data?.deadlines ?? [];
  const effDue = (d: { attorneyOverrideDate: string | null; computedDueDate: string | null }): string | null =>
    d.attorneyOverrideDate ?? d.computedDueDate;

  // Coverage chip — absence NEVER reads as all-clear.
  const chip = (): React.ReactElement => {
    if (!enabled) return <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 text-ink-secondary">engine off</span>;
    const s = coverage?.state;
    if (s === 'overdue_unresolved') {
      return <span className="text-xs px-1.5 py-0.5 rounded bg-wa-alert-bg text-wa-alert" data-testid="coverage-overdue">{coverage!.overdueUnresolved} overdue — unresolved</span>;
    }
    if (s === 'unconfirmed') {
      return <span className="text-xs px-1.5 py-0.5 rounded bg-wa-attention-bg text-wa-attention">{coverage!.pendingConfirm} unconfirmed</span>;
    }
    if (s === 'active') return <span className="text-xs px-1.5 py-0.5 rounded bg-wa-good-bg text-wa-good">{coverage!.active} active</span>;
    return <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 text-ink-secondary">none created</span>;
  };

  const statusTreatment = (status: string): { cls: string; icon: React.ReactElement; label: string } => {
    if (status === 'expired_unresolved') {
      return { cls: 'border-wa-alert bg-wa-alert-bg', icon: <AlertTriangle className="w-3.5 h-3.5 text-wa-alert" />, label: 'OVERDUE — unresolved' };
    }
    if (status === 'pending_confirm') {
      return { cls: 'border-wa-attention bg-wa-attention-bg', icon: <Clock className="w-3.5 h-3.5 text-wa-attention" />, label: 'unconfirmed' };
    }
    if (status === 'active') {
      return { cls: 'border-line', icon: <CheckCircle2 className="w-3.5 h-3.5 text-wa-good" />, label: 'active' };
    }
    return { cls: 'border-line opacity-60', icon: <CheckCircle2 className="w-3.5 h-3.5 text-ink-secondary" />, label: status };
  };

  return (
    <div className="border border-line rounded-lg overflow-hidden mb-4">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full px-4 py-3 bg-surface hover:bg-surface-2">
        <CalendarClock className="w-4 h-4 text-ink" />
        <h3 className="text-sm font-semibold text-ink flex-1 text-left">Deadlines &amp; ticklers</h3>
        {chip()}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-ink-secondary" data-testid="deadline-limitation">{LIMITATION}</p>

          {!enabled && (
            <p className="text-xs text-ink-secondary" data-testid="deadline-engine-off">
              The deadline engine is turned off. No deadlines are computed or tracked yet.
            </p>
          )}

          {enabled && list.isLoading && <p className="text-xs text-ink-secondary">Loading deadlines…</p>}

          {enabled && !list.isLoading && deadlines.length === 0 && (
            <p className="text-xs text-ink-secondary" data-testid="deadline-empty">
              No deadlines created for this matter yet. Absence is not confirmation — add deadlines so they are tracked.
            </p>
          )}

          {enabled && deadlines.length > 0 && (
            <ul className="space-y-1.5" data-testid="deadline-list">
              {deadlines.map((d) => {
                const t = statusTreatment(d.status);
                const due = effDue(d);
                const provisional = Array.isArray(d.constraints) && d.constraints.some((c) => (c as { status?: string }).status === 'unresolved');
                return (
                  <li key={d.id} className={`px-2.5 py-2 border rounded ${t.cls}`} data-testid="deadline-row" data-status={d.status}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-ink">{d.description}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] text-ink-secondary">{t.icon}{t.label}</span>
                    </div>
                    <div className="text-[11px] text-ink-secondary mt-0.5">
                      {d.family} · due {due ?? '—'}
                      {d.attorneyOverrideDate ? ' (override)' : ''}
                      {provisional ? ' · provisional (unresolved constraint)' : ''}
                    </div>
                    {d.status === 'pending_confirm' && (
                      <button
                        onClick={() => confirm.mutate({ id: d.id })}
                        disabled={confirm.isPending}
                        className="mt-1.5 px-2 py-0.5 text-[11px] border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
                        data-testid="deadline-confirm"
                      >
                        {confirm.isPending ? 'Confirming…' : 'Confirm (rely on this date)'}
                      </button>
                    )}
                    {d.status === 'expired_unresolved' && (
                      <p className="mt-1 text-[11px] text-wa-alert" data-testid="deadline-overdue-note">
                        This deadline passed without disposition. It will not clear on its own — satisfy or waive it (with a basis).
                      </p>
                    )}
                    {(d.status === 'active' || d.status === 'expired_unresolved') && (
                      <div className="mt-1.5">
                        {resolving?.id === d.id ? (
                          <div className="space-y-1" data-testid="deadline-resolve-form">
                            <input
                              value={basis}
                              onChange={(e) => setBasis(e.target.value)}
                              placeholder={resolving.mode === 'satisfy' ? 'Basis (how it was satisfied)' : 'Reason (why waived)'}
                              className="w-full text-[11px] border border-line rounded px-2 py-1"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={submitResolve}
                                disabled={basis.trim() === '' || satisfy.isPending || waive.isPending}
                                className="px-2 py-0.5 text-[11px] border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
                                data-testid="deadline-resolve-submit"
                              >
                                {resolving.mode === 'satisfy' ? 'Mark satisfied' : 'Waive'}
                              </button>
                              <button onClick={() => { setResolving(null); setBasis(''); }} className="px-2 py-0.5 text-[11px] text-ink-secondary hover:underline">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button onClick={() => { setResolving({ id: d.id, mode: 'satisfy' }); setBasis(''); }} className="px-2 py-0.5 text-[11px] border border-line text-ink rounded hover:bg-surface" data-testid="deadline-satisfy">Satisfy</button>
                            <button onClick={() => { setResolving({ id: d.id, mode: 'waive' }); setBasis(''); }} className="px-2 py-0.5 text-[11px] border border-line text-ink-secondary rounded hover:bg-surface" data-testid="deadline-waive">Waive</button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
